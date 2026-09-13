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
  postsUltraNotice: document.getElementById("postsUltraNotice"),
  replyDot: document.getElementById("replyDot"),
  discussionDot: document.getElementById("discussionDot"),
  commentDot: document.getElementById("commentDot"),
  startAutoCommentBtn: document.getElementById("startAutoCommentBtn"),
  stopAutoCommentBtn: document.getElementById("stopAutoCommentBtn"),
  autoCommentMessage: document.getElementById("autoCommentMessage"),
  selectedPostLabel: document.getElementById("selectedPostLabel"),
  autoCommentOwnPostId: document.getElementById("autoCommentOwnPostId"),
  autoCommentTargetCount: document.getElementById("autoCommentTargetCount"),
  autoCommentExternalPostId: document.getElementById("autoCommentExternalPostId"),
  autoCommentCompletionMinutes: document.getElementById(
    "autoCommentCompletionMinutes"
  ),
  autoCommentStartAt: document.getElementById("autoCommentStartAt"),
  autoCommentAutoDelete: document.getElementById("autoCommentAutoDelete"),
  autoCommentDeleteAfterMinutes: document.getElementById(
    "autoCommentDeleteAfterMinutes"
  ),
  scheduleAutoCommentBtn: document.getElementById("scheduleAutoCommentBtn"),
  cancelAutoCommentScheduleBtn: document.getElementById("cancelAutoCommentScheduleBtn"),
  autoCommentScheduleInfo: document.getElementById("autoCommentScheduleInfo"),
  autoCommentJobsLog: document.getElementById("autoCommentJobsLog"),
  autoCommentDeleteLog: document.getElementById("autoCommentDeleteLog"),
  syncMyPostsBtn: document.getElementById("syncMyPostsBtn"),
  runAutoReplyBtn: document.getElementById("runAutoReplyBtn"),
  generateReplyDraftsBtn: document.getElementById("generateReplyDraftsBtn"),
  autoReplyEnabled: document.getElementById("autoReplyEnabled"),
  autoReplyMessage: document.getElementById("autoReplyMessage"),
  replyDraftMessage: document.getElementById("replyDraftMessage"),
  replyDraftStats: document.getElementById("replyDraftStats"),
  replyDraftsList: document.getElementById("replyDraftsList"),
  clearPendingReplyDraftsBtn: document.getElementById("clearPendingReplyDraftsBtn"),
  replyGenerateCount: document.getElementById("replyGenerateCount"),
  replyTargetCount: document.getElementById("replyTargetCount"),
  replyMinInterval: document.getElementById("replyMinInterval"),
  replyMaxInterval: document.getElementById("replyMaxInterval"),
  runAutoDiscussionBtn: document.getElementById("runAutoDiscussionBtn"),
  generateDiscussionDraftsBtn: document.getElementById("generateDiscussionDraftsBtn"),
  autoDiscussionEnabled: document.getElementById("autoDiscussionEnabled"),
  autoDiscussionMessage: document.getElementById("autoDiscussionMessage"),
  discussionDraftMessage: document.getElementById("discussionDraftMessage"),
  discussionDraftStats: document.getElementById("discussionDraftStats"),
  discussionDraftsList: document.getElementById("discussionDraftsList"),
  clearPendingDiscussionDraftsBtn: document.getElementById(
    "clearPendingDiscussionDraftsBtn"
  ),
  discussionGenerateCount: document.getElementById("discussionGenerateCount"),
  discussionMinInterval: document.getElementById("discussionMinInterval"),
  discussionMaxInterval: document.getElementById("discussionMaxInterval"),
  replyScope: document.getElementById("replyScope"),
  replyScopeLabel: document.getElementById("replyScopeLabel"),
  replySelfReplyLimit: document.getElementById("replySelfReplyLimit"),
  discussionScope: document.getElementById("discussionScope"),
  discussionScopeLabel: document.getElementById("discussionScopeLabel"),
  discussionTargetCount: document.getElementById("discussionTargetCount"),
  externalDiscussionDot: document.getElementById("externalDiscussionDot"),
  dashboardScope: document.getElementById("dashboardScope"),
  dashboardCommunityField: document.getElementById("dashboardCommunityField"),
  dashboardCommunitySlug: document.getElementById("dashboardCommunitySlug"),
  refreshDashboardBtn: document.getElementById("refreshDashboardBtn"),
  dashboardCards: document.getElementById("dashboardCards"),
  dashboardTable: document.getElementById("dashboardTable"),
  dashboardMessage: document.getElementById("dashboardMessage"),
  communitySlug: document.getElementById("communitySlug"),
  communityScanFromMonth: document.getElementById("communityScanFromMonth"),
  communityScanToMonth: document.getElementById("communityScanToMonth"),
  communityPostsSearch: document.getElementById("communityPostsSearch"),
  scanCommunityBtn: document.getElementById("scanCommunityBtn"),
  loadCachedCommunityBtn: document.getElementById("loadCachedCommunityBtn"),
  communityPostsList: document.getElementById("communityPostsList"),
  communityPostsMessage: document.getElementById("communityPostsMessage"),
  crossInteractionEnabled: document.getElementById("crossInteractionEnabled"),
  externalDiscussionPostId: document.getElementById("externalDiscussionPostId"),
  loadExternalPostBtn: document.getElementById("loadExternalPostBtn"),
  externalPostPreview: document.getElementById("externalPostPreview"),
  generateExternalDiscussionDraftsBtn: document.getElementById(
    "generateExternalDiscussionDraftsBtn"
  ),
  externalDiscussionGenerateCount: document.getElementById(
    "externalDiscussionGenerateCount"
  ),
  externalDiscussionDraftStats: document.getElementById(
    "externalDiscussionDraftStats"
  ),
  externalDiscussionDraftsList: document.getElementById(
    "externalDiscussionDraftsList"
  ),
  externalDiscussionDraftMessage: document.getElementById(
    "externalDiscussionDraftMessage"
  ),
  clearPendingExternalDiscussionDraftsBtn: document.getElementById(
    "clearPendingExternalDiscussionDraftsBtn"
  ),
  runAutoExternalDiscussionBtn: document.getElementById(
    "runAutoExternalDiscussionBtn"
  ),
  autoExternalDiscussionEnabled: document.getElementById(
    "autoExternalDiscussionEnabled"
  ),
  externalDiscussionTargetCount: document.getElementById(
    "externalDiscussionTargetCount"
  ),
  externalDiscussionMinInterval: document.getElementById(
    "externalDiscussionMinInterval"
  ),
  externalDiscussionMaxInterval: document.getElementById(
    "externalDiscussionMaxInterval"
  ),
  autoExternalDiscussionMessage: document.getElementById(
    "autoExternalDiscussionMessage"
  ),
  myPostsList: document.getElementById("myPostsList"),
  myDiscussionPostId: document.getElementById("myDiscussionPostId"),
  postsMessage: document.getElementById("postsMessage"),
  deleteTechhubId: document.getElementById("deleteTechhubId"),
  deleteSelectedLabel: document.getElementById("deleteSelectedLabel"),
  deleteAtInput: document.getElementById("deleteAtInput"),
  scheduleDeleteBtn: document.getElementById("scheduleDeleteBtn"),
  deleteNowBtn: document.getElementById("deleteNowBtn"),
  scheduledDeletesList: document.getElementById("scheduledDeletesList"),
  deleteScheduleMessage: document.getElementById("deleteScheduleMessage"),
  usersSearch: document.getElementById("usersSearch"),
  usersList: document.getElementById("usersList"),
  usersMessage: document.getElementById("usersMessage"),
  refreshUsersBtn: document.getElementById("refreshUsersBtn"),
  statUsersTotal: document.getElementById("statUsersTotal"),
  statUsersAdmins: document.getElementById("statUsersAdmins"),
  statUsersLocked: document.getElementById("statUsersLocked"),
  statUsersToday: document.getElementById("statUsersToday"),
  openInTabBtn: document.getElementById("openInTabBtn"),
  sideMenu: document.getElementById("sideMenu"),
};

const ACTIVE_PANEL_KEY = "activePanel";
const COMMUNITY_BROWSER_KEY = "communityBrowserPreferences";

// Menu chỉ quản trị viên: Tự động hóa / Bài người khác / Nguy hiểm / Người dùng
const ADMIN_ONLY_PANELS = new Set([
  "engagement",
  "reply",
  "discussion",
  "comment",
  "community",
  "external-discussion",
  "delete",
  "users",
]);

const isTabView = new URLSearchParams(location.search).get("view") === "tab";

let currentUserProfile = null;
let isAdminUser = false;
let selectedTechhubId = null;
let autoCommentSelectedTechhubId = null;
let autoCommentSelectedTechhubIds = [];
let deleteSelectedTechhubIds = [];
const postPickerViews = new Map();
let currentAutoCommentState = null;
let cachedPosts = [];
let availableUltraCredits = 0;
let postsFilter = "";
let pendingReplyDraftCount = 0;
let pendingDiscussionDraftCount = 0;
let currentReplyDrafts = [];
let currentDiscussionDrafts = [];
let communityPosts = [];
let communityPostsFilter = "";
let cachedUsers = [];
let usersPostCounts = {};
let usersTodayCounts = {};
let usersFilter = "";
let externalDiscussionPost = null;
let pendingExternalDiscussionDraftCount = 0;
let currentExternalDiscussionDrafts = [];
const jobFlags = {
  comment: false,
  reply: false,
  discussion: false,
  externalDiscussion: false,
};

