// Popup — bài của tôi + auto comment/reply + hẹn xóa

const elements = {
  errorSection: document.getElementById("errorSection"),
  errorMessage: document.getElementById("errorMessage"),
  retryBtn: document.getElementById("retryBtn"),
  deniedSection: document.getElementById("deniedSection"),
  adminSection: document.getElementById("adminSection"),
  pageTitle: document.getElementById("pageTitle"),
  pageSubtitle: document.getElementById("pageSubtitle"),
  jobBadge: document.getElementById("jobBadge"),
  userAvatar: document.getElementById("userAvatar"),
  userName: document.getElementById("userName"),
  statPosts: document.getElementById("statPosts"),
  statScore: document.getElementById("statScore"),
  statSelected: document.getElementById("statSelected"),
  statSelectedTitle: document.getElementById("statSelectedTitle"),
  postsSearch: document.getElementById("postsSearch"),
  replyDot: document.getElementById("replyDot"),
  discussionDot: document.getElementById("discussionDot"),
  commentDot: document.getElementById("commentDot"),
  startAutoCommentBtn: document.getElementById("startAutoCommentBtn"),
  stopAutoCommentBtn: document.getElementById("stopAutoCommentBtn"),
  autoCommentMessage: document.getElementById("autoCommentMessage"),
  selectedPostLabel: document.getElementById("selectedPostLabel"),
  autoCommentTargetCount: document.getElementById("autoCommentTargetCount"),
  autoCommentStartAt: document.getElementById("autoCommentStartAt"),
  scheduleAutoCommentBtn: document.getElementById("scheduleAutoCommentBtn"),
  cancelAutoCommentScheduleBtn: document.getElementById("cancelAutoCommentScheduleBtn"),
  autoCommentScheduleInfo: document.getElementById("autoCommentScheduleInfo"),
  syncMyPostsBtn: document.getElementById("syncMyPostsBtn"),
  runAutoReplyBtn: document.getElementById("runAutoReplyBtn"),
  autoReplyEnabled: document.getElementById("autoReplyEnabled"),
  enableAiReply: document.getElementById("enableAiReply"),
  runAutoDiscussionBtn: document.getElementById("runAutoDiscussionBtn"),
  autoDiscussionEnabled: document.getElementById("autoDiscussionEnabled"),
  autoDiscussionMessage: document.getElementById("autoDiscussionMessage"),
  replyScope: document.getElementById("replyScope"),
  replyScopeLabel: document.getElementById("replyScopeLabel"),
  replySelfReplyLimit: document.getElementById("replySelfReplyLimit"),
  discussionScope: document.getElementById("discussionScope"),
  discussionScopeLabel: document.getElementById("discussionScopeLabel"),
  discussionTargetCount: document.getElementById("discussionTargetCount"),
  myPostsList: document.getElementById("myPostsList"),
  autoReplyMessage: document.getElementById("autoReplyMessage"),
  postsMessage: document.getElementById("postsMessage"),
  deleteTechhubId: document.getElementById("deleteTechhubId"),
  deleteAtInput: document.getElementById("deleteAtInput"),
  scheduleDeleteBtn: document.getElementById("scheduleDeleteBtn"),
  deleteNowBtn: document.getElementById("deleteNowBtn"),
  scheduledDeletesList: document.getElementById("scheduledDeletesList"),
  deleteScheduleMessage: document.getElementById("deleteScheduleMessage"),
  openInTabBtn: document.getElementById("openInTabBtn"),
  sideMenu: document.getElementById("sideMenu"),
};

const ACTIVE_PANEL_KEY = "activePanel";

const isTabView = new URLSearchParams(location.search).get("view") === "tab";

let currentUserProfile = null;
let selectedTechhubId = null;
let cachedPosts = [];
let postsFilter = "";
const jobFlags = { comment: false, reply: false, discussion: false };

document.addEventListener("DOMContentLoaded", init);
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "autoCommentProgress") {
    renderAutoCommentStatus(request.state, request.message, request.type);
  }
  if (request.action === "autoReplyProgress") {
    renderAutoReplyStatus(request.state, request.message, request.type);
  }
  if (request.action === "autoDiscussionProgress") {
    renderAutoDiscussionStatus(request.state, request.message, request.type);
  }
  if (request.action === "scheduledDeleteProgress") {
    if (request.items) renderScheduledDeletes(request.items);
    if (request.message) {
      showAdminMsg(
        elements.deleteScheduleMessage,
        request.message,
        request.type || "info"
      );
    }
  }
});

async function init() {
  applyViewMode();
  setupEventListeners();
  await restoreActivePanel();

  if (
    SUPABASE_CONFIG.url === "YOUR_SUPABASE_URL" ||
    SUPABASE_CONFIG.anonKey === "YOUR_SUPABASE_ANON_KEY"
  ) {
    showError("Vui lòng cấu hình Supabase trong config.js");
    return;
  }

  await loadAdminGate();
}

function applyViewMode() {
  if (!isTabView) return;
  document.body.classList.add("view-tab");
  elements.openInTabBtn?.classList.add("hidden");
}

function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("vi-VN");
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleTimeString("vi-VN");
}

