# Cross-Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement auto cross-like and comment functionality using a background worker and Supabase for deduplication and templates.

**Architecture:** A Chrome alarm triggers a background worker every 30 minutes. It checks if the feature is enabled, fetches un-interacted posts from Supabase, picks a random comment template, and calls TechHub APIs to like and comment, tracking actions in the `interactions` table.

**Tech Stack:** Vanilla JavaScript, Chrome Extension API (MV3), Supabase REST API.

## Global Constraints
- Target MV3 Chrome Extension.
- No build steps (Vanilla JS).
- Do not introduce new npm dependencies for the extension itself.

---

### Task 1: Update README with DB Schema

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: N/A
- Produces: SQL schema documentation for `comment_templates` and `interactions`.

- [ ] **Step 1: Modify README.md to add new tables**

```markdown
-- Tạo bảng comment_templates
CREATE TABLE comment_templates (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tạo bảng interactions
CREATE TABLE interactions (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    techhub_id BIGINT NOT NULL,
    interaction_type VARCHAR(20) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tạo index cho interactions
CREATE INDEX idx_interactions_lookup ON interactions(username, techhub_id, interaction_type);
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add comment_templates and interactions table schema"
```

### Task 2: Supabase Client Enhancements

**Files:**
- Modify: `supabase-client.js`

**Interfaces:**
- Consumes: N/A
- Produces: 
  - `async getCommentTemplates()`
  - `async getUninteractedPosts(username, limit)`
  - `async recordInteraction(username, techhubId, type)`

- [ ] **Step 1: Implement getCommentTemplates**

```javascript
  async getCommentTemplates() {
    try {
      const url = `${this.restUrl}/comment_templates?is_active=eq.true`;
      const response = await fetch(url, { method: "GET", headers: this.getHeaders() });
      if (!response.ok) throw new Error("Failed to fetch templates");
      return await response.json();
    } catch (error) {
      console.error("[Supabase] Error:", error);
      return [];
    }
  }
```

- [ ] **Step 2: Implement getUninteractedPosts**
*Note: Due to REST API limitations without an RPC, we will fetch recent posts and fetch interactions for the user, then filter in memory, or use a simpler approach.*

```javascript
  async getUninteractedPosts(username, limit = 5) {
    try {
      // Get recent posts not by this user
      const postsUrl = `${this.restUrl}/posts?username=neq.${encodeURIComponent(username)}&order=created_at.desc&limit=50`;
      const postsRes = await fetch(postsUrl, { headers: this.getHeaders() });
      const posts = await postsRes.json();

      // Get user interactions
      const interactionsUrl = `${this.restUrl}/interactions?username=eq.${encodeURIComponent(username)}`;
      const intRes = await fetch(interactionsUrl, { headers: this.getHeaders() });
      const interactions = await intRes.json();

      // Filter
      const interactedIds = new Set(interactions.map(i => i.techhub_id));
      const uninteracted = posts.filter(p => !interactedIds.has(p.techhub_id));
      
      return uninteracted.slice(0, limit);
    } catch (error) {
      console.error("[Supabase] Error:", error);
      return [];
    }
  }
```

- [ ] **Step 3: Implement recordInteraction**

```javascript
  async recordInteraction(username, techhubId, type) {
    try {
      const payload = { username, techhub_id: techhubId, interaction_type: type };
      await fetch(`${this.restUrl}/interactions`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
    } catch (error) {
      console.error("[Supabase] Error recording interaction:", error);
    }
  }
```

- [ ] **Step 4: Commit**

```bash
git add supabase-client.js
git commit -m "feat: add supabase methods for interactions"
```

### Task 3: Popup UI Toggle & State

**Files:**
- Modify: `popup.html`, `popup.css`, `popup.js`

**Interfaces:**
- Produces: UI toggle that updates `chrome.storage.local` with `autoInteractEnabled` boolean.

- [ ] **Step 1: Add HTML Toggle**
Modify `popup.html` to add a checkbox for auto-interact.
```html
<div class="setting-item">
  <label>Auto Cross-Interact:</label>
  <input type="checkbox" id="autoInteractToggle">
</div>
```

- [ ] **Step 2: Add Logic in popup.js**
Load and save state.
```javascript
// In popup.js init:
chrome.storage.local.get(['autoInteractEnabled'], (result) => {
  document.getElementById('autoInteractToggle').checked = !!result.autoInteractEnabled;
});

document.getElementById('autoInteractToggle').addEventListener('change', (e) => {
  chrome.storage.local.set({ autoInteractEnabled: e.target.checked });
});
```

- [ ] **Step 3: Commit**

```bash
git add popup.html popup.js
git commit -m "feat: add UI toggle for auto cross-interact"
```

### Task 4: Background Service Worker Logic

**Files:**
- Modify: `background.js`

**Interfaces:**
- Consumes: `chrome.storage.local.get('autoInteractEnabled')`
- Consumes: TechHub API (using fetch in background)
- Produces: Periodic execution of interaction logic.

- [ ] **Step 1: Set up alarm**
```javascript
chrome.alarms.create("crossInteractAlarm", { periodInMinutes: 30 });
```

- [ ] **Step 2: Implement Alarm Listener**
*Note: The background script must instantiate a Supabase client or send a message to popup, but since popup can be closed, background needs its own Supabase logic or pure fetch.*
Add a lightweight fetch function inside `background.js` for TechHub APIs.

```javascript
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "crossInteractAlarm") {
    runCrossInteraction();
  }
});

async function runCrossInteraction() {
  const result = await chrome.storage.local.get(['autoInteractEnabled', 'techhubCredentials', 'userProfile']);
  if (!result.autoInteractEnabled || !result.techhubCredentials || !result.userProfile) return;

  // Simplified fetch logic to Supabase & TechHub goes here.
  // We'll dispatch this logic to a separate helper file or just inline the fetch calls using the stored config.
}
```

- [ ] **Step 3: Commit**

```bash
git add background.js
git commit -m "feat: implement background alarm for cross-interact"
```
