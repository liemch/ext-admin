// post-sync-ui.js — UI cho panel admin "Đồng bộ bài viết" và cache "Bài viết của tôi".
//
// File này gắn hàm render vào global (window.PopUp / PostSyncUI) để popup.js gọi.

(function (global) {
  "use strict";

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "—";
    return d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  }

  function statusBadge(status) {
    const cls = {
      verified: "ok",
      rejected: "bad",
      stale: "warn",
      unverified: "muted",
      succeeded: "ok",
      partial: "warn",
      failed: "bad",
      session_required: "bad",
      pending: "muted",
      claimed: "info",
      running: "info",
      retry_wait: "warn",
      cancelled: "muted",
      hint: "info",
      feed: "muted",
      user_reconcile: "muted",
      legacy: "muted",
    }[status] || "muted";
    return `<span class="badge ${cls}">${escapeHtml(status || "?")}</span>`;
  }

  async function refreshPostSyncOverview() {
    if (!PostSyncClient.isPostSyncLeader()) {
      el("postSyncOverview").innerHTML =
        `<p class="muted">Chức năng dành cho máy admin — cấu hình <code>POST_SYNC_API_CONFIG.adminToken</code> để làm leader.</p>`;
      return;
    }
    try {
      const s = await PostSyncClient.getPostSyncStatus();
      const leader = (s.activeLeaders || [])[0];
      el("postSyncOverview").innerHTML = `
        <div class="grid-2">
          <div class="card mini"><div class="label">Leader</div><div class="value">${leader ? "🟢 online" : "⚪ không có leader"}</div><div class="sub muted">${leader ? escapeHtml(leader.claimed_by_device || "—") : ""}</div></div>
          <div class="card mini"><div class="label">Lease hết hạn</div><div class="value">${leader ? formatTime(leader.lease_until) : "—"}</div></div>
          <div class="card mini"><div class="label">Queue</div><div class="value">${Object.entries(s.queue || {}).map(([k, v]) => `${k}:${v}`).join(" · ") || "trống"}</div></div>
          <div class="card mini"><div class="label">Session required</div><div class="value">${s.sessionRequiredCount || 0}</div></div>
          <div class="card mini"><div class="label">Request 24h</div><div class="value">${s.requestCount24h || 0}</div></div>
          <div class="card mini"><div class="label">Bài mới 24h</div><div class="value">${s.newPosts24h || 0} mới · ${s.updated24h || 0} cập nhật</div></div>
        </div>
        ${s.sessionRequiredCount > 0 ? `<p class="warn">⚠ Có job bị chờ phiên — mở tab TechHub để đăng nhập lại rồi bấm "Kiểm tra phiên".</p>` : ""}
      `;
    } catch (error) {
      el("postSyncOverview").innerHTML = `<p class="bad">Không tải được trạng thái: ${escapeHtml(error.message)}</p>`;
    }
  }

  async function refreshNewPosts() {
    const days = Number(el("postSyncNewDays")?.value || 7);
    const filter = el("postSyncNewFilter")?.value || "";
    try {
      const data = await PostSyncClient.listNewPosts(days, 50, null, filter || null);
      const posts = data.posts || [];
      el("postSyncNewList").innerHTML = posts.length === 0
        ? `<p class="muted">Không có bài mới trong ${days} ngày qua.</p>`
        : `<table class="data-table">
            <thead><tr><th>Bài</th><th>Tác giả</th><th>Nguồn</th><th>Trạng thái</th><th>Xác minh</th></tr></thead>
            <tbody>
              ${posts.map((p) => `
                <tr>
                  <td><a href="${escapeHtml(p.url || "#")}" target="_blank" rel="noreferrer">${escapeHtml(p.title || `#${p.techhub_id}`)}</a></td>
                  <td>@${escapeHtml(p.username || "—")}</td>
                  <td>${statusBadge(p.discovered_by)}</td>
                  <td>${statusBadge(p.verification_status)}</td>
                  <td class="muted">${formatTime(p.last_verified_at)}</td>
                </tr>`).join("")}
            </tbody>
          </table>`;
    } catch (error) {
      el("postSyncNewList").innerHTML = `<p class="bad">${escapeHtml(error.message)}</p>`;
    }
  }

  async function refreshRunHistory() {
    try {
      const data = await PostSyncClient.listPostSyncRuns(30);
      const runs = data.runs || [];
      el("postSyncRuns").innerHTML = runs.length === 0
        ? `<p class="muted">Chưa có run nào.</p>`
        : `<table class="data-table">
            <thead><tr><th>Bắt đầu</th><th>Loại</th><th>Kết quả</th><th>Req</th><th>Trang</th><th>Mới</th><th>Cập nhật</th><th>Lỗi</th></tr></thead>
            <tbody>
              ${runs.map((r) => `
                <tr>
                  <td class="muted">${formatTime(r.started_at)}</td>
                  <td>${escapeHtml(r.job_id ? `#${r.job_id}` : "—")}</td>
                  <td>${statusBadge(r.outcome)}</td>
                  <td>${r.request_count || 0}</td>
                  <td>${r.page_count || 0}</td>
                  <td class="ok">${r.new_count || 0}</td>
                  <td>${r.updated_count || 0}</td>
                  <td class="bad">${r.error_summary ? escapeHtml(String(r.error_summary).slice(0, 120)) : "—"}</td>
                </tr>`).join("")}
            </tbody>
          </table>`;
    } catch (error) {
      el("postSyncRuns").innerHTML = `<p class="bad">${escapeHtml(error.message)}</p>`;
    }
  }

  async function refreshSources() {
    try {
      const s = await PostSyncClient.getPostSyncStatus();
      const sources = s.sources || [];
      el("postSyncSources").innerHTML = sources.length === 0
        ? `<p class="muted">Chưa có nguồn nào được cấu hình.</p>`
        : `<table class="data-table">
            <thead><tr><th>Loại</th><th>Key</th><th>Lần chạy cuối</th><th>Kế tiếp</th><th>Lỗi</th></tr></thead>
            <tbody>
              ${sources.map((src) => `
                <tr>
                  <td>${escapeHtml(src.type)}</td>
                  <td><code>${escapeHtml(src.source_key)}</code></td>
                  <td>${formatTime(src.last_success_at || src.last_checked_at)}</td>
                  <td>${formatTime(src.next_check_at)}</td>
                  <td class="bad">${src.last_error ? escapeHtml(String(src.last_error).slice(0, 120)) : "—"}</td>
                </tr>`).join("")}
            </tbody>
          </table>`;
    } catch (error) {
      el("postSyncSources").innerHTML = `<p class="bad">${escapeHtml(error.message)}</p>`;
    }
  }

  async function requestFeedScan() {
    const slug = el("postSyncCommunitySlug")?.value.trim() || "cai-tien-moi-ngay";
    try {
      await PostSyncClient.requestPostSync("feed", { communitySlug: slug });
      flash("Đã xếp hàng quét feed.");
      setTimeout(refreshPostSyncOverview, 500);
    } catch (error) {
      flash(`Lỗi: ${error.message}`, "bad");
    }
  }

  async function requestUserScan() {
    const username = el("postSyncUsernameInput")?.value.trim();
    if (!username) return flash("Nhập username cần quét.", "warn");
    try {
      const res = await PostSyncClient.requestPostSync("user", { username });
      if (res.queued === false) {
        flash(`Cooldown ${res.cooldownMinutes} phút, thử lại sau.`, "warn");
      } else {
        flash(`Đã xếp hàng quét @${username}.`);
      }
    } catch (error) {
      flash(`Lỗi: ${error.message}`, "bad");
    }
  }

  function flash(msg, kind = "ok") {
    const t = el("postSyncFlash");
    if (!t) return;
    t.textContent = msg;
    t.className = `flash ${kind}`;
    setTimeout(() => {
      if (t.textContent === msg) t.textContent = "";
    }, 4000);
  }

  async function refreshAllPostSync() {
    if (!PostSyncClient.isPostSyncLeader()) {
      await refreshPostSyncOverview();
      return;
    }
    await Promise.all([
      refreshPostSyncOverview(),
      refreshNewPosts(),
      refreshRunHistory(),
      refreshSources(),
    ]);
  }

  // ---- "Bài viết của tôi" (user thường) — chỉ đọc cache ----

  async function renderMyPostsCache(username) {
    const container = el("myPostsCacheList");
    if (!container) return;
    if (!username) {
      container.innerHTML = `<p class="muted">Đăng nhập TechHub để xem bài đã cache.</p>`;
      return;
    }
    try {
      const url =
        `${SUPABASE_CONFIG.url.replace(/\/+$/, "")}/rest/v1/posts` +
        `?username=eq.${encodeURIComponent(username)}&order=created_at.desc&limit=20`;
      const res = await fetch(url, {
        headers: { apikey: SUPABASE_CONFIG.anonKey, Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}` },
      });
      const posts = await res.json();
      if (!posts || posts.length === 0) {
        container.innerHTML = `<p class="muted">Chưa có bài nào trong cache. Mở bài để gửi hint hoặc chờ leader quét.</p>`;
        return;
      }
      container.innerHTML = posts.map((p) => `
        <div class="my-post-item">
          <div class="my-post-title"><a href="${escapeHtml(p.url || "#")}" target="_blank" rel="noreferrer">${escapeHtml(p.title || `#${p.techhub_id}`)}</a></div>
          <div class="my-post-meta">
            ${statusBadge(p.verification_status)}
            <span class="muted">· ${statusBadge(p.discovered_by)}</span>
            <span class="muted">· xác minh ${formatTime(p.last_verified_at)}</span>
            <span class="muted">· 💬 ${p.comments_count || 0} · 👍 ${p.votes_score || 0}</span>
          </div>
        </div>
      `).join("");
    } catch (error) {
      container.innerHTML = `<p class="bad">Không đọc được cache: ${escapeHtml(error.message)}</p>`;
    }
  }

  function bindPostSyncUI() {
    el("postSyncRefreshBtn")?.addEventListener("click", refreshAllPostSync);
    el("postSyncFeedBtn")?.addEventListener("click", requestFeedScan);
    el("postSyncUserBtn")?.addEventListener("click", requestUserScan);
    el("postSyncNewDays")?.addEventListener("change", refreshNewPosts);
    el("postSyncNewFilter")?.addEventListener("change", refreshNewPosts);
    el("postSyncCheckSessionBtn")?.addEventListener("click", async () => {
      if (typeof PostSyncWorker !== "undefined") {
        const r = await PostSyncWorker.checkSessionQuiet();
        flash(r.ok ? "Phiên TechHub ổn." : "Phiên hết hạn.", r.ok ? "ok" : "bad");
      }
    });
  }

  global.PostSyncUI = {
    refreshAllPostSync,
    refreshPostSyncOverview,
    refreshNewPosts,
    refreshRunHistory,
    refreshSources,
    renderMyPostsCache,
    bindPostSyncUI,
    statusBadge,
    formatTime,
    escapeHtml,
    flash,
  };
})(typeof window !== "undefined" ? window : globalThis);