function setJobFlag(name, active) {
  jobFlags[name] = !!active;
  const dots = {
    comment: elements.commentDot,
    reply: elements.replyDot,
    discussion: elements.discussionDot,
  };
  dots[name]?.classList.toggle("hidden", !jobFlags[name]);

  const running = [
    jobFlags.comment ? "auto comment" : null,
    jobFlags.reply ? "AI trả lời" : null,
    jobFlags.discussion ? "AI thảo luận" : null,
  ].filter(Boolean);

  if (!elements.jobBadge) return;
  elements.jobBadge.textContent = running.length
    ? `Đang chạy: ${running.join(" · ")}`
    : "Chưa có job chạy";
  elements.jobBadge.classList.toggle("pill-live", running.length > 0);
  elements.jobBadge.classList.toggle("pill-muted", running.length === 0);
}

function renderUserChip() {
  const username = currentUserProfile?.username;
  if (elements.userName) {
    elements.userName.textContent = username ? `@${username}` : "Chưa đăng nhập";
  }
  if (elements.userAvatar) {
    elements.userAvatar.textContent = username ? username.slice(0, 2) : "?";
  }
}

async function openInTab() {
  const url = chrome.runtime.getURL("popup.html?view=tab");
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("popup.html") + "*" });
  const existing = tabs.find((tab) => tab.url === url);
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url, active: true });
  }
  try {
    window.close();
  } catch {
    // Side panel không đóng được bằng window.close()
  }
}

function showPanel(name, persist = true) {
  const panels = document.querySelectorAll(".panel");
  const target = Array.from(panels).find((panel) => panel.dataset.panel === name);
  if (!target) return;

  panels.forEach((panel) => panel.classList.toggle("hidden", panel !== target));
  document.querySelectorAll(".nav-item").forEach((item) => {
    const active = item.dataset.panel === name;
    item.classList.toggle("active", active);
    if (active) {
      if (elements.pageTitle) elements.pageTitle.textContent = item.dataset.title || name;
      if (elements.pageSubtitle) {
        elements.pageSubtitle.textContent = item.dataset.subtitle || "";
      }
    }
  });

  if (persist) {
    chrome.storage.local.set({ [ACTIVE_PANEL_KEY]: name }).catch(() => {});
  }
}

async function restoreActivePanel() {
  try {
    const stored = await chrome.storage.local.get(ACTIVE_PANEL_KEY);
    if (stored[ACTIVE_PANEL_KEY]) {
      showPanel(stored[ACTIVE_PANEL_KEY], false);
    }
  } catch {
    // Giữ panel mặc định
  }
}

function setupEventListeners() {
  if (elements.sideMenu) {
    elements.sideMenu.addEventListener("click", (event) => {
      const item = event.target.closest(".nav-item[data-panel]");
      if (item) showPanel(item.dataset.panel);
    });
  }
  if (elements.postsSearch) {
    elements.postsSearch.addEventListener("input", () => {
      postsFilter = elements.postsSearch.value.trim().toLowerCase();
      renderMyPosts(cachedPosts);
    });
  }
  if (elements.scheduleAutoCommentBtn) {
    elements.scheduleAutoCommentBtn.addEventListener("click", scheduleAutoComment);
  }
  if (elements.cancelAutoCommentScheduleBtn) {
    elements.cancelAutoCommentScheduleBtn.addEventListener(
      "click",
      cancelAutoCommentSchedule
    );
  }
  if (elements.openInTabBtn) {
    elements.openInTabBtn.addEventListener("click", () => {
      openInTab().catch((error) => {
        showAdminMsg(elements.postsMessage, `Lỗi mở tab: ${error.message}`, "error");
      });
    });
  }
  if (elements.retryBtn) {
    elements.retryBtn.addEventListener("click", () => {
      hideAllStates();
      loadAdminGate();
    });
  }
  if (elements.startAutoCommentBtn) {
    elements.startAutoCommentBtn.addEventListener("click", startAutoComment);
  }
  if (elements.stopAutoCommentBtn) {
    elements.stopAutoCommentBtn.addEventListener("click", stopAutoComment);
  }
  if (elements.syncMyPostsBtn) {
    elements.syncMyPostsBtn.addEventListener("click", syncMyPosts);
  }
  if (elements.runAutoReplyBtn) {
    elements.runAutoReplyBtn.addEventListener("click", runAutoReplyOnce);
  }
  if (elements.autoReplyEnabled) {
    elements.autoReplyEnabled.addEventListener("change", toggleAutoReply);
  }
  if (elements.enableAiReply) {
    elements.enableAiReply.addEventListener("change", toggleAutoReply);
  }
  if (elements.runAutoDiscussionBtn) {
    elements.runAutoDiscussionBtn.addEventListener("click", runAutoDiscussionOnce);
  }
  if (elements.autoDiscussionEnabled) {
    elements.autoDiscussionEnabled.addEventListener("change", toggleAutoDiscussion);
  }
  if (elements.replyScope) {
    elements.replyScope.addEventListener("change", () => {
      updateScopeLabels();
      if (elements.autoReplyEnabled?.checked) toggleAutoReply();
    });
  }
  if (elements.discussionScope) {
    elements.discussionScope.addEventListener("change", () => {
      updateScopeLabels();
      if (elements.autoDiscussionEnabled?.checked) toggleAutoDiscussion();
    });
  }
  if (elements.replySelfReplyLimit) {
    elements.replySelfReplyLimit.addEventListener("change", () => {
      if (elements.autoReplyEnabled?.checked) toggleAutoReply();
    });
  }
  if (elements.discussionTargetCount) {
    elements.discussionTargetCount.addEventListener("change", () => {
      if (elements.autoDiscussionEnabled?.checked) toggleAutoDiscussion();
    });
  }
  if (elements.myPostsList) {
    elements.myPostsList.addEventListener("click", (event) => {
      const selectBtn = event.target.closest("[data-select-id]");
      if (selectBtn) {
        event.preventDefault();
        selectPost(Number(selectBtn.dataset.selectId));
        return;
      }
      // Thẻ <a> tự mở tab mới, không cần xử lý thêm
    });
  }
  if (elements.scheduleDeleteBtn) {
    elements.scheduleDeleteBtn.addEventListener("click", scheduleDeletePost);
  }
  if (elements.deleteNowBtn) {
    elements.deleteNowBtn.addEventListener("click", deletePostNow);
  }
  if (elements.scheduledDeletesList) {
    elements.scheduledDeletesList.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-cancel-id]");
      if (!btn) return;
      cancelScheduledDelete(Number(btn.dataset.cancelId));
    });
  }
}