document.addEventListener("DOMContentLoaded", init);
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "autoCommentProgress") {
    renderAutoCommentStatus(request.state, request.message, request.type);
    setTimeout(() => loadAutoCommentDeleteLog(), 100);
  }
  if (request.action === "autoReplyProgress") {
    renderAutoReplyStatus(request.state, request.message, request.type);
    if (request.type === "success" || request.type === "muted") {
      loadReplyDrafts();
    }
  }
  if (request.action === "replyDraftProgress") {
    showAdminMsg(elements.replyDraftMessage, request.message, request.type || "info");
  }
  if (request.action === "autoDiscussionProgress") {
    renderAutoDiscussionStatus(request.state, request.message, request.type);
    if (request.type === "success" || request.type === "muted") {
      loadDiscussionDrafts();
    }
  }
  if (request.action === "discussionDraftProgress") {
    showAdminMsg(
      elements.discussionDraftMessage,
      request.message,
      request.type || "info"
    );
  }
  if (request.action === "autoExternalDiscussionProgress") {
    renderAutoExternalDiscussionStatus(request.state, request.message, request.type);
    if (request.type === "success" || request.type === "muted") {
      loadExternalDiscussionDrafts();
    }
  }
  if (request.action === "externalDiscussionDraftProgress") {
    showAdminMsg(
      elements.externalDiscussionDraftMessage,
      request.message,
      request.type || "info"
    );
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
  await restoreCommunityBrowserPreferences();
  syncDashboardScopeFields();

  if (
    SUPABASE_CONFIG.url === "YOUR_SUPABASE_URL" ||
    SUPABASE_CONFIG.anonKey === "YOUR_SUPABASE_ANON_KEY"
  ) {
    showError("Vui lòng cấu hình Supabase trong config.js");
    return;
  }

  await loadAdminGate();
  await restoreActivePanel();

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
    externalDiscussion: elements.externalDiscussionDot,
  };
  dots[name]?.classList.toggle("hidden", !jobFlags[name]);

  const running = [
    jobFlags.comment ? "auto comment" : null,
    jobFlags.reply ? "AI trả lời" : null,
    jobFlags.discussion ? "AI thảo luận" : null,
    jobFlags.externalDiscussion ? "thảo luận bài khác" : null,
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
  if (!isAdminUser && ADMIN_ONLY_PANELS.has(name)) {
    name = "posts";
  }
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

  if (name === "community" && communityPosts.length === 0) {
    loadCachedCommunityPosts(false);
  }

  if (name === "users" && cachedUsers.length === 0) {
    loadUsers();
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

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getCommunityScanRangeFromUi() {
  return resolveCommunityScanRange(
    elements.communityScanFromMonth?.value,
    elements.communityScanToMonth?.value
  );
}

async function restoreCommunityBrowserPreferences() {
  const fallback = currentMonthValue();
  try {
    const stored = await chrome.storage.local.get(COMMUNITY_BROWSER_KEY);
    const preferences = stored[COMMUNITY_BROWSER_KEY];
    if (preferences?.slug && elements.communitySlug) {
      elements.communitySlug.value = preferences.slug;
    }
    if (preferences?.slug && elements.dashboardCommunitySlug) {
      elements.dashboardCommunitySlug.value = preferences.slug;
    }
    const fromMonth = preferences?.fromMonth || fallback;
    const toMonth = preferences?.toMonth || preferences?.fromMonth || fallback;
    if (elements.communityScanFromMonth) elements.communityScanFromMonth.value = fromMonth;
    if (elements.communityScanToMonth) elements.communityScanToMonth.value = toMonth;
    try {
      getCommunityScanRangeFromUi();
    } catch {
      if (elements.communityScanFromMonth) elements.communityScanFromMonth.value = fallback;
      if (elements.communityScanToMonth) elements.communityScanToMonth.value = fallback;
    }
  } catch {
    if (elements.communityScanFromMonth) elements.communityScanFromMonth.value = fallback;
    if (elements.communityScanToMonth) elements.communityScanToMonth.value = fallback;
  }
}

function setupEventListeners() {
  setupPostPickers();
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
  if (elements.usersSearch) {
    elements.usersSearch.addEventListener("input", () => {
      usersFilter = elements.usersSearch.value.trim().toLowerCase();
      renderUsers();
    });
  }
  if (elements.refreshUsersBtn) {
    elements.refreshUsersBtn.addEventListener("click", () => loadUsers(true));
  }
  if (elements.usersList) {
    elements.usersList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-user-action]");
      if (!button) return;
      const username = button.dataset.username;
      if (button.dataset.userAction === "admin") {
        toggleUserAdmin(username);
      } else if (button.dataset.userAction === "lock") {
        toggleUserLock(username);
      } else if (button.dataset.userAction === "delete") {
        deleteUserAccount(username);
      }
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
  if (elements.generateReplyDraftsBtn) {
    elements.generateReplyDraftsBtn.addEventListener("click", generateReplyDrafts);
  }
  if (elements.autoReplyEnabled) {
    elements.autoReplyEnabled.addEventListener("change", toggleAutoReply);
  }
  if (elements.runAutoDiscussionBtn) {
    elements.runAutoDiscussionBtn.addEventListener("click", runAutoDiscussionOnce);
  }
  if (elements.generateDiscussionDraftsBtn) {
    elements.generateDiscussionDraftsBtn.addEventListener("click", generateDiscussionDrafts);
  }
  if (elements.autoDiscussionEnabled) {
    elements.autoDiscussionEnabled.addEventListener("change", toggleAutoDiscussion);
  }
  if (elements.scanCommunityBtn) {
    elements.scanCommunityBtn.addEventListener("click", scanCommunityArticles);
  }
  if (elements.crossInteractionEnabled) {
    elements.crossInteractionEnabled.addEventListener(
      "change",
      toggleCrossInteraction
    );
  }
  if (elements.loadCachedCommunityBtn) {
    elements.loadCachedCommunityBtn.addEventListener("click", () =>
      loadCachedCommunityPosts(true)
    );
  }
  if (elements.refreshDashboardBtn) {
    elements.refreshDashboardBtn.addEventListener("click", loadMonthlyStats);
  }
  if (elements.dashboardScope) {
    elements.dashboardScope.addEventListener("change", syncDashboardScopeFields);
  }
  if (elements.communityPostsSearch) {
    elements.communityPostsSearch.addEventListener("input", () => {
      communityPostsFilter = elements.communityPostsSearch.value.trim().toLowerCase();
      renderCommunityPosts(communityPosts);
    });
  }
  if (elements.communityPostsList) {
    elements.communityPostsList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-community-select-id]");
      if (!button) return;
      selectCommunityPost(Number(button.dataset.communitySelectId));
    });
  }
  if (elements.loadExternalPostBtn) {
    elements.loadExternalPostBtn.addEventListener("click", loadExternalDiscussionPost);
  }
  if (elements.generateExternalDiscussionDraftsBtn) {
    elements.generateExternalDiscussionDraftsBtn.addEventListener(
      "click",
      generateExternalDiscussionDrafts
    );
  }
  if (elements.clearPendingExternalDiscussionDraftsBtn) {
    elements.clearPendingExternalDiscussionDraftsBtn.addEventListener(
      "click",
      clearPendingExternalDiscussionDrafts
    );
  }
  if (elements.runAutoExternalDiscussionBtn) {
    elements.runAutoExternalDiscussionBtn.addEventListener(
      "click",
      runAutoExternalDiscussionOnce
    );
  }
  if (elements.autoExternalDiscussionEnabled) {
    elements.autoExternalDiscussionEnabled.addEventListener(
      "change",
      toggleAutoExternalDiscussion
    );
  }
  if (elements.externalDiscussionPostId) {
    elements.externalDiscussionPostId.addEventListener("input", () => {
      const nextId = Number(elements.externalDiscussionPostId.value);
      if (
        externalDiscussionPost &&
        Number(externalDiscussionPost.techhub_id) !== nextId
      ) {
        externalDiscussionPost = null;
        renderExternalPostPreview(null);
        renderExternalDiscussionDrafts([]);
      }
      if (communityPosts.length) renderCommunityPosts(communityPosts);
    });
  }
  if (elements.replyScope) {
    elements.replyScope.addEventListener("change", () => {
      const id = Number(elements.replyScope.value);
      if (Number.isInteger(id) && id > 0) {
        selectPost(id, { updateAiSelectors: false, updateAutoCommentTarget: false });
        loadReplyDrafts();
      } else {
        selectedTechhubId = null;
        renderReplyDrafts([]);
      }
      updateScopeLabels();
    });
  }
  if (elements.discussionScope) {
    elements.discussionScope.addEventListener("change", () => {
      const id = Number(elements.discussionScope.value);
      if (Number.isInteger(id) && id > 0) {
        selectPost(id, { updateAiSelectors: false, updateAutoCommentTarget: false });
        loadDiscussionDrafts();
      } else {
        selectedTechhubId = null;
        renderDiscussionDrafts([]);
      }
      updateScopeLabels();
    });
  }
  if (elements.autoCommentOwnPostId) {
    elements.autoCommentOwnPostId.addEventListener("change", () => {
      const ids = [...elements.autoCommentOwnPostId.selectedOptions]
        .map((option) => Number(option.value))
        .filter((id) => Number.isInteger(id) && id > 0);
      if (ids.length > 5) {
        for (const option of [...elements.autoCommentOwnPostId.selectedOptions].slice(5)) {
          option.selected = false;
        }
        showAdminMsg(elements.autoCommentMessage, "Mỗi lần chỉ chọn tối đa 5 bài.", "error");
      }
      autoCommentSelectedTechhubIds = ids.slice(0, 5);
      autoCommentSelectedTechhubId = autoCommentSelectedTechhubIds[0] || null;
      if (autoCommentSelectedTechhubId) {
        selectedTechhubId = autoCommentSelectedTechhubId;
        if (elements.autoCommentExternalPostId) elements.autoCommentExternalPostId.value = "";
      }
      updateSelectedPostLabel(true);
    });
  }
  if (elements.autoCommentExternalPostId) {
    elements.autoCommentExternalPostId.addEventListener("input", () => {
      const externalId = Number(elements.autoCommentExternalPostId.value);
      if (Number.isInteger(externalId) && externalId > 0) {
        autoCommentSelectedTechhubId = null;
        autoCommentSelectedTechhubIds = [];
        if (elements.autoCommentOwnPostId) {
          for (const option of elements.autoCommentOwnPostId.options) option.selected = false;
          renderPostPickers(elements.autoCommentOwnPostId);
        }
        showAdminMsg(
          elements.selectedPostLabel,
          `Đang dùng bài thành viên khác #${externalId}`,
          "info"
        );
      } else {
        updateSelectedPostLabel();
      }
    });
  }
  if (elements.deleteTechhubId) {
    elements.deleteTechhubId.addEventListener("change", () => {
      const ids = [...elements.deleteTechhubId.selectedOptions]
        .map((option) => Number(option.value))
        .filter((id) => Number.isInteger(id) && id > 0);
      if (ids.length > 5) {
        for (const option of [...elements.deleteTechhubId.selectedOptions].slice(5)) {
          option.selected = false;
        }
        showAdminMsg(elements.deleteScheduleMessage, "Mỗi lần chỉ chọn tối đa 5 bài.", "error");
      }
      deleteSelectedTechhubIds = ids.slice(0, 5);
      if (deleteSelectedTechhubIds[0]) selectedTechhubId = deleteSelectedTechhubIds[0];
      renderDeleteSelectedLabel();
    });
  }
  if (elements.clearPendingReplyDraftsBtn) {
    elements.clearPendingReplyDraftsBtn.addEventListener(
      "click",
      clearPendingReplyDrafts
    );
  }
  if (elements.clearPendingDiscussionDraftsBtn) {
    elements.clearPendingDiscussionDraftsBtn.addEventListener(
      "click",
      clearPendingDiscussionDrafts
    );
  }
  if (elements.replyDraftsList) {
    elements.replyDraftsList.addEventListener("click", (event) => {
      const editBtn = event.target.closest("[data-edit-reply-draft]");
      if (editBtn) {
        editReplyDraft(Number(editBtn.dataset.editReplyDraft));
        return;
      }
      const deleteBtn = event.target.closest("[data-delete-reply-draft]");
      if (deleteBtn) {
        deleteReplyDraft(Number(deleteBtn.dataset.deleteReplyDraft));
      }
    });
  }
  if (elements.discussionDraftsList) {
    elements.discussionDraftsList.addEventListener("click", (event) => {
      const editBtn = event.target.closest("[data-edit-discussion-draft]");
      if (editBtn) {
        editDiscussionDraft(Number(editBtn.dataset.editDiscussionDraft));
        return;
      }
      const deleteBtn = event.target.closest("[data-delete-discussion-draft]");
      if (deleteBtn) {
        deleteDiscussionDraft(Number(deleteBtn.dataset.deleteDiscussionDraft));
      }
    });
  }
  if (elements.externalDiscussionDraftsList) {
    elements.externalDiscussionDraftsList.addEventListener("click", (event) => {
      const editBtn = event.target.closest("[data-edit-external-discussion-draft]");
      if (editBtn) {
        editExternalDiscussionDraft(
          Number(editBtn.dataset.editExternalDiscussionDraft)
        );
        return;
      }
      const deleteBtn = event.target.closest(
        "[data-delete-external-discussion-draft]"
      );
      if (deleteBtn) {
        deleteExternalDiscussionDraft(
          Number(deleteBtn.dataset.deleteExternalDiscussionDraft)
        );
      }
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

function showDenied(message) {
  hideAllStates();
  elements.deniedSection.classList.remove("hidden");
  const text = elements.deniedSection.querySelector("p");
  if (text) {
    text.textContent =
      message || "Tài khoản hiện tại không có quyền admin.";
  }
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
    if (!dbUser) {
      showDenied(
        `Tài khoản @${username} chưa được đăng ký. Liên hệ quản trị viên để được thêm vào hệ thống.`
      );
      return;
    }
    if (dbUser.is_locked) {
      showDenied(
        `Tài khoản @${username} đã bị khóa khỏi extension. Liên hệ quản trị viên để mở lại.`
      );
      return;
    }

    // Admin thấy toàn bộ menu; user thường chỉ thấy Bài viết + Thống kê
    isAdminUser = !!dbUser.is_admin;
    document.body.classList.toggle("not-admin", !isAdminUser);

    showAdmin();
    await loadMyPosts();
    if (isAdminUser) {
      setDefaultDeleteAt();
      setDefaultAutoCommentStartAt();
      await loadAutoCommentStatus();
      await loadAutoCommentDeleteLog();
      await loadAutoReplyStatus();
      await loadReplyDrafts();
      await loadAutoDiscussionStatus();
      await loadDiscussionDrafts();
      await loadAutoExternalDiscussionStatus();
      await loadCrossInteractionStatus();
      if (Number(elements.externalDiscussionPostId?.value) > 0) {
        await loadExternalDiscussionPost();
      }
      await loadScheduledDeletes();
    }
  } catch (error) {
    showError("Lỗi: " + error.message);
  }
}

async function loadCrossInteractionStatus() {
  const response = await sendMessage({ action: "getCrossInteractionStatus" });
  if (!response?.success) {
    throw new Error(response?.error || "Không đọc được trạng thái tương tác chéo");
  }
  if (elements.crossInteractionEnabled) {
    elements.crossInteractionEnabled.checked = !!response.enabled;
  }
}

async function toggleCrossInteraction() {
  const enabled = !!elements.crossInteractionEnabled?.checked;
  if (elements.crossInteractionEnabled) elements.crossInteractionEnabled.disabled = true;
  try {
    const response = await sendMessage({
      action: "setCrossInteractionEnabled",
      enabled,
    });
    if (!response?.success) throw new Error(response?.error || "Không cập nhật được");
    showAdminMsg(
      elements.communityPostsMessage,
      enabled
        ? "Đã bật tự động tương tác chéo mỗi 15 phút."
        : "Đã tắt tự động tương tác chéo.",
      enabled ? "success" : "muted"
    );
  } catch (error) {
    if (elements.crossInteractionEnabled) {
      elements.crossInteractionEnabled.checked = !enabled;
    }
    showAdminMsg(elements.communityPostsMessage, `Lỗi: ${error.message}`, "error");
  } finally {
    if (elements.crossInteractionEnabled) elements.crossInteractionEnabled.disabled = false;
  }
}

// ==================== Quản lý người dùng ====================

function isSelfUsername(username) {
  return (
    !!username &&
    !!currentUserProfile?.username &&
    String(username).toLowerCase() ===
      String(currentUserProfile.username).toLowerCase()
  );
}

function findCachedUser(username) {
  return cachedUsers.find(
    (user) => String(user.username).toLowerCase() === String(username).toLowerCase()
  );
}

async function loadUsers(showSuccess = false) {
  if (elements.usersList) {
    elements.usersList.innerHTML =
      '<div class="empty">Đang tải danh sách người dùng…</div>';
  }
  try {
    const response = await sendMessage({ action: "getUsersOverview" });
    if (!response?.success) {
      throw new Error(response?.error || "Không tải được danh sách người dùng");
    }
    cachedUsers = Array.isArray(response.users) ? response.users : [];
    usersPostCounts = response.postCounts || {};
    usersTodayCounts = response.todayInteractionCounts || {};
    renderUsers();
    if (showSuccess) {
      showAdminMsg(
        elements.usersMessage,
        `Đã làm mới ${cachedUsers.length} người dùng.`,
        "success"
      );
    }
  } catch (error) {
    if (elements.usersList) {
      elements.usersList.innerHTML =
        '<div class="empty">Không tải được dữ liệu người dùng.</div>';
    }
    showAdminMsg(elements.usersMessage, `Lỗi: ${error.message}`, "error");
  }
}

function updateUsersStats() {
  if (elements.statUsersTotal) {
    elements.statUsersTotal.textContent = String(cachedUsers.length);
  }
  if (elements.statUsersAdmins) {
    elements.statUsersAdmins.textContent = String(
      cachedUsers.filter((user) => !!user.is_admin).length
    );
  }
  if (elements.statUsersLocked) {
    elements.statUsersLocked.textContent = String(
      cachedUsers.filter((user) => !!user.is_locked).length
    );
  }
  if (elements.statUsersToday) {
    const todayTotal = cachedUsers.reduce(
      (sum, user) => sum + (Number(usersTodayCounts[user.username]) || 0),
      0
    );
    elements.statUsersToday.textContent = String(todayTotal);
  }
}

function renderUsers() {
  updateUsersStats();
  if (!elements.usersList) return;

  const keyword = usersFilter.trim().toLowerCase();
  const visibleUsers = cachedUsers.filter((user) => {
    if (!keyword) return true;
    const haystack = [user.username, user.full_name, user.email]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(keyword);
  });

  if (visibleUsers.length === 0) {
    elements.usersList.innerHTML = cachedUsers.length
      ? '<div class="empty">Không có người dùng khớp từ khóa.</div>'
      : '<div class="empty">Chưa có người dùng nào. Bấm Làm mới để tải.</div>';
    return;
  }

  const rows = visibleUsers
    .map((user) => {
      const username = String(user.username || "-");
      const self = isSelfUsername(username);
      const isAdmin = !!user.is_admin;
      const isLocked = !!user.is_locked;
      const posts = Number(usersPostCounts[user.username]) || 0;
      const todayCount = Number(usersTodayCounts[user.username]) || 0;
      const fullName = user.full_name ? String(user.full_name) : "";
      const selfTitle = self ? ' title="Không thể thao tác trên tài khoản của chính mình"' : "";

      const badges =
        (isAdmin ? '<span class="badge admin">Admin</span>' : "") +
        (isLocked ? '<span class="badge locked">Khóa</span>' : "");

      return (
        `<tr class="${self ? "selected" : ""}">` +
        `<td class="cell-user">` +
        `<div class="user-cell">` +
        `<span class="u-avatar${isLocked ? " locked" : ""}">${escapeHtml(
          username.slice(0, 2)
        )}</span>` +
        `<div class="user-cell-text">` +
        `<span class="user-cell-name">@${escapeHtml(username)}${
          self ? ' <span class="badge self">Bạn</span>' : ""
        }</span>` +
        (fullName
          ? `<div class="user-cell-sub">${escapeHtml(fullName)}</div>`
          : "") +
        `</div></div></td>` +
        `<td data-label="Bài"><span class="num">${posts}</span></td>` +
        `<td data-label="Cmt hôm nay"><span class="num">${todayCount}</span></td>` +
        `<td data-label="Trạng thái">${
          badges || '<span class="badge other">Thường</span>'
        }</td>` +
        `<td class="cell-date" data-label="Hoạt động">${escapeHtml(
          formatRelativeDate(user.last_update || user.created_at)
        )}</td>` +
        `<td class="cell-action">` +
        `<div class="row-actions">` +
        `<button type="button" class="mini-btn" data-user-action="admin" data-username="${escapeHtml(
          username
        )}"${self ? " disabled" : ""}${selfTitle}>${isAdmin ? "Thu quyền" : "Cấp quyền"}</button>` +
        `<button type="button" class="mini-btn" data-user-action="lock" data-username="${escapeHtml(
          username
        )}"${self ? " disabled" : ""}${selfTitle}>${
          isLocked ? "Mở khóa" : "Khóa"
        }</button>` +
        `<button type="button" class="mini-btn danger" data-user-action="delete" data-username="${escapeHtml(
          username
        )}"${self ? " disabled" : ""}${selfTitle}>Xóa</button>` +
        `</div>` +
        `</td>` +
        `</tr>`
      );
    })
    .join("");

  elements.usersList.innerHTML =
    '<table class="data-table"><thead><tr>' +
    "<th>Người dùng</th><th>Bài</th><th>Cmt hôm nay</th>" +
    "<th>Trạng thái</th><th>Hoạt động</th><th></th>" +
    `</tr></thead><tbody>${rows}</tbody></table>`;
}

async function toggleUserAdmin(username) {
  const user = findCachedUser(username);
  if (!user) return;
  if (isSelfUsername(username)) {
    showAdminMsg(
      elements.usersMessage,
      "Không thể thay đổi quyền admin của chính mình.",
      "error"
    );
    return;
  }
  const nextValue = !user.is_admin;
  try {
    const response = await sendMessage({
      action: "updateUserStatus",
      username,
      isAdmin: nextValue,
    });
    if (!response?.success) {
      throw new Error(response?.error || "Cập nhật thất bại");
    }
    if (response.user) Object.assign(user, response.user);
    renderUsers();
    showAdminMsg(
      elements.usersMessage,
      nextValue
        ? `Đã cấp quyền admin cho @${username}.`
        : `Đã thu quyền admin của @${username}.`,
      "success"
    );
  } catch (error) {
    showAdminMsg(elements.usersMessage, `Lỗi: ${error.message}`, "error");
  }
}

async function toggleUserLock(username) {
  const user = findCachedUser(username);
  if (!user) return;
  if (isSelfUsername(username)) {
    showAdminMsg(
      elements.usersMessage,
      "Không thể khóa chính mình.",
      "error"
    );
    return;
  }
  const nextValue = !user.is_locked;
  if (
    nextValue &&
    !window.confirm(
      `Khóa @${username}? Tài khoản này sẽ không mở được panel extension cho đến khi được mở khóa.`
    )
  ) {
    return;
  }
  try {
    const response = await sendMessage({
      action: "updateUserStatus",
      username,
      isLocked: nextValue,
    });
    if (!response?.success) {
      throw new Error(response?.error || "Cập nhật thất bại");
    }
    if (response.user) Object.assign(user, response.user);
    renderUsers();
    showAdminMsg(
      elements.usersMessage,
      nextValue
        ? `Đã khóa @${username}.`
        : `Đã mở khóa cho @${username}.`,
      "success"
    );
  } catch (error) {
    showAdminMsg(elements.usersMessage, `Lỗi: ${error.message}`, "error");
  }
}

async function deleteUserAccount(username) {
  if (isSelfUsername(username)) {
    showAdminMsg(
      elements.usersMessage,
      "Không thể xóa tài khoản của chính mình.",
      "error"
    );
    return;
  }
  if (
    !window.confirm(
      `Xóa người dùng @${username} khỏi Supabase? Bài viết và tương tác đã lưu sẽ được giữ lại.`
    )
  ) {
    return;
  }
  try {
    const response = await sendMessage({ action: "deleteUser", username });
    if (!response?.success) {
      throw new Error(response?.error || "Xóa thất bại");
    }
    cachedUsers = cachedUsers.filter(
      (user) =>
        String(user.username).toLowerCase() !== String(username).toLowerCase()
    );
    renderUsers();
    showAdminMsg(elements.usersMessage, `Đã xóa @${username}.`, "success");
  } catch (error) {
    showAdminMsg(elements.usersMessage, `Lỗi: ${error.message}`, "error");
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

function selectPost(
  techhubId,
  { updateAiSelectors = true, updateAutoCommentTarget = true } = {}
) {
  if (!Number.isInteger(techhubId) || techhubId < 1) return;
  selectedTechhubId = techhubId;
  // Job/lịch đang chạy giữ techhubId trong state riêng. Vì đã hỗ trợ nhiều job,
  // việc chọn bài mới phải luôn đổi mục tiêu của form để tạo job/lịch kế tiếp.
  if (updateAutoCommentTarget) {
    autoCommentSelectedTechhubId = techhubId;
    autoCommentSelectedTechhubIds = [techhubId];
    if (elements.autoCommentExternalPostId) {
      elements.autoCommentExternalPostId.value = "";
    }
  }
  if (updateAiSelectors) {
    if (elements.replyScope && !elements.replyScope.disabled) {
      elements.replyScope.value = String(techhubId);
    }
    if (elements.discussionScope && !elements.discussionScope.disabled) {
      elements.discussionScope.value = String(techhubId);
    }
  }
  if (elements.deleteTechhubId) {
    deleteSelectedTechhubIds = [techhubId];
    for (const option of elements.deleteTechhubId.options) {
      option.selected = option.value === String(techhubId);
    }
    renderDeleteSelectedLabel();
  }
  renderMyPosts(cachedPosts);
  updateSelectedPostLabel(updateAutoCommentTarget);
  // Bộ đếm thuộc về job/bài đã chạy, không được mang sang bài vừa chọn.
  // Nếu job đang chạy thì vẫn giữ nguyên trạng thái thật của job hiện tại.
  if (updateAutoCommentTarget) {
    const targetCount = Number(elements.autoCommentTargetCount?.value);
    showAdminMsg(
      elements.autoCommentMessage,
      `Sẵn sàng tạo job/lịch tiếp theo · bài #${techhubId} · 0/${
        Number.isInteger(targetCount) && targetCount > 0 ? targetCount : "?"
      } cmt`,
      "muted"
    );
  }
  updateScopeLabels();
  loadReplyDrafts();
  loadDiscussionDrafts();
}

/**
 * techhub_id để chạy job AI: null = tất cả bài
 */
function resolveScopeTechhubId(selectEl) {
  const value = Number(selectEl?.value);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function setupPostPickers() {
  const configs = [
    { select: elements.replyScope, max: 1, search: "Tìm bài cần trả lời…" },
    { select: elements.discussionScope, max: 1, search: "Tìm bài cần thảo luận…" },
    { select: elements.autoCommentOwnPostId, max: 5, search: "Tìm bài để comment…" },
    { select: elements.deleteTechhubId, max: 5, search: "Tìm bài cần xóa…" },
  ];
  for (const config of configs) {
    const selectEl = config.select;
    if (!selectEl || postPickerViews.has(selectEl.id)) continue;

    const details = document.createElement("details");
    details.className = "post-picker";
    const summary = document.createElement("summary");
    summary.className = "post-picker-summary";
    const summaryText = document.createElement("span");
    summaryText.className = "post-picker-summary-text";
    const summaryTitle = document.createElement("strong");
    const summaryMeta = document.createElement("small");
    summaryText.append(summaryTitle, summaryMeta);
    const chevron = document.createElement("span");
    chevron.className = "post-picker-chevron";
    chevron.setAttribute("aria-hidden", "true");
    summary.append(summaryText, chevron);

    const panel = document.createElement("div");
    panel.className = "post-picker-panel";
    const toolbar = document.createElement("div");
    toolbar.className = "post-picker-toolbar";
    const searchInput = document.createElement("input");
    searchInput.id = `${selectEl.id}Search`;
    searchInput.type = "search";
    searchInput.placeholder = config.search;
    searchInput.autocomplete = "off";
    searchInput.setAttribute("aria-label", config.search);
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "post-picker-clear";
    clearButton.textContent = "Bỏ chọn";
    toolbar.append(searchInput, clearButton);
    const status = document.createElement("div");
    status.className = "post-picker-status";
    const list = document.createElement("div");
    list.className = "post-picker-list";
    list.setAttribute("role", "listbox");
    if (selectEl.multiple) list.setAttribute("aria-multiselectable", "true");
    panel.append(toolbar, status, list);
    details.append(summary, panel);
    selectEl.insertAdjacentElement("afterend", details);

    postPickerViews.set(selectEl.id, {
      selectEl,
      max: config.max,
      details,
      summaryTitle,
      summaryMeta,
      searchInput,
      clearButton,
      status,
      list,
    });

    details.addEventListener("toggle", () => {
      if (details.open && !selectEl.disabled) setTimeout(() => searchInput.focus(), 0);
    });
    summary.addEventListener("click", (event) => {
      if (selectEl.disabled) event.preventDefault();
    });
    searchInput.addEventListener("input", () => renderPostPicker(selectEl));
    clearButton.addEventListener("click", () => {
      if (selectEl.disabled) return;
      if (selectEl.multiple) {
        for (const option of selectEl.options) option.selected = false;
      } else {
        selectEl.value = "";
      }
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    });
    list.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-post-picker-value]");
      if (!button || selectEl.disabled) return;
      const option = [...selectEl.options].find(
        (item) => item.value === button.dataset.postPickerValue
      );
      if (!option || option.disabled) return;
      if (selectEl.multiple) {
        const selectedCount = [...selectEl.selectedOptions].filter((item) => item.value).length;
        if (!option.selected && selectedCount >= config.max) return;
        option.selected = !option.selected;
      } else {
        selectEl.value = option.value;
      }
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
      if (!selectEl.multiple) details.open = false;
    });
    selectEl.addEventListener("change", () => renderPostPicker(selectEl));
    renderPostPicker(selectEl);
  }
}

function renderPostPickers(selectEl = null) {
  if (selectEl) {
    renderPostPicker(selectEl);
    return;
  }
  for (const view of postPickerViews.values()) renderPostPicker(view.selectEl);
}

function renderPostPicker(selectEl) {
  const view = postPickerViews.get(selectEl?.id);
  if (!view) return;
  const query = view.searchInput.value.trim().toLowerCase();
  const options = [...selectEl.options].filter((option) => {
    if (!option.value || option.disabled) return false;
    return !query || option.textContent.toLowerCase().includes(query);
  });
  const selectedOptions = [...selectEl.selectedOptions].filter((option) => option.value);
  const selectedValues = new Set(selectedOptions.map((option) => option.value));
  const selectedPosts = selectedOptions
    .map((option) => cachedPosts.find((post) => String(post.techhub_id) === option.value))
    .filter(Boolean);

  view.details.classList.toggle("is-disabled", !!selectEl.disabled);
  view.details.setAttribute("aria-disabled", selectEl.disabled ? "true" : "false");
  if (selectEl.disabled) view.details.open = false;
  view.searchInput.disabled = !!selectEl.disabled;
  view.clearButton.disabled = !!selectEl.disabled || selectedOptions.length === 0;

  if (selectEl.multiple) {
    view.summaryTitle.textContent = selectedOptions.length
      ? `Đã chọn ${selectedOptions.length}/${view.max} bài`
      : "Chọn bài viết";
    view.summaryMeta.textContent = selectedOptions.length
      ? selectedOptions.map((option) => `#${option.value}`).join(" · ")
      : "Bấm để mở danh sách và tích từng bài";
    view.status.textContent = `${selectedOptions.length}/${view.max} bài đã chọn · ${options.length} kết quả`;
  } else {
    const selected = selectedOptions[0];
    const post = selectedPosts[0];
    view.summaryTitle.textContent = selected
      ? post?.title || selected.textContent.replace(/^#\d+\s*·\s*/, "")
      : "Chọn một bài viết";
    view.summaryMeta.textContent = selected
      ? `#${selected.value} · Bấm để đổi bài`
      : "Bấm để mở danh sách lớn";
    view.status.textContent = `${options.length} bài phù hợp`;
  }

  view.list.innerHTML = "";
  if (!options.length) {
    const empty = document.createElement("div");
    empty.className = "post-picker-empty";
    empty.textContent = cachedPosts.length
      ? "Không tìm thấy bài phù hợp."
      : "Chưa có bài. Hãy đồng bộ bài trước.";
    view.list.append(empty);
    return;
  }

  const reachedLimit = selectEl.multiple && selectedValues.size >= view.max;
  for (const option of options) {
    const post = cachedPosts.find((item) => String(item.techhub_id) === option.value);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "post-picker-option";
    button.dataset.postPickerValue = option.value;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", selectedValues.has(option.value) ? "true" : "false");
    button.classList.toggle("is-selected", selectedValues.has(option.value));
    button.disabled = !!selectEl.disabled || (reachedLimit && !selectedValues.has(option.value));

    const marker = document.createElement("span");
    marker.className = "post-picker-marker";
    marker.textContent = selectedValues.has(option.value) ? "✓" : "";
    const content = document.createElement("span");
    content.className = "post-picker-option-text";
    const title = document.createElement("strong");
    title.textContent = post?.title || option.textContent.replace(/^#\d+\s*·\s*/, "");
    const meta = document.createElement("small");
    meta.textContent = `#${option.value}${post?.status ? ` · ${String(post.status).toUpperCase()}` : ""}`;
    content.append(title, meta);
    button.append(marker, content);
    view.list.append(button);
  }
}

function describeScope(selectEl) {
  const techhubId = resolveScopeTechhubId(selectEl);
  if (!techhubId) return "Chưa chọn bài";
  const post = cachedPosts.find((p) => Number(p.techhub_id) === techhubId);
  return `Đang chọn #${techhubId}${post?.title ? ` · ${post.title}` : ""}`;
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
  renderPostPickers();
}

function populateAiPostSelectors() {
  const selectedValue = Number.isInteger(selectedTechhubId) ? String(selectedTechhubId) : "";
  const options = cachedPosts
    .map(
      (post) =>
        `<option value="${Number(post.techhub_id)}">#${Number(post.techhub_id)} · ${escapeHtml(
          post.title || "(không tiêu đề)"
        )}</option>`
    )
    .join("");
  if (elements.replyScope) {
    const previous = elements.replyScope.value;
    elements.replyScope.innerHTML = `<option value="">Chọn một bài…</option>${options}`;
    elements.replyScope.value = cachedPosts.some((post) => String(post.techhub_id) === previous)
      ? previous
      : selectedValue;
  }
  if (elements.discussionScope) {
    const previous = elements.discussionScope.value;
    elements.discussionScope.innerHTML = `<option value="">Chọn một bài…</option>${options}`;
    elements.discussionScope.value = cachedPosts.some(
      (post) => String(post.techhub_id) === previous
    )
      ? previous
      : selectedValue;
  }
  if (elements.autoCommentOwnPostId) {
    const previous = new Set(
      autoCommentSelectedTechhubIds.map((id) => String(id))
    );
    elements.autoCommentOwnPostId.innerHTML = options || '<option value="" disabled>Chưa có bài để chọn</option>';
    for (const option of elements.autoCommentOwnPostId.options) {
      option.selected = previous.has(option.value);
    }
  }
  if (elements.deleteTechhubId) {
    const previous = new Set(deleteSelectedTechhubIds.map((id) => String(id)));
    elements.deleteTechhubId.innerHTML = options || '<option value="" disabled>Chưa có bài để chọn</option>';
    for (const option of elements.deleteTechhubId.options) {
      option.selected = previous.has(option.value);
    }
    renderDeleteSelectedLabel();
  }
  if (elements.myDiscussionPostId) {
    const previous = elements.myDiscussionPostId.value;
    elements.myDiscussionPostId.innerHTML = `<option value="">Chọn một bài…</option>${options}`;
    elements.myDiscussionPostId.value = cachedPosts.some(
      (post) => String(post.techhub_id) === previous
    )
      ? previous
      : "";
  }
  renderPostPickers();
  updateScopeLabels();
}

function updateSelectedPostLabel(notify = false) {
  const post = cachedPosts.find((p) => Number(p.techhub_id) === selectedTechhubId);
  const autoCommentPosts = autoCommentSelectedTechhubIds
    .map((id) => cachedPosts.find((p) => Number(p.techhub_id) === Number(id)))
    .filter(Boolean);
  const autoCommentPost = autoCommentPosts[0] || null;
  if (elements.statSelected) {
    elements.statSelected.textContent = post ? `#${post.techhub_id}` : "—";
  }
  if (elements.statSelectedTitle) {
    elements.statSelectedTitle.textContent = post
      ? post.title || "(không tiêu đề)"
      : "Chưa chọn bài nào";
  }

  if (!autoCommentPost) {
    showAdminMsg(elements.selectedPostLabel, "Chưa chọn bài", "muted");
    return;
  }
  if (elements.autoCommentOwnPostId) {
    const selectedValues = new Set(autoCommentPosts.map((post) => String(post.techhub_id)));
    for (const option of elements.autoCommentOwnPostId.options) {
      option.selected = selectedValues.has(option.value);
    }
  }
  if (autoCommentPosts.length > 1) {
    const ids = autoCommentPosts.map((post) => `#${post.techhub_id}`).join(", ");
    showAdminMsg(elements.selectedPostLabel, `Đã chọn ${autoCommentPosts.length} bài: ${ids}`, "info");
    return;
  }
  const detail = `#${autoCommentPost.techhub_id} · ${autoCommentPost.status || "-"} · cmt=${
    autoCommentPost.comments_count ?? 0
  } · vote=${autoCommentPost.votes_score ?? 0} · medal=${
    autoCommentPost.medals_count ?? 0
  } · điểm=${formatPostScore(calcPostScore(autoCommentPost))} · ${
    autoCommentPost.title || ""
  }`;
  showAdminMsg(elements.selectedPostLabel, `Đã chọn ${detail}`, "info");
  if (notify) {
    showAdminMsg(
      elements.postsMessage,
      `Đã chọn ${detail} — dùng cho Auto comment / Hẹn xóa bài / phạm vi AI.`,
      "success"
    );
  }
}

function renderAutoCommentSchedule(schedules) {
  if (!elements.autoCommentScheduleInfo) return;
  const list = (Array.isArray(schedules) ? schedules : [schedules])
    .filter((schedule) => schedule?.techhubId && schedule?.startAt)
    .slice(-5);
  const waiting = list.filter((schedule) => (schedule.status || "waiting") === "waiting");
  if (elements.cancelAutoCommentScheduleBtn) {
    elements.cancelAutoCommentScheduleBtn.disabled = waiting.length === 0;
  }
  if (elements.scheduleAutoCommentBtn) {
    elements.scheduleAutoCommentBtn.disabled = waiting.length >= 5;
  }
  if (!list.length) {
    showAdminMsg(elements.autoCommentScheduleInfo, "Chưa có lịch hẹn.", "muted");
    return;
  }
  elements.autoCommentScheduleInfo.classList.remove("hidden", "muted", "error");
  elements.autoCommentScheduleInfo.classList.add("info");
  elements.autoCommentScheduleInfo.innerHTML = list
    .map((schedule, index) => {
      const status = schedule.status || "waiting";
      const statusText = status === "activated" ? "Đã kích hoạt" : status === "error" ? "Lỗi" : "Đang chờ";
      const base =
        `Lịch ${index + 1} · bài #${schedule.techhubId} · ${formatDateTime(schedule.startAt)}` +
        ` · ${schedule.targetCount || "?"} cmt/${schedule.completionMinutes || 1} phút` +
        (schedule.autoDeleteEnabled
          ? ` · tự xóa sau ${schedule.deleteAfterMinutes || 1} phút`
          : " · không tự xóa");
      return `<div><strong>${escapeHtml(statusText)}</strong> · ${escapeHtml(base)}${
        schedule.lastError ? ` · ${escapeHtml(schedule.lastError)}` : ""
      }</div>`;
    })
    .join("");
}

function renderAutoCommentStatus(state, message = "", type = "info") {
  if (!state) return;
  currentAutoCommentState = { ...state };
  const lockedTechhubId = Number(state.active ? state.techhubId : state.schedule?.techhubId);
  if (
    autoCommentSelectedTechhubIds.length === 0 &&
    Number.isInteger(lockedTechhubId) &&
    lockedTechhubId > 0
  ) {
    autoCommentSelectedTechhubId = lockedTechhubId;
    autoCommentSelectedTechhubIds = [lockedTechhubId];
  }
  const activeJobs = Array.isArray(state.jobs) ? state.jobs.filter((job) => job.active) : [];
  renderAutoCommentJobsLog(Array.isArray(state.jobs) ? state.jobs : []);
  const activeJobCount = Number(state.activeJobCount) || activeJobs.length || (state.active ? 1 : 0);
  const maxJobs = Number(state.maxJobs) || 5;
  elements.startAutoCommentBtn.disabled = activeJobCount >= maxJobs;
  elements.stopAutoCommentBtn.disabled = activeJobCount === 0;
  setJobFlag("comment", activeJobCount > 0);
  renderAutoCommentSchedule(state.schedules?.length ? state.schedules : state.schedule);
  updateSelectedPostLabel();
  const targetState = state.active ? state : state.schedule;
  if (targetState?.isExternalTarget && targetState.techhubId) {
    if (elements.autoCommentExternalPostId && activeJobCount === 0) {
      elements.autoCommentExternalPostId.value = String(targetState.techhubId);
    }
    showAdminMsg(
      elements.selectedPostLabel,
      `Đang dùng bài thành viên khác #${targetState.techhubId}`,
      "info"
    );
  }

  const waitingSchedule = (state.schedules || []).find(
    (schedule) => (schedule.status || "waiting") === "waiting"
  ) || (!state.schedules?.length && state.schedule?.techhubId ? state.schedule : null);
  const statusText = state.active ? "Đang chạy" : waitingSchedule ? "Đang chờ" : "Đã dừng";
  const jobsDetail = activeJobs.length > 1
    ? activeJobs
        .map(
          (job, index) =>
            `job ${index + 1}: #${job.techhubId} · ${job.commentCount || 0}/${job.targetCount || "?"}` +
            (job.autoDeleteEnabled ? ` · tự xóa ${job.deleteAfterMinutes || 1}p` : " · không xóa")
        )
        .join(" | ")
    : null;
  const detail = jobsDetail
    ? `Đang chạy ${activeJobCount}/${maxJobs} · ${jobsDetail}`
    : state.active && state.techhubId
      ? `${statusText} · bài #${state.techhubId} · ${state.commentCount || 0}/${
          state.targetCount || "?"
        } cmt · @${state.username || "-"}`
    : waitingSchedule
      ? `${statusText} · bài #${waitingSchedule.techhubId} · 0/${
          waitingSchedule.targetCount || "?"
        } cmt`
      : statusText;
  const displayedTarget = state.active
    ? state.targetCount
    : waitingSchedule?.targetCount || state.targetCount;
  if (displayedTarget && elements.autoCommentTargetCount && activeJobCount === 0) {
    elements.autoCommentTargetCount.value = String(displayedTarget);
  }
  const completionMinutes = state.active
    ? state.completionMinutes
    : waitingSchedule?.completionMinutes;
  if (completionMinutes && elements.autoCommentCompletionMinutes && activeJobCount === 0) {
    elements.autoCommentCompletionMinutes.value = String(completionMinutes);
  }
  const deleteSettings = state.active
    ? state
    : waitingSchedule?.techhubId
      ? waitingSchedule
      : null;
  if (elements.autoCommentAutoDelete && deleteSettings && activeJobCount === 0) {
    elements.autoCommentAutoDelete.checked = !!deleteSettings.autoDeleteEnabled;
  }
  if (
    elements.autoCommentDeleteAfterMinutes &&
    deleteSettings?.deleteAfterMinutes &&
    activeJobCount === 0
  ) {
    elements.autoCommentDeleteAfterMinutes.value = String(deleteSettings.deleteAfterMinutes);
  }
  const deleteQueueText = [
    state.deleteQueue?.pending ? `chờ xóa ${state.deleteQueue.pending} cmt` : null,
    state.deleteQueue?.error ? `xóa lỗi ${state.deleteQueue.error} cmt` : null,
  ]
    .filter(Boolean)
    .map((part) => ` · ${part}`)
    .join("");
  showAdminMsg(
    elements.autoCommentMessage,
    message ? `${message} ${detail}${deleteQueueText}` : `${detail}${deleteQueueText}`,
    state.lastError ? "error" : type
  );
}

function renderAutoCommentJobsLog(jobs) {
  if (!elements.autoCommentJobsLog) return;
  const list = Array.isArray(jobs) ? jobs.slice(-5) : [];
  if (!list.length) {
    elements.autoCommentJobsLog.innerHTML =
      '<div class="empty">Chưa có job auto comment.</div>';
    return;
  }
  elements.autoCommentJobsLog.innerHTML = list
    .map((job, index) => {
      const target = Number(job.targetCount) || 0;
      const count = Number(job.commentCount) || 0;
      const completed = target > 0 && count >= target;
      const status = job.active
        ? "Đang chạy"
        : job.lastError
          ? "Lỗi"
          : completed
            ? "Hoàn tất"
            : "Đã dừng";
      const statusClass = job.active
        ? "pending"
        : job.lastError
          ? "error"
          : completed
            ? "done"
            : "error";
      const deleteMode = job.autoDeleteEnabled
        ? `Tự xóa sau ${Number(job.deleteAfterMinutes) || 1} phút`
        : "Không tự xóa";
      const lastActivity = job.lastCommentAt
        ? `Comment gần nhất: ${formatDateTime(job.lastCommentAt)}`
        : `Bắt đầu: ${formatDateTime(job.startedAt)}`;
      return (
        `<div class="schedule-item ${statusClass}">` +
        `<div class="schedule-main"><strong>Job ${index + 1} · bài #${Number(job.techhubId) || "-"}</strong>` +
        `<span class="badge ${statusClass}">${status}</span></div>` +
        `<div class="schedule-meta">Tiến độ ${count}/${target || "?"} · ${escapeHtml(deleteMode)}</div>` +
        `<div class="schedule-meta">${escapeHtml(lastActivity)}</div>` +
        (job.lastError
          ? `<div class="schedule-meta bad">${escapeHtml(job.lastError)}</div>`
          : "") +
        `</div>`
      );
    })
    .join("");
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

function renderAutoCommentDeleteLog(items) {
  if (!elements.autoCommentDeleteLog) return;
  const list = Array.isArray(items) ? items.slice(0, 50) : [];
  if (!list.length) {
    elements.autoCommentDeleteLog.innerHTML =
      '<div class="empty">Chưa có comment nào trong hàng đợi tự xóa.</div>';
    return;
  }
  elements.autoCommentDeleteLog.innerHTML = list
    .map((item) => {
      const status = ["pending", "done", "error"].includes(item.status)
        ? item.status
        : "error";
      const statusText =
        status === "pending" ? "Chờ xóa" : status === "done" ? "Đã xóa" : "Xóa lỗi";
      const timing =
        status === "pending"
          ? `Dự kiến: ${formatDateTime(item.deleteAt)}`
          : `Hoàn tất: ${formatDateTime(item.completedAt)}`;
      const error = item.lastError
        ? `<div class="schedule-meta">${escapeHtml(item.lastError)}</div>`
        : "";
      return (
        `<div class="schedule-item ${status}">` +
        `<div class="schedule-main">` +
        `<div class="schedule-title">#${Number(item.commentId)} · bài #${Number(
          item.techhubId
        )} · ${statusText}</div>` +
        `<div class="schedule-meta">Tạo: ${escapeHtml(
          formatDateTime(item.createdAt)
        )} · ${escapeHtml(timing)} · thử ${Number(item.attempts || 0)} lần</div>` +
        error +
        `</div></div>`
      );
    })
    .join("");
}

async function loadAutoCommentDeleteLog() {
  try {
    const response = await sendMessage({ action: "getAutoCommentDeleteLog" });
    if (!response?.success) throw new Error(response?.error || "Không đọc được nhật ký");
    renderAutoCommentDeleteLog(response.items || []);
  } catch (error) {
    if (elements.autoCommentDeleteLog) {
      elements.autoCommentDeleteLog.innerHTML =
        `<div class="empty">Lỗi đọc nhật ký: ${escapeHtml(error.message)}</div>`;
    }
  }
}

function readAutoCommentDeleteOptions() {
  const autoDeleteEnabled = !!elements.autoCommentAutoDelete?.checked;
  const deleteAfterMinutes = Number(elements.autoCommentDeleteAfterMinutes?.value);
  if (
    autoDeleteEnabled &&
    (!Number.isFinite(deleteAfterMinutes) ||
      deleteAfterMinutes < 1 ||
      deleteAfterMinutes > 1440)
  ) {
    throw new Error("Thời gian tự xóa phải từ 1 đến 1440 phút.");
  }
  const completionMinutes = Number(elements.autoCommentCompletionMinutes?.value);
  if (!Number.isInteger(completionMinutes) || completionMinutes < 1 || completionMinutes > 1440) {
    throw new Error("Thời gian hoàn thành phải từ 1 đến 1440 phút.");
  }
  return { autoDeleteEnabled, deleteAfterMinutes, completionMinutes };
}

function getAutoCommentTargets() {
  const rawExternalId = elements.autoCommentExternalPostId?.value?.trim() || "";
  if (rawExternalId) {
    const techhubId = Number(rawExternalId);
    if (!Number.isInteger(techhubId) || techhubId < 1) {
      throw new Error("ID bài thành viên khác phải là số nguyên dương.");
    }
    return [{ techhubId, isExternalTarget: true }];
  }
  const techhubIds = [...new Set(autoCommentSelectedTechhubIds.map(Number))].filter(
    (techhubId) => Number.isInteger(techhubId) && techhubId > 0
  );
  if (techhubIds.length < 1 || techhubIds.length > 5) {
    throw new Error("Hãy chọn từ 1 đến 5 bài của anh hoặc nhập ID bài thành viên khác.");
  }
  return techhubIds.map((techhubId) => ({ techhubId, isExternalTarget: false }));
}

function assertAutoCommentBatchCapacity(targets, mode) {
  const state = currentAutoCommentState || {};
  const isSchedule = mode === "schedule";
  const existing = isSchedule
    ? (state.schedules || []).filter(
        (schedule) => (schedule.status || "waiting") === "waiting"
      )
    : (state.jobs || []).filter((job) => job.active);
  const max = Number(isSchedule ? state.maxSchedules : state.maxJobs) || 5;
  const duplicate = targets.find((target) =>
    existing.some((item) => Number(item.techhubId) === target.techhubId)
  );
  if (duplicate) {
    throw new Error(
      `Bài #${duplicate.techhubId} đã có ${isSchedule ? "lịch đang chờ" : "job đang chạy"}.`
    );
  }
  const remaining = Math.max(0, max - existing.length);
  if (targets.length > remaining) {
    throw new Error(
      `Hiện chỉ còn ${remaining}/${max} vị trí ${isSchedule ? "lịch hẹn" : "job"}. Hãy chọn ít bài hơn.`
    );
  }
}

async function startAutoComment() {
  let targets;
  try {
    targets = getAutoCommentTargets();
    assertAutoCommentBatchCapacity(targets, "start");
  } catch (error) {
    showAdminMsg(elements.autoCommentMessage, error.message, "error");
    return;
  }
  const targetCount = Number(elements.autoCommentTargetCount?.value);
  if (!Number.isInteger(targetCount) || targetCount < 1) {
    showAdminMsg(elements.autoCommentMessage, "Nhập số lượng cmt mong muốn (>= 1)", "error");
    return;
  }
  let deleteOptions;
  try {
    deleteOptions = readAutoCommentDeleteOptions();
  } catch (error) {
    showAdminMsg(elements.autoCommentMessage, error.message, "error");
    return;
  }

  const postIds = targets.map((target) => `#${target.techhubId}`).join(", ");
  const confirmed = window.confirm(
    `Bắt đầu auto comment cho ${targets.length} bài (${postIds}), mỗi bài ${targetCount} cmt trong khoảng ${deleteOptions.completionMinutes} phút?\n\n` +
      (deleteOptions.autoDeleteEnabled
        ? `Mỗi comment sẽ tự xóa sau ${deleteOptions.deleteAfterMinutes} phút.\n\n`
        : "") +
      "Tần suất này có thể khiến TechHub giới hạn tài khoản."
  );
  if (!confirmed) return;

  elements.startAutoCommentBtn.disabled = true;
  let startedCount = 0;
  try {
    showAdminMsg(
      elements.autoCommentMessage,
      `Đang khởi động ${targets.length} job...`,
      "muted"
    );
    let latestState = null;
    for (const target of targets) {
      const response = await sendMessage({
        action: "startAutoComment",
        ...target,
        targetCount,
        ...deleteOptions,
      });
      if (!response?.success) {
        throw new Error(
          `Bài #${target.techhubId}: ${response?.error || "không thể bắt đầu auto comment"}`
        );
      }
      startedCount += 1;
      latestState = response.state;
    }
    renderAutoCommentStatus(
      latestState,
      `Đã khởi động ${startedCount} job cho ${startedCount} bài.`,
      "success"
    );
  } catch (error) {
    await loadAutoCommentStatus();
    showAdminMsg(
      elements.autoCommentMessage,
      `${startedCount ? `Đã khởi động ${startedCount}/${targets.length} job. ` : ""}Lỗi: ${error.message}`,
      "error"
    );
  } finally {
    const activeCount = (currentAutoCommentState?.jobs || []).filter((job) => job.active).length;
    const maxJobs = Number(currentAutoCommentState?.maxJobs) || 5;
    elements.startAutoCommentBtn.disabled = activeCount >= maxJobs;
  }
}

function setDefaultAutoCommentStartAt() {
  if (!elements.autoCommentStartAt || elements.autoCommentStartAt.value) return;
  elements.autoCommentStartAt.value = toLocalInputValue(new Date(Date.now() + 10 * 60 * 1000));
}

async function scheduleAutoComment() {
  let targets;
  try {
    targets = getAutoCommentTargets();
    assertAutoCommentBatchCapacity(targets, "schedule");
  } catch (error) {
    showAdminMsg(elements.autoCommentMessage, error.message, "error");
    return;
  }
  const targetCount = Number(elements.autoCommentTargetCount?.value);
  if (!Number.isInteger(targetCount) || targetCount < 1) {
    showAdminMsg(elements.autoCommentMessage, "Nhập số lượng cmt mong muốn (>= 1)", "error");
    return;
  }
  let deleteOptions;
  try {
    deleteOptions = readAutoCommentDeleteOptions();
  } catch (error) {
    showAdminMsg(elements.autoCommentMessage, error.message, "error");
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
  let scheduledCount = 0;
  try {
    let latestState = null;
    for (const target of targets) {
      const response = await sendMessage({
        action: "scheduleAutoComment",
        ...target,
        targetCount,
        startAt: startAt.toISOString(),
        ...deleteOptions,
      });
      if (!response?.success) {
        throw new Error(`Bài #${target.techhubId}: ${response?.error || "không hẹn được"}`);
      }
      scheduledCount += 1;
      latestState = response.state;
    }
    renderAutoCommentStatus(
      latestState,
      `Đã hẹn ${scheduledCount} bài chạy lúc ${formatTime(startAt)}.`,
      "success"
    );
  } catch (error) {
    await loadAutoCommentStatus();
    showAdminMsg(
      elements.autoCommentMessage,
      `${scheduledCount ? `Đã hẹn ${scheduledCount}/${targets.length} bài. ` : ""}Lỗi: ${error.message}`,
      "error"
    );
  } finally {
    const waitingCount = (currentAutoCommentState?.schedules || []).filter(
      (schedule) => (schedule.status || "waiting") === "waiting"
    ).length;
    const maxSchedules = Number(currentAutoCommentState?.maxSchedules) || 5;
    elements.scheduleAutoCommentBtn.disabled = waitingCount >= maxSchedules;
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

function setPostsUltraCredits(value) {
  const nextCredits = Math.max(0, Math.trunc(Number(value) || 0));
  if (availableUltraCredits === nextCredits) return;
  availableUltraCredits = nextCredits;
  renderMyPosts(cachedPosts);
}

globalThis.setPostsUltraCredits = setPostsUltraCredits;

function renderMyPosts(posts) {
  cachedPosts = Array.isArray(posts) ? posts : [];
  // Job auto-comment cũ không được giữ một lựa chọn không còn trong danh sách.
  if (
    Number.isInteger(selectedTechhubId) &&
    !cachedPosts.some((post) => Number(post.techhub_id) === selectedTechhubId)
  ) {
    selectedTechhubId = null;
  }
  autoCommentSelectedTechhubIds = autoCommentSelectedTechhubIds.filter((techhubId) =>
    cachedPosts.some((post) => Number(post.techhub_id) === techhubId)
  );
  autoCommentSelectedTechhubId = autoCommentSelectedTechhubIds[0] || null;
  deleteSelectedTechhubIds = deleteSelectedTechhubIds.filter((techhubId) =>
    cachedPosts.some((post) => Number(post.techhub_id) === techhubId)
  );
  populateAiPostSelectors();
  if (!elements.myPostsList) return;

  const totalScore = cachedPosts.reduce((sum, p) => sum + calcPostScore(p), 0);
  if (elements.statPosts) elements.statPosts.textContent = String(cachedPosts.length);
  if (elements.statScore) elements.statScore.textContent = formatPostScore(totalScore);
  if (elements.postsUltraNotice) {
    elements.postsUltraNotice.classList.toggle("hidden", availableUltraCredits < 1);
    elements.postsUltraNotice.textContent = availableUltraCredits > 0
      ? `Bạn có ${availableUltraCredits} lượt Ultra. Chọn “Đẩy Ultra” tại bài muốn ưu tiên.`
      : "";
  }

  if (cachedPosts.length === 0) {
    elements.myPostsList.innerHTML =
      '<div class="empty">Chưa có bài đã lưu. Bấm <strong>Đồng bộ bài</strong> để lấy từ TechHub.</div>';
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
      const title = escapeHtml(p.title || "(không tiêu đề)");
      const status = escapeHtml(p.status || "-");
      const statusClass = status === "open" ? "open" : "other";
      const url = escapeHtml(resolvePostUrl(p));
      const comments = Number(p.comments_count) || 0;
      const votes = Number(p.votes_score) || 0;
      const medals = Number(p.medals_count) || 0;
      const score = formatPostScore(calcPostScore(p));
      const canRedeemUltra =
        availableUltraCredits > 0 && String(p.verification_status || "") === "verified";
      return (
        `<tr data-techhub-id="${id}">` +
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
        (availableUltraCredits > 0
          ? `<td class="cell-action">${
              canRedeemUltra
                ? `<button type="button" class="mini-btn" data-ultra-post-id="${id}">Đẩy Ultra</button>`
                : ""
            }</td>`
          : "") +
        `</tr>`
      );
    })
    .join("");

  elements.myPostsList.innerHTML =
    '<table class="data-table"><thead><tr>' +
    "<th>Tiêu đề</th><th>Điểm</th><th>Medal</th><th>Vote</th><th>Cmt</th>" +
    `<th>Trạng thái</th><th>Ngày tạo</th>${availableUltraCredits > 0 ? "<th>Ultra</th>" : ""}` +
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
    showAdminMsg(elements.postsMessage, "Đang đồng bộ bài từ TechHub...", "muted");
    const response = await sendMessage({ action: "syncMyPosts" });
    if (!response?.success) throw new Error(response?.error || "Đồng bộ bài thất bại");
    renderMyPosts(response.posts || []);
    showAdminMsg(
      elements.postsMessage,
      response.message || `Đã sync bài của @${response.username || "-"}`,
      "success"
    );
  } catch (error) {
    showAdminMsg(elements.postsMessage, `Lỗi đồng bộ bài: ${error.message}`, "error");
  } finally {
    elements.syncMyPostsBtn.disabled = false;
  }
}

function renderReplyDrafts(drafts = []) {
  const list = Array.isArray(drafts) ? drafts : [];
  currentReplyDrafts = list;
  const pending = list.filter((draft) => draft.status === "pending");
  const used = list.filter((draft) => draft.status === "used");
  pendingReplyDraftCount = pending.length;
  if (elements.replyDraftStats) {
    elements.replyDraftStats.innerHTML =
      `<span>Tổng <strong>${list.length}</strong></span>` +
      `<span class="pending">Chưa dùng <strong>${pending.length}</strong></span>` +
      `<span class="used">Đã dùng <strong>${used.length}</strong></span>`;
  }
  if (elements.clearPendingReplyDraftsBtn) {
    elements.clearPendingReplyDraftsBtn.disabled = pending.length === 0;
  }
  if (elements.replyDraftsList) {
    elements.replyDraftsList.innerHTML = list.length
      ? list
          .map(
            (draft, index) =>
              `<article class="draft-item ${escapeHtml(draft.status || "pending")}">` +
              `<div class="draft-head"><strong>Mẫu ${index + 1} · cmt #${escapeHtml(
                String(draft.parent_comment_id || "?")
              )}</strong>` +
              `<div class="draft-status-actions"><span>${
                draft.status === "used"
                  ? "Đã dùng"
                  : draft.status === "posting"
                    ? "Đang đăng"
                    : "Chưa dùng"
              }</span>${
                draft.status === "pending"
                  ? `<button type="button" class="draft-edit-btn" data-edit-reply-draft="${Number(
                      draft.id
                    )}">Chỉnh sửa</button>` +
                    `<button type="button" class="draft-delete-btn" data-delete-reply-draft="${Number(
                      draft.id
                    )}">Xóa</button>`
                  : ""
              }</div></div>` +
              (draft.comment_body
                ? `<p class="draft-source">${escapeHtml(
                    String(draft.comment_body).slice(0, 220)
                  )}</p>`
                : "") +
              `<p>${escapeHtml(draft.reply_body || "")}</p>` +
              `</article>`
          )
          .join("")
      : `<div class="empty">${
          resolveScopeTechhubId(elements.replyScope)
            ? "Bài này chưa có mẫu. Hãy nhờ AI tạo mẫu."
            : "Chọn bài để tải các mẫu đã tạo."
        }</div>`;
  }
  const hasPost = !!resolveScopeTechhubId(elements.replyScope);
  if (elements.autoReplyEnabled && !elements.autoReplyEnabled.checked) {
    elements.autoReplyEnabled.disabled = !hasPost || pending.length === 0;
  }
  if (elements.runAutoReplyBtn) {
    elements.runAutoReplyBtn.disabled = !hasPost || pending.length === 0;
  }
}

async function editReplyDraft(id) {
  const draft = currentReplyDrafts.find((item) => Number(item.id) === id);
  if (!draft || draft.status !== "pending") return;
  const body = window.prompt("Chỉnh sửa nội dung trả lời:", draft.reply_body || "");
  if (body === null) return;
  const content = body.trim();
  if (!content) {
    showAdminMsg(elements.replyDraftMessage, "Nội dung không được để trống.", "error");
    return;
  }
  try {
    const response = await sendMessage({ action: "updateReplyDraft", id, body: content });
    if (!response?.success) throw new Error(response?.error || "Không cập nhật được mẫu");
    showAdminMsg(elements.replyDraftMessage, "Đã cập nhật nội dung mẫu trả lời.", "success");
    await loadReplyDrafts();
  } catch (error) {
    showAdminMsg(elements.replyDraftMessage, `Lỗi chỉnh sửa: ${error.message}`, "error");
  }
}

async function deleteReplyDraft(id) {
  const draft = currentReplyDrafts.find((item) => Number(item.id) === id);
  if (!draft || draft.status !== "pending") return;
  if (!window.confirm("Xóa mẫu trả lời này? Không thể hoàn tác.")) return;
  try {
    const response = await sendMessage({ action: "deleteReplyDraft", id });
    if (!response?.success) throw new Error(response?.error || "Không xóa được mẫu");
    showAdminMsg(elements.replyDraftMessage, "Đã xóa mẫu trả lời.", "success");
    await loadReplyDrafts();
  } catch (error) {
    showAdminMsg(elements.replyDraftMessage, `Lỗi xóa mẫu: ${error.message}`, "error");
  }
}

async function clearPendingReplyDrafts() {
  const techhubId = resolveScopeTechhubId(elements.replyScope);
  if (!techhubId) {
    showAdminMsg(elements.replyDraftMessage, "Hãy chọn bài cần xóa mẫu.", "error");
    return;
  }
  if (pendingReplyDraftCount < 1) return;
  if (
    !window.confirm(
      `Xóa hết ${pendingReplyDraftCount} mẫu trả lời chưa dùng của bài #${techhubId}?`
    )
  ) {
    return;
  }
  elements.clearPendingReplyDraftsBtn.disabled = true;
  try {
    const response = await sendMessage({
      action: "deletePendingReplyDrafts",
      techhubId,
    });
    if (!response?.success) throw new Error(response?.error || "Không xóa được mẫu");
    renderReplyDrafts(response.drafts || []);
    showAdminMsg(elements.replyDraftMessage, response.message, "success");
  } catch (error) {
    showAdminMsg(elements.replyDraftMessage, `Lỗi xóa mẫu: ${error.message}`, "error");
    elements.clearPendingReplyDraftsBtn.disabled = pendingReplyDraftCount === 0;
  }
}

async function loadReplyDrafts() {
  const techhubId = resolveScopeTechhubId(elements.replyScope);
  if (!techhubId) {
    renderReplyDrafts([]);
    return;
  }
  try {
    if (elements.replyDraftsList) {
      elements.replyDraftsList.innerHTML = '<div class="empty">Đang tải mẫu…</div>';
    }
    const response = await sendMessage({ action: "getReplyDrafts", techhubId });
    if (!response?.success) throw new Error(response?.error || "Không tải được mẫu");
    renderReplyDrafts(response.drafts || []);
  } catch (error) {
    showAdminMsg(elements.replyDraftMessage, `Lỗi tải mẫu: ${error.message}`, "error");
    renderReplyDrafts([]);
  }
}

async function generateReplyDrafts() {
  const techhubId = resolveScopeTechhubId(elements.replyScope);
  const count = Number(elements.replyGenerateCount?.value);
  if (!techhubId) {
    showAdminMsg(elements.replyDraftMessage, "Hãy chọn bài cần tạo mẫu.", "error");
    return;
  }
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    showAdminMsg(elements.replyDraftMessage, "Số mẫu cần tạo phải từ 1 đến 50.", "error");
    return;
  }
  elements.generateReplyDraftsBtn.disabled = true;
  try {
    showAdminMsg(
      elements.replyDraftMessage,
      `Đang nhờ AI tạo tối đa ${count} mẫu. Vui lòng chờ…`,
      "muted"
    );
    const response = await sendMessage({
      action: "generateReplyDrafts",
      techhubId,
      count,
      maxConsecutiveSelfReplies: Number(elements.replySelfReplyLimit?.value) || 1,
    });
    if (!response?.success) throw new Error(response?.error || "Không tạo được mẫu");
    renderReplyDrafts(response.drafts || []);
    showAdminMsg(elements.replyDraftMessage, response.message, "success");
  } catch (error) {
    showAdminMsg(elements.replyDraftMessage, `Lỗi tạo mẫu: ${error.message}`, "error");
  } finally {
    elements.generateReplyDraftsBtn.disabled = false;
  }
}

function renderAutoReplyStatus(state, message = "", type = "info") {
  if (!state) return;
  if (elements.autoReplyEnabled) {
    elements.autoReplyEnabled.checked = !!state.enabled;
    elements.autoReplyEnabled.disabled =
      !state.enabled &&
      (!resolveScopeTechhubId(elements.replyScope) || pendingReplyDraftCount === 0);
  }
  if (state.targetTechhubId) {
    selectedTechhubId = Number(state.targetTechhubId);
    if (elements.replyScope) elements.replyScope.value = String(state.targetTechhubId);
  }
  if (elements.replyTargetCount && state.targetCount) {
    elements.replyTargetCount.value = String(state.targetCount);
  }
  if (elements.replyMinInterval && state.minIntervalMinutes) {
    elements.replyMinInterval.value = String(state.minIntervalMinutes);
  }
  if (elements.replyMaxInterval && state.maxIntervalMinutes) {
    elements.replyMaxInterval.value = String(state.maxIntervalMinutes);
  }
  if (elements.replySelfReplyLimit && state.maxConsecutiveSelfReplies) {
    elements.replySelfReplyLimit.value = String(state.maxConsecutiveSelfReplies);
  }
  if (elements.replyScope) elements.replyScope.disabled = !!state.enabled;
  setJobFlag("reply", !!state.enabled);
  updateScopeLabels();

  const scope = state.targetTechhubId ? `bài #${state.targetTechhubId}` : "chưa chọn bài";
  const target = Number(state.targetCount) || 5;
  const detail =
    `${state.enabled ? "Đang bật" : "Đang tắt"} · ${scope} · đã đăng ${
      state.completedCount || 0
    }/${target}` +
    (state.nextRunAt
      ? ` · lượt tới ${new Date(state.nextRunAt).toLocaleTimeString()}`
      : "");
  const runInfo = state.lastRunAt
    ? ` · lần chạy ${new Date(state.lastRunAt).toLocaleString()} · reply=${
        state.lastReplyCount || 0
      }`
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
  const techhubId = resolveScopeTechhubId(elements.replyScope);
  const targetCount = Number(elements.replyTargetCount?.value) || 5;
  const minIntervalMinutes = Number(elements.replyMinInterval?.value);
  const maxIntervalMinutes = Number(elements.replyMaxInterval?.value);
  const maxConsecutiveSelfReplies = Number(elements.replySelfReplyLimit?.value) || 1;
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 100) {
    elements.autoReplyEnabled.checked = false;
    showAdminMsg(elements.autoReplyMessage, "Số lượng đăng phải từ 1 đến 100.", "error");
    return;
  }
  if (enabled && !techhubId) {
    elements.autoReplyEnabled.checked = false;
    showAdminMsg(elements.autoReplyMessage, "Hãy chọn bài cần trả lời.", "error");
    return;
  }
  if (enabled && pendingReplyDraftCount < targetCount) {
    elements.autoReplyEnabled.checked = false;
    showAdminMsg(
      elements.autoReplyMessage,
      pendingReplyDraftCount === 0
        ? "Đã hết mẫu trả lời. Hãy nhờ AI tạo thêm mẫu."
        : `Chỉ còn ${pendingReplyDraftCount} mẫu chưa dùng. Hãy giảm số lượng hoặc tạo thêm mẫu.`,
      "error"
    );
    return;
  }
  elements.autoReplyEnabled.disabled = true;
  try {
    const response = await sendMessage({
      action: "setAutoReplyEnabled",
      enabled,
      useAi: true,
      techhubId,
      maxConsecutiveSelfReplies,
      targetCount,
      minIntervalMinutes,
      maxIntervalMinutes,
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
    elements.autoReplyEnabled.disabled =
      !elements.autoReplyEnabled.checked &&
      (!techhubId || pendingReplyDraftCount === 0);
  }
}

async function runAutoReplyOnce() {
  const techhubId = resolveScopeTechhubId(elements.replyScope);
  if (!techhubId) {
    showAdminMsg(elements.autoReplyMessage, "Hãy chọn bài cần trả lời.", "error");
    return;
  }
  elements.runAutoReplyBtn.disabled = true;
  try {
    showAdminMsg(elements.autoReplyMessage, "Đang đăng mẫu trả lời...", "muted");
    const response = await sendMessage({
      action: "runAutoReplyOnce",
      techhubId,
    });
    if (!response?.success) {
      renderAutoReplyStatus(response?.state, response?.error || "Thất bại", "error");
      throw new Error(response?.error || "Auto-reply thất bại");
    }
    renderAutoReplyStatus(response.state, response.message || "Xong.", "success");
    await loadReplyDrafts();
  } catch (error) {
    showAdminMsg(elements.autoReplyMessage, `Lỗi: ${error.message}`, "error");
  } finally {
    elements.runAutoReplyBtn.disabled = pendingReplyDraftCount === 0;
  }
}

function renderDiscussionDrafts(drafts = []) {
  const list = Array.isArray(drafts) ? drafts : [];
  currentDiscussionDrafts = list;
  const pending = list.filter((draft) => draft.status === "pending");
  const used = list.filter((draft) => draft.status === "used");
  pendingDiscussionDraftCount = pending.length;
  if (elements.discussionDraftStats) {
    elements.discussionDraftStats.innerHTML =
      `<span>Tổng <strong>${list.length}</strong></span>` +
      `<span class="pending">Chưa dùng <strong>${pending.length}</strong></span>` +
      `<span class="used">Đã dùng <strong>${used.length}</strong></span>`;
  }
  if (elements.clearPendingDiscussionDraftsBtn) {
    elements.clearPendingDiscussionDraftsBtn.disabled = pending.length === 0;
  }
  if (elements.discussionDraftsList) {
    elements.discussionDraftsList.innerHTML = list.length
      ? list
          .map(
            (draft, index) =>
              `<article class="draft-item ${escapeHtml(draft.status || "pending")}">` +
              `<div class="draft-head"><strong>Mẫu ${index + 1}</strong>` +
              `<div class="draft-status-actions"><span>${
                draft.status === "used"
                  ? "Đã dùng"
                  : draft.status === "posting"
                    ? "Đang đăng"
                    : "Chưa dùng"
              }</span>${
                draft.status === "pending"
                  ? `<button type="button" class="draft-edit-btn" data-edit-discussion-draft="${Number(
                      draft.id
                    )}">Chỉnh sửa</button>` +
                    `<button type="button" class="draft-delete-btn" data-delete-discussion-draft="${Number(
                      draft.id
                    )}">Xóa</button>`
                  : ""
              }</div></div>` +
              `<p>${escapeHtml(draft.discussion_body || "")}</p>` +
              `</article>`
          )
          .join("")
      : `<div class="empty">${
          resolveScopeTechhubId(elements.discussionScope)
            ? "Bài này chưa có mẫu. Hãy nhờ AI tạo mẫu."
            : "Chọn bài để tải các mẫu đã tạo."
        }</div>`;
  }
  const hasPost = !!resolveScopeTechhubId(elements.discussionScope);
  if (elements.autoDiscussionEnabled && !elements.autoDiscussionEnabled.checked) {
    elements.autoDiscussionEnabled.disabled = !hasPost || pending.length === 0;
  }
  if (elements.runAutoDiscussionBtn) {
    elements.runAutoDiscussionBtn.disabled = !hasPost || pending.length === 0;
  }
}

async function editDiscussionDraft(id) {
  const draft = currentDiscussionDrafts.find((item) => Number(item.id) === id);
  if (!draft || draft.status !== "pending") return;
  const body = window.prompt("Chỉnh sửa nội dung thảo luận:", draft.discussion_body || "");
  if (body === null) return;
  const content = body.trim();
  if (!content) {
    showAdminMsg(elements.discussionDraftMessage, "Nội dung không được để trống.", "error");
    return;
  }
  try {
    const response = await sendMessage({
      action: "updateDiscussionDraft",
      id,
      body: content,
    });
    if (!response?.success) throw new Error(response?.error || "Không cập nhật được mẫu");
    showAdminMsg(
      elements.discussionDraftMessage,
      "Đã cập nhật nội dung mẫu thảo luận.",
      "success"
    );
    await loadDiscussionDrafts();
  } catch (error) {
    showAdminMsg(elements.discussionDraftMessage, `Lỗi chỉnh sửa: ${error.message}`, "error");
  }
}

async function deleteDiscussionDraft(id) {
  const draft = currentDiscussionDrafts.find((item) => Number(item.id) === id);
  if (!draft || draft.status !== "pending") return;
  if (!window.confirm("Xóa mẫu thảo luận này? Không thể hoàn tác.")) return;
  try {
    const response = await sendMessage({ action: "deleteDiscussionDraft", id });
    if (!response?.success) throw new Error(response?.error || "Không xóa được mẫu");
    showAdminMsg(elements.discussionDraftMessage, "Đã xóa mẫu thảo luận.", "success");
    await loadDiscussionDrafts();
  } catch (error) {
    showAdminMsg(elements.discussionDraftMessage, `Lỗi xóa mẫu: ${error.message}`, "error");
  }
}

async function clearPendingDiscussionDrafts() {
  const techhubId = resolveScopeTechhubId(elements.discussionScope);
  if (!techhubId) {
    showAdminMsg(elements.discussionDraftMessage, "Hãy chọn bài cần xóa mẫu.", "error");
    return;
  }
  if (pendingDiscussionDraftCount < 1) return;
  if (
    !window.confirm(
      `Xóa hết ${pendingDiscussionDraftCount} mẫu thảo luận chưa dùng của bài #${techhubId}?`
    )
  ) {
    return;
  }
  elements.clearPendingDiscussionDraftsBtn.disabled = true;
  try {
    const response = await sendMessage({
      action: "deletePendingDiscussionDrafts",
      techhubId,
    });
    if (!response?.success) throw new Error(response?.error || "Không xóa được mẫu");
    renderDiscussionDrafts(response.drafts || []);
    showAdminMsg(elements.discussionDraftMessage, response.message, "success");
  } catch (error) {
    showAdminMsg(
      elements.discussionDraftMessage,
      `Lỗi xóa mẫu: ${error.message}`,
      "error"
    );
    elements.clearPendingDiscussionDraftsBtn.disabled =
      pendingDiscussionDraftCount === 0;
  }
}