function hideAllStates() {
  elements.errorSection.classList.add("hidden");
  elements.deniedSection.classList.add("hidden");
  elements.adminSection.classList.add("hidden");
}

function showError(message) {
  hideAllStates();
  elements.errorSection.classList.remove("hidden");
  elements.errorMessage.textContent = message;
}

function showDenied() {
  hideAllStates();
  elements.deniedSection.classList.remove("hidden");
}

function showAdmin() {
  hideAllStates();
  elements.adminSection.classList.remove("hidden");
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

async function loadAdminGate() {
  try {
    const profileResponse = await sendMessage({ action: "getUserProfile" });
    if (!profileResponse.success || !profileResponse.userProfile) {
      showError(
        profileResponse.error ||
          "Không tìm thấy profile. Mở TechHub và đăng nhập trước."
      );
      return;
    }

    currentUserProfile = profileResponse.userProfile;
    const username = currentUserProfile.username;
    renderUserChip();

    const isConnected = await supabase.testConnection();
    if (!isConnected) {
      throw new Error("Không kết nối được Supabase (kiểm tra mạng/proxy).");
    }

    const dbUser = await supabase.findUserByUsername(username);
    if (!dbUser || !dbUser.is_admin) {
      showDenied();
      return;
    }

    showAdmin();
    setDefaultDeleteAt();
    setDefaultAutoCommentStartAt();
    await loadAutoCommentStatus();
    await loadMyPosts();
    await loadAutoReplyStatus();
    await loadAutoDiscussionStatus();
    await loadScheduledDeletes();
  } catch (error) {
    showError("Lỗi: " + error.message);
  }
}

function showAdminMsg(el, text, type = "info") {
  if (!el) return;
  el.classList.remove("hidden", "ok", "err", "muted", "info");
  el.classList.add(
    type === "error" ? "err" : type === "success" ? "ok" : type === "muted" ? "muted" : "info"
  );
  el.textContent = text;
}

function selectPost(techhubId) {
  if (!Number.isInteger(techhubId) || techhubId < 1) return;
  selectedTechhubId = techhubId;
  if (elements.deleteTechhubId) {
    elements.deleteTechhubId.value = String(techhubId);
  }
  renderMyPosts(cachedPosts);
  updateSelectedPostLabel(true);
  updateScopeLabels();
}

/**
 * techhub_id để chạy job AI: null = tất cả bài
 */
function resolveScopeTechhubId(selectEl) {
  if (selectEl?.value !== "selected") return null;
  return Number.isInteger(selectedTechhubId) ? selectedTechhubId : null;
}

function describeScope(selectEl) {
  if (selectEl?.value !== "selected") return "Phạm vi: tất cả bài";
  if (!Number.isInteger(selectedTechhubId)) {
    return 'Phạm vi: chưa chọn bài — bấm Chọn ở tab "Bài của tôi"';
  }
  const post = cachedPosts.find((p) => Number(p.techhub_id) === selectedTechhubId);
  return `Phạm vi: chỉ bài #${selectedTechhubId}${post?.title ? ` · ${post.title}` : ""}`;
}

function updateScopeLabels() {
  const replyText = describeScope(elements.replyScope);
  const discussionText = describeScope(elements.discussionScope);
  showAdminMsg(
    elements.replyScopeLabel,
    replyText,
    replyText.includes("chưa chọn") ? "error" : "muted"
  );
  showAdminMsg(
    elements.discussionScopeLabel,
    discussionText,
    discussionText.includes("chưa chọn") ? "error" : "muted"
  );
}

function updateSelectedPostLabel(notify = false) {
  const post = cachedPosts.find((p) => Number(p.techhub_id) === selectedTechhubId);
  if (elements.statSelected) {
    elements.statSelected.textContent = post ? `#${post.techhub_id}` : "—";
  }
  if (elements.statSelectedTitle) {
    elements.statSelectedTitle.textContent = post
      ? post.title || "(không tiêu đề)"
      : "Chưa chọn bài nào";
  }

  if (!post) {
    showAdminMsg(elements.selectedPostLabel, "Chưa chọn bài", "muted");
    return;
  }
  const detail = `#${post.techhub_id} · ${post.status || "-"} · cmt=${
    post.comments_count ?? 0
  } · vote=${post.votes_score ?? 0} · medal=${post.medals_count ?? 0} · điểm=${formatPostScore(
    calcPostScore(post)
  )} · ${post.title || ""}`;
  showAdminMsg(elements.selectedPostLabel, `Đã chọn ${detail}`, "info");
  if (notify) {
    showAdminMsg(
      elements.postsMessage,
      `Đã chọn ${detail} — dùng cho Auto comment / Hẹn xóa bài / phạm vi AI.`,
      "success"
    );
  }
}

function renderAutoCommentSchedule(schedule) {
  if (!elements.autoCommentScheduleInfo) return;
  const hasSchedule = !!schedule?.techhubId && !!schedule?.startAt;
  if (elements.cancelAutoCommentScheduleBtn) {
    elements.cancelAutoCommentScheduleBtn.disabled = !hasSchedule;
  }
  if (!hasSchedule) {
    showAdminMsg(elements.autoCommentScheduleInfo, "Chưa có lịch hẹn.", "muted");
    return;
  }
  const base =
    `Đã hẹn bài #${schedule.techhubId} lúc ${formatDateTime(schedule.startAt)}` +
    ` · mục tiêu ${schedule.targetCount || "?"} cmt`;
  showAdminMsg(
    elements.autoCommentScheduleInfo,
    schedule.lastError ? `${base} · lỗi lần trước: ${schedule.lastError}` : base,
    schedule.lastError ? "error" : "info"
  );
}

function renderAutoCommentStatus(state, message = "", type = "info") {
  if (!state) return;
  elements.startAutoCommentBtn.disabled = !!state.active;
  elements.stopAutoCommentBtn.disabled = !state.active;
  setJobFlag("comment", !!state.active);
  renderAutoCommentSchedule(state.schedule);

  if (state.techhubId) {
    selectedTechhubId = Number(state.techhubId);
    renderMyPosts(cachedPosts);
    updateSelectedPostLabel();
  }

  const statusText = state.active ? "Đang chạy" : "Đã dừng";
  const detail = state.techhubId
    ? `${statusText} · bài #${state.techhubId} · ${state.commentCount || 0}/${
        state.targetCount || "?"
      } cmt · @${state.username || "-"}`
    : statusText;
  if (state.targetCount && elements.autoCommentTargetCount) {
    elements.autoCommentTargetCount.value = String(state.targetCount);
  }
  showAdminMsg(
    elements.autoCommentMessage,
    message ? `${message} ${detail}` : detail,
    state.lastError ? "error" : type
  );
}

async function loadAutoCommentStatus() {
  try {
    const response = await sendMessage({ action: "getAutoCommentStatus" });
    if (!response?.success) {
      throw new Error(response?.error || "Không đọc được trạng thái");
    }
    renderAutoCommentStatus(response.state, "", response.state.active ? "success" : "muted");
  } catch (error) {
    showAdminMsg(
      elements.autoCommentMessage,
      `Lỗi đọc trạng thái auto comment: ${error.message}`,
      "error"
    );
  }
}

async function startAutoComment() {
  const techhubId = Number(selectedTechhubId);
  if (!Number.isInteger(techhubId) || techhubId < 1) {
    showAdminMsg(elements.autoCommentMessage, "Bấm Chọn trên 1 bài trước", "error");
    return;
  }
  const targetCount = Number(elements.autoCommentTargetCount?.value);
  if (!Number.isInteger(targetCount) || targetCount < 1) {
    showAdminMsg(elements.autoCommentMessage, "Nhập số lượng cmt mong muốn (>= 1)", "error");
    return;
  }

  const confirmed = window.confirm(
    `Bắt đầu comment vào bài #${techhubId}, tối đa ${targetCount} cmt (random 2–5 giây)?\n\n` +
      "Tần suất này có thể khiến TechHub giới hạn tài khoản."
  );
  if (!confirmed) return;

  elements.startAutoCommentBtn.disabled = true;
  try {
    showAdminMsg(elements.autoCommentMessage, "Đang khởi động...", "muted");
    const response = await sendMessage({
      action: "startAutoComment",
      techhubId,
      targetCount,
    });
    if (!response?.success) {
      throw new Error(response?.error || "Không thể bắt đầu auto comment");
    }
    renderAutoCommentStatus(response.state, "Đã khởi động.", "success");
  } catch (error) {
    showAdminMsg(elements.autoCommentMessage, `Lỗi: ${error.message}`, "error");
    elements.startAutoCommentBtn.disabled = false;
  }
}

function setDefaultAutoCommentStartAt() {
  if (!elements.autoCommentStartAt || elements.autoCommentStartAt.value) return;
  elements.autoCommentStartAt.value = toLocalInputValue(new Date(Date.now() + 10 * 60 * 1000));
}

async function scheduleAutoComment() {
  const techhubId = Number(selectedTechhubId);
  if (!Number.isInteger(techhubId) || techhubId < 1) {
    showAdminMsg(elements.autoCommentMessage, "Bấm Chọn trên 1 bài trước", "error");
    return;
  }
  const targetCount = Number(elements.autoCommentTargetCount?.value);
  if (!Number.isInteger(targetCount) || targetCount < 1) {
    showAdminMsg(elements.autoCommentMessage, "Nhập số lượng cmt mong muốn (>= 1)", "error");
    return;
  }
  const startAtValue = elements.autoCommentStartAt?.value;
  if (!startAtValue) {
    showAdminMsg(elements.autoCommentMessage, "Chọn giờ bắt đầu", "error");
    return;
  }
  const startAt = new Date(startAtValue);
  if (Number.isNaN(startAt.getTime()) || startAt.getTime() <= Date.now()) {
    showAdminMsg(elements.autoCommentMessage, "Giờ bắt đầu phải ở tương lai", "error");
    return;
  }

  elements.scheduleAutoCommentBtn.disabled = true;
  try {
    const response = await sendMessage({
      action: "scheduleAutoComment",
      techhubId,
      targetCount,
      startAt: startAt.toISOString(),
    });
    if (!response?.success) throw new Error(response?.error || "Không hẹn được");
    renderAutoCommentStatus(
      response.state,
      `Đã hẹn chạy lúc ${formatTime(startAt)}.`,
      "success"
    );
  } catch (error) {
    showAdminMsg(elements.autoCommentMessage, `Lỗi: ${error.message}`, "error");
  } finally {
    elements.scheduleAutoCommentBtn.disabled = false;
  }
}

async function cancelAutoCommentSchedule() {
  elements.cancelAutoCommentScheduleBtn.disabled = true;
  try {
    const response = await sendMessage({ action: "cancelAutoCommentSchedule" });
    if (!response?.success) throw new Error(response?.error || "Không hủy được");
    renderAutoCommentStatus(response.state, "Đã hủy lịch hẹn.", "muted");
  } catch (error) {
    showAdminMsg(elements.autoCommentMessage, `Lỗi: ${error.message}`, "error");
    elements.cancelAutoCommentScheduleBtn.disabled = false;
  }
}

async function stopAutoComment() {
  elements.stopAutoCommentBtn.disabled = true;
  try {
    const response = await sendMessage({ action: "stopAutoComment" });
    if (!response?.success) {
      throw new Error(response?.error || "Không thể dừng auto comment");
    }
    renderAutoCommentStatus(response.state, "Đã dừng.", "muted");
  } catch (error) {
    showAdminMsg(elements.autoCommentMessage, `Lỗi: ${error.message}`, "error");
    elements.stopAutoCommentBtn.disabled = false;
  }
}

function formatRelativeDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 1) return "vừa xong";
  if (diffMinutes < 60) return `${diffMinutes} phút trước`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays} ngày trước`;
  return date.toLocaleDateString();
}

function calcPostScore(post) {
  const comments = Number(post?.comments_count) || 0;
  const votes = Number(post?.votes_score) || 0;
  const medals = Number(post?.medals_count) || 0;
  return comments * 0.2 + votes * 0.1 + medals * 6;
}

function formatPostScore(score) {
  return Number(score).toFixed(1);
}

function renderMyPosts(posts) {
  cachedPosts = Array.isArray(posts) ? posts : [];
  if (!elements.myPostsList) return;

  const totalScore = cachedPosts.reduce((sum, p) => sum + calcPostScore(p), 0);
  if (elements.statPosts) elements.statPosts.textContent = String(cachedPosts.length);
  if (elements.statScore) elements.statScore.textContent = formatPostScore(totalScore);

  if (cachedPosts.length === 0) {
    elements.myPostsList.innerHTML =
      '<div class="empty">Chưa có bài trong DB. Bấm <strong>Quét bài</strong> để đồng bộ.</div>';
    updateSelectedPostLabel();
    return;
  }

  const visible = postsFilter
    ? cachedPosts.filter((p) => {
        const title = String(p.title || "").toLowerCase();
        return title.includes(postsFilter) || String(p.techhub_id).includes(postsFilter);
      })
    : cachedPosts;

  if (visible.length === 0) {
    elements.myPostsList.innerHTML = `<div class="empty">Không có bài nào khớp "${escapeHtml(
      postsFilter
    )}".</div>`;
    updateSelectedPostLabel();
    return;
  }

  const rows = visible
    .map((p) => {
      const id = Number(p.techhub_id);
      const selected = id === selectedTechhubId;
      const title = escapeHtml(p.title || "(không tiêu đề)");
      const status = escapeHtml(p.status || "-");
      const statusClass = status === "open" ? "open" : "other";
      const url = escapeHtml(resolvePostUrl(p));
      const comments = Number(p.comments_count) || 0;
      const votes = Number(p.votes_score) || 0;
      const medals = Number(p.medals_count) || 0;
      const score = formatPostScore(calcPostScore(p));
      return (
        `<tr class="${selected ? "selected" : ""}" data-techhub-id="${id}">` +
        `<td class="cell-title">` +
        `<a class="post-link" href="${url}" target="_blank" rel="noopener noreferrer" title="Mở trên TechHub">${title}</a>` +
        `<div class="post-sub"><span>#${id}</span><span>@${escapeHtml(
          p.username || "-"
        )}</span></div>` +
        `</td>` +
        `<td data-label="Điểm"><span class="score">${score}</span></td>` +
        `<td data-label="Medal"><span class="num">${medals}</span></td>` +
        `<td data-label="Vote"><span class="num">${votes}</span></td>` +
        `<td data-label="Cmt"><span class="num">${comments}</span></td>` +
        `<td data-label="Trạng thái"><span class="badge ${statusClass}">${status}</span></td>` +
        `<td class="cell-date" data-label="Ngày tạo">${escapeHtml(
          formatRelativeDate(p.created_at)
        )}</td>` +
        `<td class="cell-action">` +
        `<button type="button" class="mini-btn${
          selected ? " is-selected" : ""
        }" data-select-id="${id}">${selected ? "Đang chọn" : "Chọn"}</button>` +
        `</td>` +
        `</tr>`
      );
    })
    .join("");

  elements.myPostsList.innerHTML =
    '<table class="data-table"><thead><tr>' +
    "<th>Tiêu đề</th><th>Điểm</th><th>Medal</th><th>Vote</th><th>Cmt</th>" +
    "<th>Trạng thái</th><th>Ngày tạo</th><th></th>" +
    `</tr></thead><tbody>${rows}</tbody></table>`;
  updateSelectedPostLabel();
}

function resolvePostUrl(post) {
  if (post?.url && String(post.url).startsWith("http")) return post.url;
  if (post?.techhub_uuid) {
    return `https://techhub.fpt.net/p/${encodeURIComponent(post.username || "u")}/${post.techhub_uuid}`;
  }
  return `https://techhub.fpt.net/`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadMyPosts() {
  try {
    const response = await sendMessage({ action: "getMyPosts" });
    if (!response?.success) throw new Error(response?.error || "Không đọc được bài");
    renderMyPosts(response.posts || []);
  } catch (error) {
    elements.myPostsList.innerHTML = `<div class="empty">Lỗi tải bài: ${escapeHtml(
      error.message
    )}</div>`;
  }
}

async function syncMyPosts() {
  elements.syncMyPostsBtn.disabled = true;
  try {
    showAdminMsg(elements.postsMessage, "Đang quét bài từ TechHub...", "muted");
    const response = await sendMessage({ action: "syncMyPosts" });
    if (!response?.success) throw new Error(response?.error || "Quét bài thất bại");
    renderMyPosts(response.posts || []);
    showAdminMsg(
      elements.postsMessage,
      response.message || `Đã sync bài của @${response.username || "-"}`,
      "success"
    );
  } catch (error) {
    showAdminMsg(elements.postsMessage, `Lỗi quét bài: ${error.message}`, "error");
  } finally {
    elements.syncMyPostsBtn.disabled = false;
  }
}

function renderAutoReplyStatus(state, message = "", type = "info") {
  if (!state) return;
  if (elements.autoReplyEnabled) {
    elements.autoReplyEnabled.checked = !!state.enabled;
  }
  if (elements.enableAiReply && typeof state.useAi === "boolean") {
    elements.enableAiReply.checked = !!state.useAi;
  }
  if (state.targetTechhubId) {
    selectedTechhubId = Number(state.targetTechhubId);
    if (elements.replyScope) elements.replyScope.value = "selected";
  }
  if (elements.replySelfReplyLimit && state.maxConsecutiveSelfReplies) {
    elements.replySelfReplyLimit.value = String(state.maxConsecutiveSelfReplies);
  }
  setJobFlag("reply", !!state.enabled);
  updateScopeLabels();

  const mode = state.useAi ? "AI" : "template";
  const scope = state.targetTechhubId ? `bài #${state.targetTechhubId}` : "tất cả bài";
  const selfInfo =
    Number(state.maxConsecutiveSelfReplies) > 1
      ? ` · nối lượt của tôi ≤${state.maxConsecutiveSelfReplies}`
      : "";
  const detail = state.enabled
    ? `Đang bật · ${mode} · ${scope}${selfInfo}`
    : `Đang tắt · ${mode} · ${scope}${selfInfo}`;
  const runInfo = state.lastRunAt
    ? ` · lần chạy ${new Date(state.lastRunAt).toLocaleString()} · reply=${state.lastReplyCount || 0}`
    : "";
  showAdminMsg(
    elements.autoReplyMessage,
    message ? `${message} (${detail}${runInfo})` : `${detail}${runInfo}`,
    state.lastError ? "error" : type
  );
}

async function loadAutoReplyStatus() {
  try {
    const response = await sendMessage({ action: "getAutoReplyStatus" });
    if (!response?.success) throw new Error(response?.error || "Không đọc được trạng thái");
    renderAutoReplyStatus(
      response.state,
      response.state.lastMessage || "",
      response.state.enabled ? "success" : "muted"
    );
  } catch (error) {
    showAdminMsg(elements.autoReplyMessage, `Lỗi: ${error.message}`, "error");
  }
}

async function toggleAutoReply() {
  const enabled = !!elements.autoReplyEnabled.checked;
  const useAi = !!elements.enableAiReply?.checked;
  const techhubId = resolveScopeTechhubId(elements.replyScope);
  const maxConsecutiveSelfReplies = Number(elements.replySelfReplyLimit?.value) || 1;
  if (enabled && elements.replyScope?.value === "selected" && !techhubId) {
    elements.autoReplyEnabled.checked = false;
    showAdminMsg(
      elements.autoReplyMessage,
      'Chưa chọn bài — bấm Chọn ở tab "Bài của tôi" hoặc đổi phạm vi sang tất cả bài.',
      "error"
    );
    return;
  }
  elements.autoReplyEnabled.disabled = true;
  if (elements.enableAiReply) elements.enableAiReply.disabled = true;
  try {
    const response = await sendMessage({
      action: "setAutoReplyEnabled",
      enabled,
      useAi,
      techhubId,
      maxConsecutiveSelfReplies,
    });
    if (!response?.success) throw new Error(response?.error || "Không cập nhật được");
    renderAutoReplyStatus(
      response.state,
      response.state.lastMessage || "",
      enabled ? "success" : "muted"
    );
  } catch (error) {
    elements.autoReplyEnabled.checked = !enabled;
    showAdminMsg(elements.autoReplyMessage, `Lỗi: ${error.message}`, "error");
  } finally {
    elements.autoReplyEnabled.disabled = false;
    if (elements.enableAiReply) elements.enableAiReply.disabled = false;
  }
}

async function runAutoReplyOnce() {
  const techhubId = resolveScopeTechhubId(elements.replyScope);
  if (elements.replyScope?.value === "selected" && !techhubId) {
    showAdminMsg(
      elements.autoReplyMessage,
      'Chưa chọn bài — bấm Chọn ở tab "Bài của tôi".',
      "error"
    );
    return;
  }
  elements.runAutoReplyBtn.disabled = true;
  try {
    showAdminMsg(elements.autoReplyMessage, "Đang chạy auto-reply...", "muted");
    const response = await sendMessage({
      action: "runAutoReplyOnce",
      techhubId,
      maxConsecutiveSelfReplies: Number(elements.replySelfReplyLimit?.value) || 1,
    });
    if (!response?.success) {
      renderAutoReplyStatus(response?.state, response?.error || "Thất bại", "error");
      throw new Error(response?.error || "Auto-reply thất bại");
    }
    renderAutoReplyStatus(response.state, response.message || "Xong.", "success");
  } catch (error) {
    showAdminMsg(elements.autoReplyMessage, `Lỗi: ${error.message}`, "error");
  } finally {
    elements.runAutoReplyBtn.disabled = false;
  }
}

function renderAutoDiscussionStatus(state, message = "", type = "info") {
  if (!state) return;
  if (elements.autoDiscussionEnabled) {
    elements.autoDiscussionEnabled.checked = !!state.enabled;
  }
  if (state.targetTechhubId) {
    selectedTechhubId = Number(state.targetTechhubId);
    if (elements.discussionScope) elements.discussionScope.value = "selected";
  }
  if (elements.discussionTargetCount && state.targetCount) {
    elements.discussionTargetCount.value = String(state.targetCount);
  }
  setJobFlag("discussion", !!state.enabled);
  updateScopeLabels();

  const scope = state.targetTechhubId ? `bài #${state.targetTechhubId}` : "tất cả bài";
  const target = Number(state.targetCount) || 5;
  const detail =
    `${state.enabled ? "Đang bật" : "Đang tắt"} · ${scope} · mục tiêu ${target}/bài` +
    (state.nextRunAt
      ? ` · lượt tới ${new Date(state.nextRunAt).toLocaleTimeString()}`
      : "");
  const runInfo = state.lastRunAt
    ? ` · lần chạy ${new Date(state.lastRunAt).toLocaleString()} · comment=${
        state.lastDiscussionCount || 0
      }`
    : "";
  showAdminMsg(
    elements.autoDiscussionMessage,
    message ? `${message} (${detail}${runInfo})` : `${detail}${runInfo}`,
    state.lastError ? "error" : type
  );
}

async function loadAutoDiscussionStatus() {
  try {
    const response = await sendMessage({ action: "getAutoDiscussionStatus" });
    if (!response?.success) throw new Error(response?.error || "Không đọc được trạng thái");
    renderAutoDiscussionStatus(
      response.state,
      response.state.lastMessage || "",
      response.state.enabled ? "success" : "muted"
    );
  } catch (error) {
    showAdminMsg(elements.autoDiscussionMessage, `Lỗi: ${error.message}`, "error");
  }
}

async function toggleAutoDiscussion() {
  const enabled = !!elements.autoDiscussionEnabled.checked;
  const techhubId = resolveScopeTechhubId(elements.discussionScope);
  const targetCount = Number(elements.discussionTargetCount?.value) || 5;
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 100) {
    elements.autoDiscussionEnabled.checked = false;
    showAdminMsg(
      elements.autoDiscussionMessage,
      "Số lần tự thảo luận phải từ 1 đến 100.",
      "error"
    );
    return;
  }
  if (enabled && elements.discussionScope?.value === "selected" && !techhubId) {
    elements.autoDiscussionEnabled.checked = false;
    showAdminMsg(
      elements.autoDiscussionMessage,
      'Chưa chọn bài — bấm Chọn ở tab "Bài của tôi" hoặc đổi phạm vi sang tất cả bài.',
      "error"
    );
    return;
  }
  elements.autoDiscussionEnabled.disabled = true;
  try {
    const response = await sendMessage({
      action: "setAutoDiscussionEnabled",
      enabled,
      techhubId,
      targetCount,
    });
    if (!response?.success) throw new Error(response?.error || "Không cập nhật được");
    renderAutoDiscussionStatus(
      response.state,
      response.state.lastMessage || "",
      enabled ? "success" : "muted"
    );
  } catch (error) {
    elements.autoDiscussionEnabled.checked = !enabled;
    showAdminMsg(elements.autoDiscussionMessage, `Lỗi: ${error.message}`, "error");
  } finally {
    elements.autoDiscussionEnabled.disabled = false;
  }
}