async function loadDiscussionDrafts() {
  const techhubId = resolveScopeTechhubId(elements.discussionScope);
  if (!techhubId) {
    renderDiscussionDrafts([]);
    return;
  }
  try {
    if (elements.discussionDraftsList) {
      elements.discussionDraftsList.innerHTML = '<div class="empty">Đang tải mẫu…</div>';
    }
    const response = await sendMessage({ action: "getDiscussionDrafts", techhubId });
    if (!response?.success) throw new Error(response?.error || "Không tải được mẫu");
    renderDiscussionDrafts(response.drafts || []);
  } catch (error) {
    showAdminMsg(elements.discussionDraftMessage, `Lỗi tải mẫu: ${error.message}`, "error");
    renderDiscussionDrafts([]);
  }
}

async function generateDiscussionDrafts() {
  const techhubId = resolveScopeTechhubId(elements.discussionScope);
  const count = Number(elements.discussionGenerateCount?.value);
  if (!techhubId) {
    showAdminMsg(elements.discussionDraftMessage, "Hãy chọn bài cần tạo mẫu.", "error");
    return;
  }
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    showAdminMsg(elements.discussionDraftMessage, "Số mẫu cần tạo phải từ 1 đến 50.", "error");
    return;
  }
  elements.generateDiscussionDraftsBtn.disabled = true;
  try {
    showAdminMsg(
      elements.discussionDraftMessage,
      `Đang nhờ AI tạo ${count} mẫu. Vui lòng chờ…`,
      "muted"
    );
    const response = await sendMessage({ action: "generateDiscussionDrafts", techhubId, count });
    if (!response?.success) throw new Error(response?.error || "Không tạo được mẫu");
    renderDiscussionDrafts(response.drafts || []);
    showAdminMsg(elements.discussionDraftMessage, response.message, "success");
  } catch (error) {
    showAdminMsg(elements.discussionDraftMessage, `Lỗi tạo mẫu: ${error.message}`, "error");
  } finally {
    elements.generateDiscussionDraftsBtn.disabled = false;
  }
}