async function runAutoDiscussionOnce() {
  const techhubId = resolveScopeTechhubId(elements.discussionScope);
  const targetCount = Number(elements.discussionTargetCount?.value) || 5;
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 100) {
    showAdminMsg(
      elements.autoDiscussionMessage,
      "Số lần tự thảo luận phải từ 1 đến 100.",
      "error"
    );
    return;
  }
  if (elements.discussionScope?.value === "selected" && !techhubId) {
    showAdminMsg(
      elements.autoDiscussionMessage,
      'Chưa chọn bài — bấm Chọn ở tab "Bài của tôi".',
      "error"
    );
    return;
  }
  elements.runAutoDiscussionBtn.disabled = true;
  try {
    showAdminMsg(elements.autoDiscussionMessage, "Đang sinh thảo luận AI...", "muted");
    const response = await sendMessage({
      action: "runAutoDiscussionOnce",
      techhubId,
      targetCount,
    });
    if (!response?.success) {
      renderAutoDiscussionStatus(response?.state, response?.error || "Thất bại", "error");
      throw new Error(response?.error || "AI thảo luận thất bại");
    }
    renderAutoDiscussionStatus(response.state, response.message || "Xong.", "success");
  } catch (error) {
    showAdminMsg(elements.autoDiscussionMessage, `Lỗi: ${error.message}`, "error");
  } finally {
    elements.runAutoDiscussionBtn.disabled = false;
  }
}