function renderAutoDiscussionStatus(state, message = "", type = "info") {
  if (!state) return;
  if (elements.autoDiscussionEnabled) {
    elements.autoDiscussionEnabled.checked = !!state.enabled;
    elements.autoDiscussionEnabled.disabled =
      !state.enabled &&
      (!resolveScopeTechhubId(elements.discussionScope) || pendingDiscussionDraftCount === 0);
  }
  if (state.targetTechhubId) {
    selectedTechhubId = Number(state.targetTechhubId);
    if (elements.discussionScope) elements.discussionScope.value = String(state.targetTechhubId);
  }
  if (elements.discussionTargetCount && state.targetCount) {
    elements.discussionTargetCount.value = String(state.targetCount);
  }
  if (elements.discussionMinInterval && state.minIntervalMinutes) {
    elements.discussionMinInterval.value = String(state.minIntervalMinutes);
  }
  if (elements.discussionMaxInterval && state.maxIntervalMinutes) {
    elements.discussionMaxInterval.value = String(state.maxIntervalMinutes);
  }
  if (elements.discussionScope) elements.discussionScope.disabled = !!state.enabled;
  setJobFlag("discussion", !!state.enabled);
  updateScopeLabels();

  const scope = state.targetTechhubId ? `bài #${state.targetTechhubId}` : "chưa chọn bài";
  const target = Number(state.targetCount) || 5;
  const detail =
    `${state.enabled ? "Đang bật" : "Đang tắt"} · ${scope} · đã đăng ${
      state.completedCount || 0
    }/${target}` +
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
  const minIntervalMinutes = Number(elements.discussionMinInterval?.value);
  const maxIntervalMinutes = Number(elements.discussionMaxInterval?.value);
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 100) {
    elements.autoDiscussionEnabled.checked = false;
    showAdminMsg(
      elements.autoDiscussionMessage,
      "Số lần tự thảo luận phải từ 1 đến 100.",
      "error"
    );
    return;
  }
  if (enabled && !techhubId) {
    elements.autoDiscussionEnabled.checked = false;
    showAdminMsg(
      elements.autoDiscussionMessage,
      "Hãy chọn bài cần thảo luận.",
      "error"
    );
    return;
  }
  if (enabled && pendingDiscussionDraftCount < targetCount) {
    elements.autoDiscussionEnabled.checked = false;
    showAdminMsg(
      elements.autoDiscussionMessage,
      pendingDiscussionDraftCount === 0
        ? "Đã hết mẫu thảo luận. Hãy nhờ AI tạo thêm mẫu."
        : `Chỉ còn ${pendingDiscussionDraftCount} mẫu chưa dùng. Hãy giảm số lượng hoặc tạo thêm mẫu.`,
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
      minIntervalMinutes,
      maxIntervalMinutes,
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
    elements.autoDiscussionEnabled.disabled =
      !elements.autoDiscussionEnabled.checked &&
      (!techhubId || pendingDiscussionDraftCount === 0);
  }
}

async function runAutoDiscussionOnce() {
  const techhubId = resolveScopeTechhubId(elements.discussionScope);
  if (!techhubId) {
    showAdminMsg(
      elements.autoDiscussionMessage,
      "Hãy chọn bài cần thảo luận.",
      "error"
    );
    return;
  }
  elements.runAutoDiscussionBtn.disabled = true;
  try {
    showAdminMsg(elements.autoDiscussionMessage, "Đang đăng mẫu thảo luận...", "muted");
    const response = await sendMessage({
      action: "runAutoDiscussionOnce",
      techhubId,
    });
    if (!response?.success) {
      renderAutoDiscussionStatus(response?.state, response?.error || "Thất bại", "error");
      throw new Error(response?.error || "AI thảo luận thất bại");
    }
    renderAutoDiscussionStatus(response.state, response.message || "Xong.", "success");
    await loadDiscussionDrafts();
  } catch (error) {
    showAdminMsg(elements.autoDiscussionMessage, `Lỗi: ${error.message}`, "error");
  } finally {
    elements.runAutoDiscussionBtn.disabled = pendingDiscussionDraftCount === 0;
  }
}

function renderCommunityPosts(posts = []) {
  communityPosts = Array.isArray(posts) ? posts : [];
  if (!elements.communityPostsList) return;
  const selectedId = getExternalDiscussionId();
  const visible = communityPostsFilter
    ? communityPosts.filter((post) => {
        const haystack = `${post.title || ""} ${post.username || ""} ${
          post.techhub_id || ""
        }`.toLowerCase();
        return haystack.includes(communityPostsFilter);
      })
    : communityPosts;

  if (visible.length === 0) {
    elements.communityPostsList.innerHTML = `<div class="empty">${
      communityPosts.length
        ? "Không có bài nào khớp bộ lọc."
        : "Chưa tìm thấy bài nào trong chuyên mục này."
    }</div>`;
    return;
  }

  const rows = visible
    .map((post) => {
      const id = Number(post.techhub_id);
      const isOwn = !!post.is_own;
      const isOpen = String(post.status || "").toLowerCase() === "open";
      const canDiscuss = !isOwn && isOpen;
      const selected = id === selectedId;
      const statusLabel = isOwn ? "Bài của bạn" : isOpen ? "Đang mở" : post.status || "Đã đóng";
      const statusClass = isOpen && !isOwn ? "open" : "other";
      return (
        `<tr class="${selected ? "selected" : ""}">` +
        `<td class="cell-title">` +
        `<a class="post-link" href="${escapeHtml(
          post.url || "https://techhub.fpt.net/"
        )}" target="_blank" rel="noopener noreferrer">${escapeHtml(
          post.title || "(không tiêu đề)"
        )}</a>` +
        `<div class="post-sub"><span>#${id}</span><span>@${escapeHtml(
          post.username || "-"
        )}</span></div></td>` +
        `<td data-label="Điểm"><span class="score">${formatPostScore(
          calcPostScore(post)
        )}</span></td>` +
        `<td data-label="Medal"><span class="num">${Number(
          post.medals_count || 0
        )}</span></td>` +
        `<td data-label="Cmt"><span class="num">${Number(
          post.comments_count || 0
        )}</span></td>` +
        `<td data-label="Trạng thái"><span class="badge ${statusClass}">${escapeHtml(
          statusLabel
        )}</span></td>` +
        `<td class="cell-date" data-label="Ngày">${escapeHtml(
          formatRelativeDate(post.created_at || post.published_at)
        )}${post.published_at ? "" : " · chưa publish"}</td>` +
        `<td class="cell-action"><button type="button" class="mini-btn${
          selected ? " is-selected" : ""
        }" ${canDiscuss ? `data-community-select-id="${id}"` : "disabled"}>${
          selected ? "Đang chọn" : canDiscuss ? "Chọn thảo luận" : "Không thể chọn"
        }</button></td>` +
        `</tr>`
      );
    })
    .join("");

  elements.communityPostsList.innerHTML =
    '<table class="data-table"><thead><tr>' +
    "<th>Tiêu đề</th><th>Điểm</th><th>Medal</th><th>Cmt</th>" +
    "<th>Trạng thái</th><th>Ngày</th><th></th>" +
    `</tr></thead><tbody>${rows}</tbody></table>`;
}