function setDefaultDeleteAt() {
  if (!elements.deleteAtInput) return;
  elements.deleteAtInput.value = toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000));
}

function renderScheduledDeletes(items) {
  if (!elements.scheduledDeletesList) return;
  const list = Array.isArray(items) ? items : [];
  const pending = list.filter((i) => i.status === "pending");
  const recent = list.filter((i) => i.status !== "pending").slice(0, 5);

  if (pending.length === 0 && recent.length === 0) {
    elements.scheduledDeletesList.innerHTML =
      '<div class="empty">Chưa có lịch xóa nào.</div>';
    return;
  }

  const pendingHtml = pending
    .map((i) => {
      const when = formatDateTime(i.deleteAt);
      const title = escapeHtml(i.title || "");
      return (
        `<div class="schedule-item pending">` +
        `<div class="schedule-main">` +
        `<div class="schedule-title">#${i.techhubId} · ${title}</div>` +
        `<div class="schedule-meta">Hẹn xóa: ${escapeHtml(when)}</div>` +
        `</div>` +
        `<button type="button" class="mini-btn" data-cancel-id="${i.techhubId}">Hủy</button>` +
        `</div>`
      );
    })
    .join("");

  const recentHtml = recent
    .map((i) => {
      const when = formatDateTime(i.completedAt || i.deleteAt);
      const statusLabel = i.status === "done" ? "đã xóa" : "lỗi";
      const err = i.lastError ? ` · ${escapeHtml(i.lastError)}` : "";
      return (
        `<div class="schedule-item ${i.status}">` +
        `<div class="schedule-main">` +
        `<div class="schedule-title">#${i.techhubId} · ${statusLabel}</div>` +
        `<div class="schedule-meta">${escapeHtml(when)}${err}</div>` +
        `</div>` +
        `</div>`
      );
    })
    .join("");

  elements.scheduledDeletesList.innerHTML =
    (pending.length
      ? `<div class="list-label">${pending.length} lịch đang chờ</div>${pendingHtml}`
      : "") +
    (recent.length ? `<div class="list-label">Lịch sử gần đây</div>${recentHtml}` : "");
}

async function loadScheduledDeletes() {
  try {
    const response = await sendMessage({ action: "getScheduledDeletes" });
    if (!response?.success) throw new Error(response?.error || "Không đọc được lịch xóa");
    renderScheduledDeletes(response.items || []);
  } catch (error) {
    showAdminMsg(elements.deleteScheduleMessage, `Lỗi: ${error.message}`, "error");
  }
}

async function scheduleDeletePost() {
  const techhubId = Number(elements.deleteTechhubId.value);
  const deleteAt = elements.deleteAtInput.value;
  if (!Number.isInteger(techhubId) || techhubId < 1) {
    showAdminMsg(elements.deleteScheduleMessage, "Nhập techhub_id hợp lệ", "error");
    return;
  }
  if (!deleteAt) {
    showAdminMsg(elements.deleteScheduleMessage, "Chọn thời gian xóa", "error");
    return;
  }

  const confirmed = window.confirm(
    `Hẹn xóa bài #${techhubId} lúc ${new Date(deleteAt).toLocaleString()}?\n\n` +
      "Bài sẽ bị xóa trên TechHub khi đến giờ."
  );
  if (!confirmed) return;

  elements.scheduleDeleteBtn.disabled = true;
  try {
    const response = await sendMessage({
      action: "scheduleDeletePost",
      techhubId,
      deleteAt: new Date(deleteAt).toISOString(),
    });
    if (!response?.success) throw new Error(response?.error || "Không hẹn được");
    renderScheduledDeletes(response.items || []);
    showAdminMsg(elements.deleteScheduleMessage, response.message || "Đã hẹn xóa", "success");
  } catch (error) {
    showAdminMsg(elements.deleteScheduleMessage, `Lỗi: ${error.message}`, "error");
  } finally {
    elements.scheduleDeleteBtn.disabled = false;
  }
}