function syncDashboardScopeFields() {
  const isCommunity = elements.dashboardScope?.value === "community";
  elements.dashboardCommunityField?.classList.toggle("hidden", !isCommunity);
}

function formatDelta(current, previous) {
  const diff = current - previous;
  if (diff === 0) return '<span class="delta flat">không đổi</span>';
  const percent = previous > 0 ? ` (${Math.round((diff / previous) * 100)}%)` : "";
  return `<span class="delta ${diff > 0 ? "up" : "down"}">${
    diff > 0 ? "+" : ""
  }${diff}${percent}</span>`;
}

function renderMonthlyStats(response) {
  const [current, previous] = response?.months || [];
  if (!current || !previous) return;

  if (elements.dashboardCards) {
    const cards = [
      { label: "Bài tạo mới", key: "created" },
      { label: "Bài được publish", key: "published" },
    ];
    elements.dashboardCards.innerHTML = cards
      .map(
        (card) =>
          `<div class="stat-card">` +
          `<span class="stat-label">${card.label} · ${escapeHtml(current.label)}</span>` +
          `<strong class="stat-value accent">${current[card.key]}</strong>` +
          `<span class="stat-hint">Tháng ${escapeHtml(previous.label)}: ${
            previous[card.key]
          } · ${formatDelta(current[card.key], previous[card.key])}</span>` +
          `</div>`
      )
      .join("");
  }

  if (elements.dashboardTable) {
    const rows = [current, previous]
      .map((month) => {
        const rate = month.created
          ? `${Math.round((month.published / month.created) * 100)}%`
          : "-";
        return (
          `<tr><td class="cell-title"><strong>Tháng ${escapeHtml(
            month.label
          )}</strong></td>` +
          `<td data-label="Bài tạo"><span class="num">${month.created}</span></td>` +
          `<td data-label="Publish"><span class="num">${month.published}</span></td>` +
          `<td data-label="Tỉ lệ publish"><span class="num">${rate}</span></td>` +
          `<td data-label="Medal"><span class="num">${month.medals}</span></td>` +
          `<td data-label="Cmt"><span class="num">${month.comments}</span></td></tr>`
        );
      })
      .join("");
    elements.dashboardTable.innerHTML =
      '<table class="data-table"><thead><tr>' +
      "<th>Tháng</th><th>Bài tạo</th><th>Publish</th><th>Tỉ lệ publish</th>" +
      "<th>Medal</th><th>Cmt</th>" +
      `</tr></thead><tbody>${rows}</tbody></table>`;
  }
}

async function loadMonthlyStats() {
  const scope = elements.dashboardScope?.value === "community" ? "community" : "own";
  const communitySlug = String(elements.dashboardCommunitySlug?.value || "")
    .trim()
    .toLowerCase();
  if (scope === "community" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(communitySlug)) {
    showAdminMsg(elements.dashboardMessage, "Slug chuyên mục không hợp lệ.", "error");
    return;
  }

  elements.refreshDashboardBtn.disabled = true;
  try {
    showAdminMsg(elements.dashboardMessage, "Đang tải số liệu từ TechHub...", "muted");
    const response = await sendMessage({
      action: "getMonthlyPostStats",
      scope,
      communitySlug,
    });
    if (!response?.success) {
      throw new Error(response?.error || "Không tải được số liệu");
    }
    renderMonthlyStats(response);
    showAdminMsg(
      elements.dashboardMessage,
      `Tính trên ${response.postCount} bài đã lưu ${
        scope === "community" ? `của chuyên mục ${communitySlug}` : `của @${response.username}`
      } · cập nhật ${formatRelativeDate(response.lastSyncedAt)}.`,
      "success"
    );
  } catch (error) {
    showAdminMsg(elements.dashboardMessage, `Lỗi thống kê: ${error.message}`, "error");
  } finally {
    elements.refreshDashboardBtn.disabled = false;
  }
}

function getCommunitySlugInput() {
  return String(elements.communitySlug?.value || "")
    .trim()
    .toLowerCase();
}

function isValidCommunitySlug(slug) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

async function loadCachedCommunityPosts(showEmptyMessage = false) {
  const communitySlug = getCommunitySlugInput();
  if (!isValidCommunitySlug(communitySlug)) {
    if (showEmptyMessage) {
      showAdminMsg(
        elements.communityPostsMessage,
        "Slug chỉ gồm chữ thường không dấu, số và dấu gạch ngang.",
        "error"
      );
    }
    return;
  }
  if (elements.loadCachedCommunityBtn) {
    elements.loadCachedCommunityBtn.disabled = true;
  }
  try {
    const response = await sendMessage({
      action: "getCachedCommunityPosts",
      communitySlug,
    });
    if (!response?.success) {
      throw new Error(response?.error || "Không đọc được dữ liệu đã lưu");
    }
    renderCommunityPosts(response.posts || []);
    if (response.posts?.length) {
      showAdminMsg(
        elements.communityPostsMessage,
        `Đang xem ${response.posts.length} bài đã lưu · cập nhật ${formatRelativeDate(
          response.lastSyncedAt
        )}. Bấm Làm mới từ TechHub khi cần dữ liệu mới.`,
        "muted"
      );
    } else if (showEmptyMessage) {
      showAdminMsg(
        elements.communityPostsMessage,
        "Chưa có dữ liệu đã lưu cho chuyên mục này. Hãy bấm Làm mới từ TechHub.",
        "muted"
      );
    }
  } catch (error) {
    if (showEmptyMessage) {
      showAdminMsg(
        elements.communityPostsMessage,
        `Lỗi đọc dữ liệu đã lưu: ${error.message}`,
        "error"
      );
    }
  } finally {
    if (elements.loadCachedCommunityBtn) {
      elements.loadCachedCommunityBtn.disabled = false;
    }
  }
}

function describeCommunityScan(response) {
  const found = Number(response?.refreshedCount);
  const listed = response?.posts?.length || 0;
  const pages = Number(response?.scannedPages) || 0;
  const months = Number(response?.months) || 1;
  const rangeLabel = response?.rangeLabel || `${months} tháng`;
  if (!listed && !(found > 0)) {
    return `Chưa tìm thấy bài nào trong ${rangeLabel}.`;
  }
  const parts = [
    `Đã làm mới ${Number.isFinite(found) ? found : listed} bài của ${rangeLabel} · gọi ${pages} trang TechHub.`,
  ];
  if (response.filterMode === "client") {
    parts.push(
      `TechHub không lọc trực tiếp theo chuyên mục nên đã lọc ${
        Number(response.scannedArticles) || 0
      } bài của feed chung.`
    );
  }
  if (response.reachedWindowEnd) {
    parts.push("Đã tới mốc thời gian nên dừng, không quét bài cũ hơn.");
  } else if (response.hasMore) {
    parts.push("Chuyên mục còn bài mới hơn mốc này nhưng đã chạm giới hạn an toàn.");
  }
  if (response.saveError) {
    parts.push(`Chưa lưu được vào hệ thống: ${response.saveError}`);
  } else if (response.communityColumnsMissing) {
    parts.push(
      "Đã lưu bài nhưng chưa gắn được chuyên mục; hãy chạy migration 010_posts_community.sql để dùng dữ liệu đã lưu."
    );
  } else if (response.saved) {
    parts.push(`Đã lưu ${response.saved} bài vào hệ thống.`);
  }
  return parts.join(" ");
}

async function scanCommunityArticles() {
  const communitySlug = getCommunitySlugInput();
  let range;
  try {
    range = getCommunityScanRangeFromUi();
  } catch (error) {
    showAdminMsg(elements.communityPostsMessage, error.message, "error");
    return;
  }
  if (!isValidCommunitySlug(communitySlug)) {
    showAdminMsg(
      elements.communityPostsMessage,
      "Slug chỉ gồm chữ thường không dấu, số và dấu gạch ngang.",
      "error"
    );
    return;
  }

  elements.scanCommunityBtn.disabled = true;
  try {
    showAdminMsg(
      elements.communityPostsMessage,
      `Đang làm mới ${range.label} của ${communitySlug}...`,
      "muted"
    );
    const response = await sendMessage({
      action: "scanCommunityArticles",
      communitySlug,
      fromMonth: range.fromMonth,
      toMonth: range.toMonth,
    });
    if (!response?.success) {
      throw new Error(response?.error || "Không quét được chuyên mục");
    }
    renderCommunityPosts(response.posts || []);
    await chrome.storage.local.set({
      [COMMUNITY_BROWSER_KEY]: {
        slug: communitySlug,
        fromMonth: range.fromMonth,
        toMonth: range.toMonth,
      },
    });
    showAdminMsg(
      elements.communityPostsMessage,
      describeCommunityScan(response),
      response.saveError || !response.posts?.length || response.hasMore
        ? "muted"
        : "success"
    );
  } catch (error) {
    renderCommunityPosts([]);
    showAdminMsg(
      elements.communityPostsMessage,
      `Lỗi quét chuyên mục: ${error.message}`,
      "error"
    );
  } finally {
    elements.scanCommunityBtn.disabled = false;
  }
}

async function selectCommunityPost(techhubId) {
  const post = communityPosts.find((item) => Number(item.techhub_id) === techhubId);
  if (
    !post ||
    post.is_own ||
    String(post.status || "").toLowerCase() !== "open" ||
    !elements.externalDiscussionPostId
  ) {
    return;
  }
  elements.externalDiscussionPostId.value = String(techhubId);
  if (
    externalDiscussionPost &&
    Number(externalDiscussionPost.techhub_id) !== techhubId
  ) {
    renderExternalPostPreview(null);
    renderExternalDiscussionDrafts([]);
  }
  renderCommunityPosts(communityPosts);
  showPanel("external-discussion");
  await loadExternalDiscussionPost();
}

function getExternalDiscussionId() {
  const id = Number(elements.externalDiscussionPostId?.value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function renderExternalPostPreview(post) {
  externalDiscussionPost = post || null;
  if (!elements.externalPostPreview) return;
  if (!post) {
    elements.externalPostPreview.classList.add("hidden");
    elements.externalPostPreview.innerHTML = "";
    if (elements.generateExternalDiscussionDraftsBtn) {
      elements.generateExternalDiscussionDraftsBtn.disabled = true;
    }
    return;
  }
  elements.externalPostPreview.classList.remove("hidden");
  elements.externalPostPreview.innerHTML =
    `<strong>#${Number(post.techhub_id)} · ${escapeHtml(
      post.title || "(không tiêu đề)"
    )}</strong>` +
    `<span>Tác giả @${escapeHtml(post.username || "?")} · trạng thái ${escapeHtml(
      post.status || "-"
    )} · ${
      post.published_at
        ? `publish ${escapeHtml(formatDateTime(post.published_at))}`
        : "chưa publish"
    }</span>`;
  if (elements.generateExternalDiscussionDraftsBtn) {
    elements.generateExternalDiscussionDraftsBtn.disabled = false;
  }
}

function renderExternalDiscussionDrafts(drafts = []) {
  const list = Array.isArray(drafts) ? drafts : [];
  currentExternalDiscussionDrafts = list;
  const pending = list.filter((draft) => draft.status === "pending");
  const used = list.filter((draft) => draft.status === "used");
  pendingExternalDiscussionDraftCount = pending.length;
  if (elements.externalDiscussionDraftStats) {
    elements.externalDiscussionDraftStats.innerHTML =
      `<span>Tổng <strong>${list.length}</strong></span>` +
      `<span class="pending">Chưa dùng <strong>${pending.length}</strong></span>` +
      `<span class="used">Đã dùng <strong>${used.length}</strong></span>`;
  }
  if (elements.clearPendingExternalDiscussionDraftsBtn) {
    elements.clearPendingExternalDiscussionDraftsBtn.disabled = pending.length === 0;
  }
  if (elements.externalDiscussionDraftsList) {
    elements.externalDiscussionDraftsList.innerHTML = list.length
      ? list
          .map(
            (draft, index) =>
              `<article class="draft-item ${escapeHtml(draft.status || "pending")}">` +
              `<div class="draft-head"><strong>Mẫu ${index + 1}</strong>` +
              `<div class="draft-status-actions"><span>${
                draft.status === "used"
                  ? "Đã dùng"
                  : draft.status === "posting"
                    ? "Đang đăng"
                    : "Chưa dùng"
              }</span>${
                draft.status === "pending"
                  ? `<button type="button" class="draft-edit-btn" data-edit-external-discussion-draft="${Number(
                      draft.id
                    )}">Chỉnh sửa</button>` +
                    `<button type="button" class="draft-delete-btn" data-delete-external-discussion-draft="${Number(
                      draft.id
                    )}">Xóa</button>`
                  : ""
              }</div></div>` +
              `<p>${escapeHtml(draft.discussion_body || "")}</p>` +
              `</article>`
          )
          .join("")
      : `<div class="empty">${
          externalDiscussionPost
            ? "Bài này chưa có mẫu. Hãy nhờ AI tạo mẫu."
            : "Nhập ID và tải bài để xem kho mẫu."
        }</div>`;
  }
  const hasPost = !!externalDiscussionPost;
  if (
    elements.autoExternalDiscussionEnabled &&
    !elements.autoExternalDiscussionEnabled.checked
  ) {
    elements.autoExternalDiscussionEnabled.disabled =
      !hasPost || pending.length === 0;
  }
  if (elements.runAutoExternalDiscussionBtn) {
    elements.runAutoExternalDiscussionBtn.disabled =
      !hasPost || pending.length === 0;
  }
}

async function loadExternalDiscussionPost() {
  const techhubId = getExternalDiscussionId();
  if (!techhubId) {
    showAdminMsg(
      elements.externalDiscussionDraftMessage,
      "ID bài viết phải là số nguyên dương.",
      "error"
    );
    return;
  }
  elements.loadExternalPostBtn.disabled = true;
  try {
    showAdminMsg(
      elements.externalDiscussionDraftMessage,
      `Đang tải bài #${techhubId}...`,
      "muted"
    );
    const response = await sendMessage({
      action: "resolveExternalDiscussionPost",
      techhubId,
    });
    if (!response?.success) throw new Error(response?.error || "Không tải được bài");
    renderExternalPostPreview(response.post);
    await loadExternalDiscussionDrafts();
    showAdminMsg(
      elements.externalDiscussionDraftMessage,
      `Đã tải bài #${techhubId} của @${response.post.username}.`,
      "success"
    );
  } catch (error) {
    renderExternalPostPreview(null);
    renderExternalDiscussionDrafts([]);
    showAdminMsg(
      elements.externalDiscussionDraftMessage,
      `Lỗi tải bài: ${error.message}`,
      "error"
    );
  } finally {
    elements.loadExternalPostBtn.disabled = false;
  }
}