async function deletePostNow() {
  const techhubId = Number(elements.deleteTechhubId.value);
  if (!Number.isInteger(techhubId) || techhubId < 1) {
    showAdminMsg(elements.deleteScheduleMessage, "Nhập techhub_id hợp lệ", "error");
    return;
  }
  const confirmed = window.confirm(
    `XÓA NGAY bài #${techhubId} trên TechHub?\n\nKhông hoàn tác được.`
  );
  if (!confirmed) return;

  elements.deleteNowBtn.disabled = true;
  try {
    const response = await sendMessage({ action: "deletePostNow", techhubId });
    if (!response?.success) throw new Error(response?.error || "Xóa thất bại");
    renderScheduledDeletes(response.items || []);
    showAdminMsg(elements.deleteScheduleMessage, response.message || "Đã xóa", "success");
    await loadMyPosts();
  } catch (error) {
    showAdminMsg(elements.deleteScheduleMessage, `Lỗi: ${error.message}`, "error");
  } finally {
    elements.deleteNowBtn.disabled = false;
  }
}

async function cancelScheduledDelete(techhubId) {
  try {
    const response = await sendMessage({ action: "cancelScheduledDelete", techhubId });
    if (!response?.success) throw new Error(response?.error || "Hủy thất bại");
    renderScheduledDeletes(response.items || []);
    showAdminMsg(elements.deleteScheduleMessage, response.message || "Đã hủy", "muted");
  } catch (error) {
    showAdminMsg(elements.deleteScheduleMessage, `Lỗi: ${error.message}`, "error");
  }
}