async function loadExternalDiscussionDrafts() {
  const techhubId = getExternalDiscussionId();
  if (!techhubId || !externalDiscussionPost) {
    renderExternalDiscussionDrafts([]);
    return;
  }
  try {
    const response = await sendMessage({
      action: "getExternalDiscussionDrafts",
      techhubId,
    });
    if (!response?.success) throw new Error(response?.error || "Không tải được mẫu");
    renderExternalPostPreview(response.post);
    renderExternalDiscussionDrafts(response.drafts || []);
  } catch (error) {
    showAdminMsg(
      elements.externalDiscussionDraftMessage,
      `Lỗi tải mẫu: ${error.message}`,
      "error"
    );
  }
}

async function generateExternalDiscussionDrafts() {
  const techhubId = getExternalDiscussionId();
  const count = Number(elements.externalDiscussionGenerateCount?.value);
  if (!techhubId || !externalDiscussionPost) {
    showAdminMsg(
      elements.externalDiscussionDraftMessage,
      "Hãy tải bài người khác trước.",
      "error"
    );
    return;
  }
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    showAdminMsg(
      elements.externalDiscussionDraftMessage,
      "Số mẫu cần tạo phải từ 1 đến 50.",
      "error"
    );
    return;
  }
  elements.generateExternalDiscussionDraftsBtn.disabled = true;
  try {
    showAdminMsg(
      elements.externalDiscussionDraftMessage,
      `Đang nhờ AI tạo ${count} mẫu theo vai người đọc...`,
      "muted"
    );
    const response = await sendMessage({
      action: "generateExternalDiscussionDrafts",
      techhubId,
      count,
    });
    if (!response?.success) throw new Error(response?.error || "Không tạo được mẫu");
    renderExternalPostPreview(response.post);
    renderExternalDiscussionDrafts(response.drafts || []);
    showAdminMsg(
      elements.externalDiscussionDraftMessage,
      response.message,
      "success"
    );
  } catch (error) {
    showAdminMsg(
      elements.externalDiscussionDraftMessage,
      `Lỗi tạo mẫu: ${error.message}`,
      "error"
    );
  } finally {
    elements.generateExternalDiscussionDraftsBtn.disabled = false;
  }
}

async function editExternalDiscussionDraft(id) {
  const draft = currentExternalDiscussionDrafts.find(
    (item) => Number(item.id) === id
  );
  if (!draft || draft.status !== "pending") return;
  const body = window.prompt("Chỉnh sửa nội dung thảo luận:", draft.discussion_body || "");
  if (body === null) return;
  const content = body.trim();
  if (!content) {
    showAdminMsg(
      elements.externalDiscussionDraftMessage,
      "Nội dung không được để trống.",
      "error"
    );
    return;
  }
  try {
    const response = await sendMessage({
      action: "updateDiscussionDraft",
      id,
      body: content,
    });
    if (!response?.success) throw new Error(response?.error || "Không cập nhật được mẫu");
    await loadExternalDiscussionDrafts();
    showAdminMsg(
      elements.externalDiscussionDraftMessage,
      "Đã cập nhật mẫu.",
      "success"
    );
  } catch (error) {
    showAdminMsg(
      elements.externalDiscussionDraftMessage,
      `Lỗi chỉnh sửa: ${error.message}`,
      "error"
    );
  }
}

async function deleteExternalDiscussionDraft(id) {
  const draft = currentExternalDiscussionDrafts.find(
    (item) => Number(item.id) === id
  );
  if (!draft || draft.status !== "pending") return;
  if (!window.confirm("Xóa mẫu thảo luận này? Không thể hoàn tác.")) return;
  try {
    const response = await sendMessage({ action: "deleteDiscussionDraft", id });
    if (!response?.success) throw new Error(response?.error || "Không xóa được mẫu");
    await loadExternalDiscussionDrafts();
    showAdminMsg(
      elements.externalDiscussionDraftMessage,
      "Đã xóa mẫu.",
      "success"
    );
  } catch (error) {
    showAdminMsg(
      elements.externalDiscussionDraftMessage,
      `Lỗi xóa mẫu: ${error.message}`,
      "error"
    );
  }
}

async function clearPendingExternalDiscussionDrafts() {
  const techhubId = getExternalDiscussionId();
  if (!techhubId || pendingExternalDiscussionDraftCount < 1) return;
  if (
    !window.confirm(
      `Xóa hết ${pendingExternalDiscussionDraftCount} mẫu chưa dùng của bài #${techhubId}?`
    )
  ) {
    return;
  }
  elements.clearPendingExternalDiscussionDraftsBtn.disabled = true;
  try {
    const response = await sendMessage({
      action: "deletePendingExternalDiscussionDrafts",
      techhubId,
    });
    if (!response?.success) throw new Error(response?.error || "Không xóa được mẫu");
    renderExternalDiscussionDrafts(response.drafts || []);
    showAdminMsg(
      elements.externalDiscussionDraftMessage,
      response.message,
      "success"
    );
  } catch (error) {
    showAdminMsg(
      elements.externalDiscussionDraftMessage,
      `Lỗi xóa mẫu: ${error.message}`,
      "error"
    );
    elements.clearPendingExternalDiscussionDraftsBtn.disabled =
      pendingExternalDiscussionDraftCount === 0;
  }
}

function renderAutoExternalDiscussionStatus(state, message = "", type = "info") {
  if (!state) return;
  if (elements.autoExternalDiscussionEnabled) {
    elements.autoExternalDiscussionEnabled.checked = !!state.enabled;
    elements.autoExternalDiscussionEnabled.disabled =
      !state.enabled &&
      (!externalDiscussionPost || pendingExternalDiscussionDraftCount === 0);
  }
  if (state.targetTechhubId && elements.externalDiscussionPostId) {
    elements.externalDiscussionPostId.value = String(state.targetTechhubId);
  }
  if (elements.externalDiscussionTargetCount && state.targetCount) {
    elements.externalDiscussionTargetCount.value = String(state.targetCount);
  }
  if (elements.externalDiscussionMinInterval && state.minIntervalMinutes) {
    elements.externalDiscussionMinInterval.value = String(state.minIntervalMinutes);
  }
  if (elements.externalDiscussionMaxInterval && state.maxIntervalMinutes) {
    elements.externalDiscussionMaxInterval.value = String(state.maxIntervalMinutes);
  }
  if (elements.externalDiscussionPostId) {
    elements.externalDiscussionPostId.disabled = !!state.enabled;
  }
  setJobFlag("externalDiscussion", !!state.enabled);
  const target = Number(state.targetCount) || 5;
  const detail =
    `${state.enabled ? "Đang bật" : "Đang tắt"} · bài #${
      state.targetTechhubId || "?"
    } · đã đăng ${state.completedCount || 0}/${target}` +
    (state.nextRunAt
      ? ` · lượt tới ${new Date(state.nextRunAt).toLocaleTimeString()}`
      : "");
  showAdminMsg(
    elements.autoExternalDiscussionMessage,
    message ? `${message} (${detail})` : detail,
    state.lastError ? "error" : type
  );
}

async function loadAutoExternalDiscussionStatus() {
  try {
    const response = await sendMessage({
      action: "getAutoExternalDiscussionStatus",
    });
    if (!response?.success) throw new Error(response?.error || "Không đọc được trạng thái");
    renderAutoExternalDiscussionStatus(
      response.state,
      response.state.lastMessage || "",
      response.state.enabled ? "success" : "muted"
    );
  } catch (error) {
    showAdminMsg(
      elements.autoExternalDiscussionMessage,
      `Lỗi: ${error.message}`,
      "error"
    );
  }
}

async function toggleAutoExternalDiscussion() {
  const enabled = !!elements.autoExternalDiscussionEnabled.checked;
  const techhubId = getExternalDiscussionId();
  const targetCount = Number(elements.externalDiscussionTargetCount?.value) || 5;
  const minIntervalMinutes = Number(elements.externalDiscussionMinInterval?.value);
  const maxIntervalMinutes = Number(elements.externalDiscussionMaxInterval?.value);
  if (enabled && (!externalDiscussionPost || !techhubId)) {
    elements.autoExternalDiscussionEnabled.checked = false;
    showAdminMsg(
      elements.autoExternalDiscussionMessage,
      "Hãy tải bài người khác trước.",
      "error"
    );
    return;
  }
  if (enabled && pendingExternalDiscussionDraftCount < targetCount) {
    elements.autoExternalDiscussionEnabled.checked = false;
    showAdminMsg(
      elements.autoExternalDiscussionMessage,
      `Chỉ còn ${pendingExternalDiscussionDraftCount} mẫu chưa dùng. Hãy giảm số lượng hoặc tạo thêm mẫu.`,
      "error"
    );
    return;
  }
  elements.autoExternalDiscussionEnabled.disabled = true;
  try {
    const response = await sendMessage({
      action: "setAutoExternalDiscussionEnabled",
      enabled,
      techhubId,
      targetCount,
      minIntervalMinutes,
      maxIntervalMinutes,
    });
    if (!response?.success) throw new Error(response?.error || "Không cập nhật được");
    renderAutoExternalDiscussionStatus(
      response.state,
      response.state.lastMessage,
      enabled ? "success" : "muted"
    );
  } catch (error) {
    elements.autoExternalDiscussionEnabled.checked = !enabled;
    showAdminMsg(
      elements.autoExternalDiscussionMessage,
      `Lỗi: ${error.message}`,
      "error"
    );
  } finally {
    elements.autoExternalDiscussionEnabled.disabled =
      !elements.autoExternalDiscussionEnabled.checked &&
      (!externalDiscussionPost || pendingExternalDiscussionDraftCount === 0);
  }
}

async function runAutoExternalDiscussionOnce() {
  const techhubId = getExternalDiscussionId();
  if (!techhubId || !externalDiscussionPost) {
    showAdminMsg(
      elements.autoExternalDiscussionMessage,
      "Hãy tải bài người khác trước.",
      "error"
    );
    return;
  }
  elements.runAutoExternalDiscussionBtn.disabled = true;
  try {
    showAdminMsg(
      elements.autoExternalDiscussionMessage,
      "Đang đăng một mẫu...",
      "muted"
    );
    const response = await sendMessage({
      action: "runAutoExternalDiscussionOnce",
      techhubId,
    });
    if (!response?.success) throw new Error(response?.error || "Đăng thất bại");
    renderAutoExternalDiscussionStatus(response.state, response.message, "success");
    await loadExternalDiscussionDrafts();
  } catch (error) {
    showAdminMsg(
      elements.autoExternalDiscussionMessage,
      `Lỗi: ${error.message}`,
      "error"
    );
  } finally {
    elements.runAutoExternalDiscussionBtn.disabled =
      pendingExternalDiscussionDraftCount === 0;
  }
}

function setDefaultDeleteAt() {
  if (!elements.deleteAtInput) return;
  elements.deleteAtInput.value = toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000));
}

function getDeleteSelectedTechhubIds() {
  const selected = elements.deleteTechhubId
    ? [...elements.deleteTechhubId.selectedOptions]
        .map((option) => Number(option.value))
        .filter((id) => Number.isInteger(id) && id > 0)
    : deleteSelectedTechhubIds;
  deleteSelectedTechhubIds = [...new Set(selected)].slice(0, 5);
  return deleteSelectedTechhubIds;
}

function renderDeleteSelectedLabel() {
  if (!elements.deleteSelectedLabel) return;
  const ids = getDeleteSelectedTechhubIds();
  if (!ids.length) {
    showAdminMsg(elements.deleteSelectedLabel, "Chưa chọn bài.", "muted");
    return;
  }
  const labels = ids.map((id) => {
    const post = cachedPosts.find((item) => Number(item.techhub_id) === id);
    return `#${id}${post?.title ? ` · ${post.title}` : ""}`;
  });
  showAdminMsg(
    elements.deleteSelectedLabel,
    `Đã chọn ${ids.length}/5 bài: ${labels.join(" | ")}`,
    "info"
  );
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
  const techhubIds = getDeleteSelectedTechhubIds();
  const deleteAt = elements.deleteAtInput.value;
  if (techhubIds.length < 1 || techhubIds.length > 5) {
    showAdminMsg(elements.deleteScheduleMessage, "Hãy chọn từ 1 đến 5 bài.", "error");
    return;
  }
  if (!deleteAt) {
    showAdminMsg(elements.deleteScheduleMessage, "Chọn thời gian xóa", "error");
    return;
  }

  const confirmed = window.confirm(
    `Hẹn xóa ${techhubIds.length} bài (${techhubIds.map((id) => `#${id}`).join(", ")}) ` +
      `lúc ${new Date(deleteAt).toLocaleString()}?\n\n` +
      "Các bài sẽ bị xóa trên TechHub khi đến giờ."
  );
  if (!confirmed) return;

  elements.scheduleDeleteBtn.disabled = true;
  let scheduledCount = 0;
  try {
    let latestItems = [];
    const isoDeleteAt = new Date(deleteAt).toISOString();
    for (const techhubId of techhubIds) {
      const response = await sendMessage({
        action: "scheduleDeletePost",
        techhubId,
        deleteAt: isoDeleteAt,
      });
      if (!response?.success) {
        throw new Error(`Bài #${techhubId}: ${response?.error || "không hẹn được"}`);
      }
      scheduledCount += 1;
      latestItems = response.items || latestItems;
    }
    renderScheduledDeletes(latestItems);
    showAdminMsg(
      elements.deleteScheduleMessage,
      `Đã hẹn xóa ${scheduledCount} bài lúc ${new Date(deleteAt).toLocaleString()}.`,
      "success"
    );
  } catch (error) {
    await loadScheduledDeletes();
    showAdminMsg(
      elements.deleteScheduleMessage,
      `${scheduledCount ? `Đã hẹn ${scheduledCount}/${techhubIds.length} bài. ` : ""}Lỗi: ${error.message}`,
      "error"
    );
  } finally {
    elements.scheduleDeleteBtn.disabled = false;
  }
}

async function deletePostNow() {
  const techhubIds = getDeleteSelectedTechhubIds();
  if (techhubIds.length !== 1) {
    showAdminMsg(elements.deleteScheduleMessage, "Xóa ngay yêu cầu chọn đúng 1 bài.", "error");
    return;
  }
  const [techhubId] = techhubIds;
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
