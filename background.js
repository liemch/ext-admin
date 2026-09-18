importScripts('config.js', 'supabase-client.js', 'nvidia-client.js', 'engagement-client.js', 'engagement-worker.js', 'post-sync-client.js', 'post-sync-worker.js');

// Background Service Worker - Lắng nghe và bắt headers từ TechHub API

// Biến lưu trữ Cookie và CSRF Token
let capturedCredentials = {};
let lastMemoryInteractionTime = 0;
const MY_POSTS_SYNC_ALARM = "myPostsSyncAlarm";
const MY_POSTS_SYNC_INTERVAL_MINUTES = 20;
let myPostsSyncPromise = null;
const AUTO_COMMENT_MIN_INTERVAL_MS = 2000;
const AUTO_COMMENT_MAX_INTERVAL_MS = 5000;
let autoCommentTimerId = null;
let autoCommentTickRunning = false;
let autoCommentGeneration = 0;
let autoCommentTemplates = [];
let autoCommentAbortController = null;
let autoCommentState = {
  active: false,
  techhubId: null,
  username: null,
  commentCount: 0,
  targetCount: 0,
  lastCommentAt: null,
  lastError: null,
  autoDeleteEnabled: false,
  deleteAfterMinutes: 1,
  completionMinutes: 1,
  startedAt: null,
};
let autoCommentJobs = [];
const MAX_AUTO_COMMENT_JOBS = 5;
const AUTO_COMMENT_START_ALARM = "autoCommentStartAlarm";
const MAX_AUTO_COMMENT_SCHEDULES = 5;
const AUTO_COMMENT_DELETE_ALARM = "autoCommentDeleteAlarm";
const AUTO_COMMENT_DELETE_QUEUE_KEY = "autoCommentDeleteQueue";
const DEFAULT_AUTO_COMMENT_DELETE_AFTER_MINUTES = 1;
const AUTO_COMMENT_DELETE_MIN_GAP_MS = 500;
const AUTO_COMMENT_DELETE_MAX_GAP_MS = 1500;
let autoCommentDeleteRunning = false;
let autoCommentDeleteSummary = { pending: 0, done: 0, error: 0 };
let autoCommentDeleteQueueMutation = Promise.resolve();
let autoCommentSchedule = {
  techhubId: null,
  targetCount: null,
  startAt: null,
  createdAt: null,
  lastError: null,
  autoDeleteEnabled: false,
  deleteAfterMinutes: DEFAULT_AUTO_COMMENT_DELETE_AFTER_MINUTES,
  completionMinutes: 1,
};
let autoCommentSchedules = [];
let autoCommentScheduleActivation = Promise.resolve();

function autoCommentStartAlarmName(scheduleId) {
  return `${AUTO_COMMENT_START_ALARM}-${scheduleId}`;
}

function queueScheduledAutoCommentStart(scheduleId) {
  autoCommentScheduleActivation = autoCommentScheduleActivation
    .catch(() => {})
    .then(() => runScheduledAutoCommentStart(scheduleId));
  return autoCommentScheduleActivation;
}
const AUTO_REPLY_ALARM = "autoReplyAlarm";
const DEFAULT_REPLY_MIN_INTERVAL_MINUTES = 1;
const DEFAULT_REPLY_MAX_INTERVAL_MINUTES = 5;
const AUTO_DISCUSSION_ALARM = "autoDiscussionAlarm";
const AUTO_EXTERNAL_DISCUSSION_ALARM = "autoExternalDiscussionAlarm";
const AI_JOB_WATCHDOG_ALARM = "aiJobWatchdogAlarm";
const CROSS_INTERACTION_ALARM = "crossInteractAlarm";
const CROSS_INTERACTION_ENABLED_KEY = "crossInteractionEnabled";
const DEFAULT_DISCUSSION_MIN_INTERVAL_MINUTES = 1;
const DEFAULT_DISCUSSION_MAX_INTERVAL_MINUTES = 5;
let autoReplyRunning = false;
let autoReplyState = {
  enabled: false,
  useAi: true,
  username: null,
  targetTechhubId: null,
  targetCount: 5,
  completedCount: 0,
  maxConsecutiveSelfReplies: 1,
  minIntervalMinutes: DEFAULT_REPLY_MIN_INTERVAL_MINUTES,
  maxIntervalMinutes: DEFAULT_REPLY_MAX_INTERVAL_MINUTES,
  nextRunAt: null,
  lastRunAt: null,
  lastReplyCount: 0,
  lastError: null,
  lastMessage: null,
};
let autoDiscussionRunning = false;
let autoDiscussionState = {
  enabled: false,
  username: null,
  targetTechhubId: null,
  targetCount: 5,
  completedCount: 0,
  minIntervalMinutes: DEFAULT_DISCUSSION_MIN_INTERVAL_MINUTES,
  maxIntervalMinutes: DEFAULT_DISCUSSION_MAX_INTERVAL_MINUTES,
  nextRunAt: null,
  lastRunAt: null,
  lastDiscussionCount: 0,
  lastPostDiscussionCount: 0,
  lastError: null,
  lastMessage: null,
};
let autoExternalDiscussionRunning = false;
let autoExternalDiscussionState = {
  enabled: false,
  username: null,
  targetTechhubId: null,
  targetCount: 5,
  completedCount: 0,
  minIntervalMinutes: DEFAULT_DISCUSSION_MIN_INTERVAL_MINUTES,
  maxIntervalMinutes: DEFAULT_DISCUSSION_MAX_INTERVAL_MINUTES,
  nextRunAt: null,
  lastRunAt: null,
  lastDiscussionCount: 0,
  lastError: null,
  lastMessage: null,
};

function normalizeTechhubId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Lấy bài để chạy job AI: 1 bài đã chọn hoặc toàn bộ bài open.
 */
async function getPostsForAiJob(username, targetTechhubId) {
  const targetId = normalizeTechhubId(targetTechhubId);
  if (!targetId) {
    return supabase.getOwnPosts(username, { status: "open", limit: 20 });
  }
  const post = await supabase.getPostByTechhubId(targetId);
  if (!post) {
    throw new Error(`Không tìm thấy bài #${targetId} trong DB. Hãy bấm Quét bài.`);
  }
  if (!post.username || post.username !== username) {
    throw new Error(`Bài #${targetId} không thuộc @${username}.`);
  }
  return [post];
}

/**
 * Resolve bài của người khác (kể cả chưa publish) mà không nới ownership guard
 * của job bài mình.
 */
async function resolveExternalDiscussionPost(techhubId) {
  const targetId = normalizeTechhubId(techhubId);
  if (!targetId) throw new Error("ID bài viết phải là số nguyên dương.");

  const liveUserProfile = await readCurrentUserProfileFromTechHub();
  const stored = await chrome.storage.local.get(["userProfile", "techhubCredentials"]);
  const userProfile = liveUserProfile || stored.userProfile;
  const username = userProfile?.username;
  if (!username || !stored.techhubCredentials?.csrfToken) {
    throw new Error("Thiếu phiên đăng nhập hoặc profile TechHub.");
  }
  if (liveUserProfile) {
    await chrome.storage.local.set({ userProfile: liveUserProfile });
  }

  let post = await supabase.getPostByTechhubId(targetId);
  if (
    !post?.techhub_uuid ||
    !post?.username ||
    String(post?.status || "").toLowerCase() !== "open"
  ) {
    const article = await supabase.fetchTechHubArticleById(targetId);
    if (!article) throw new Error(`Không tìm thấy bài TechHub #${targetId}.`);
    post = await supabase.upsertExternalPost(article);
  }

  if (!post?.techhub_uuid || !post?.username) {
    throw new Error(`Bài #${targetId} thiếu UUID hoặc tác giả.`);
  }
  // Detail endpoint là nguồn trạng thái mới nhất; merge lại DB trước khi kiểm tra.
  const detail = await fetchArticleDetail(
    post.techhub_uuid,
    stored.techhubCredentials
  );
  post = await supabase.upsertExternalPost({
    ...post,
    ...detail,
    id: targetId,
    uuid: detail?.uuid || post.techhub_uuid,
    username:
      detail?.username ||
      detail?.author?.username ||
      detail?.user?.username ||
      post.username,
    title: detail?.title || post.title,
    status: detail?.status || post.status,
    published_at: detail?.published_at || post.published_at,
    created_at: detail?.created_at || post.created_at,
  });
  if (post.username === username) {
    throw new Error(
      `Bài #${targetId} thuộc @${username}. Hãy dùng mục AI thảo luận cho bài của bạn.`
    );
  }
  if (!post.published_at) {
    console.log(`[Background] Bài #${targetId} chưa publish, vẫn cho phép thảo luận.`);
  }
  if (String(post.status || "").toLowerCase() !== "open") {
    throw new Error(`Bài #${targetId} không còn mở để thảo luận.`);
  }

  return {
    post,
    detail,
    actorUsername: username,
  };
}

async function requireTechHubActor() {
  const liveUserProfile = await readCurrentUserProfileFromTechHub();
  const stored = await chrome.storage.local.get(["userProfile", "techhubCredentials"]);
  const userProfile = liveUserProfile || stored.userProfile;
  const username = userProfile?.username;
  if (!username || !stored.techhubCredentials?.csrfToken) {
    throw new Error("Thiếu phiên đăng nhập hoặc profile TechHub.");
  }
  if (liveUserProfile) {
    await chrome.storage.local.set({ userProfile: liveUserProfile });
  }
  return username;
}

function toCommunityPostView(post, actorUsername, fallbackSlug) {
  const slug = post?.community_slug || fallbackSlug;
  return {
    techhub_id: Number(post?.techhub_id),
    techhub_uuid: post?.techhub_uuid || null,
    title: post?.title || `Bài #${post?.techhub_id}`,
    username: post?.username || null,
    url: post?.url || "",
    status: post?.status || "open",
    published_at: post?.published_at || null,
    created_at: post?.created_at || null,
    votes_score: Number(post?.votes_score || 0),
    comments_count: Number(post?.comments_count || 0),
    medals_count: Number(post?.medals_count || 0),
    community_slug: slug,
    community_name: post?.community_name || slug,
    last_seen_at: post?.last_seen_at || null,
    is_own: !!post?.username && post.username === actorUsername,
  };
}

function sortCommunityPosts(posts) {
  return posts.sort(
    (a, b) =>
      new Date(b.created_at || b.published_at || 0).getTime() -
      new Date(a.created_at || a.published_at || 0).getTime()
  );
}

/**
 * Đọc bài chuyên mục đã lưu trong Supabase, không gọi TechHub.
 */
async function getCachedCommunityPosts(communitySlug) {
  const actorUsername = await requireTechHubActor();
  const slug = String(communitySlug || "").trim().toLowerCase();
  const rows = await supabase.getPostsByCommunity(slug, { limit: 1000 });
  const posts = sortCommunityPosts(
    rows.map((row) => toCommunityPostView(row, actorUsername, slug))
  );
  return {
    posts,
    communitySlug: slug,
    fromCache: true,
    lastSyncedAt: posts.reduce(
      (latest, post) =>
        post.last_seen_at && (!latest || post.last_seen_at > latest)
          ? post.last_seen_at
          : latest,
      null
    ),
  };
}

/**
 * Quét TechHub rồi lưu kết quả vào Supabase để các lần xem sau dùng cache.
 */
async function scanCommunityArticles(communitySlug, fromMonth, toMonth) {
  const actorUsername = await requireTechHubActor();
  const result = await supabase.fetchTechHubCommunityArticles(communitySlug, {
    fromMonth,
    toMonth,
  });

  let saved = 0;
  let saveError = null;
  let communityColumnsMissing = false;
  try {
    const stats = await supabase.upsertScannedPosts(result.articles);
    saved = stats.saved;
    communityColumnsMissing = stats.communityColumnsMissing;
  } catch (error) {
    // Client key intentionally has no INSERT/UPDATE privilege after the
    // post-sync hardening migration. Keep the freshly scanned list usable;
    // the admin leader will persist it through post-sync-api.
    if (/permission denied for table posts|42501/i.test(String(error?.message || error))) {
      saveError = null;
      console.info("[Background] Bỏ qua ghi cache phía user; leader admin sẽ đồng bộ.");
    } else {
      saveError = error.message;
      console.error("[Background] Không lưu được bài chuyên mục:", error);
    }
  }

  // Danh sách sau khi làm mới vẫn lấy toàn bộ cache, không thu hẹp theo tháng vừa quét.
  let posts = null;
  if (!communityColumnsMissing) {
    try {
      const cached = await getCachedCommunityPosts(result.communitySlug);
      if (cached.posts.length) posts = cached.posts;
    } catch (error) {
      console.warn("[Background] Không đọc lại được cache chuyên mục:", error);
    }
  }
  if (!posts) {
    // Feed danh sách đôi khi không kèm published_at; giữ lại bài và để bước tải bài
    // xác thực trạng thái thật thay vì loại nhầm ở đây.
    posts = sortCommunityPosts(
      result.articles.map((article) =>
        toCommunityPostView(
          {
            ...supabase.buildTechHubPostPayload(article),
            techhub_id: Number(article?.id),
            created_at: article?.created_at,
            published_at: article?.published_at,
          },
          actorUsername,
          result.communitySlug
        )
      )
    );
  }

  return {
    posts,
    communitySlug: result.communitySlug,
    refreshedCount: result.articles.length,
    scannedPages: result.scannedPages,
    scannedArticles: result.scannedArticles,
    months: result.months,
    fromMonth: result.fromMonth,
    toMonth: result.toMonth,
    rangeLabel: result.rangeLabel,
    stopBefore: result.stopBefore,
    reachedWindowEnd: result.reachedWindowEnd,
    hasMore: result.hasMore,
    reportedTotal: result.reportedTotal,
    filterMode: result.filterMode,
    saved,
    saveError,
    communityColumnsMissing,
    fromCache: false,
  };
}

function getMonthWindow(monthOffset) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 1);
  return {
    label: `${String(start.getMonth() + 1).padStart(2, "0")}/${start.getFullYear()}`,
    start,
    end,
  };
}

function countArticlesInWindow(articles, { start, end }) {
  const inWindow = (value) => {
    if (!value) return false;
    const time = new Date(value).getTime();
    return Number.isFinite(time) && time >= start.getTime() && time < end.getTime();
  };
  const created = articles.filter((article) => inWindow(article?.created_at));
  const published = articles.filter((article) => inWindow(article?.published_at));
  return {
    created: created.length,
    published: published.length,
    medals: published.reduce((sum, article) => sum + extractMedalsCount(article), 0),
    comments: published.reduce(
      (sum, article) => sum + (Number(article?.comments_count) || 0),
      0
    ),
  };
}

/**
 * Số liệu tháng hiện tại so với tháng trước, đọc từ dữ liệu đã lưu trong Supabase
 * để không phải gọi lại TechHub mỗi lần xem.
 */
async function getMonthlyPostStats(scope, communitySlug) {
  const username = await requireTechHubActor();
  const current = getMonthWindow(0);
  const previous = getMonthWindow(-1);
  const isCommunity = scope === "community";

  const rows = isCommunity
    ? await supabase.getPostsByCommunity(communitySlug, { limit: 1000 })
    : await supabase.getOwnPosts(username, { limit: 1000, includePublished: true });

  if (rows.length === 0) {
    throw new Error(
      isCommunity
        ? `Chưa có dữ liệu chuyên mục ${communitySlug} trong hệ thống. Hãy quét chuyên mục trước.`
        : "Chưa có bài nào trong hệ thống. Hãy bấm Quét bài trước."
    );
  }

  const lastSyncedAt = rows.reduce((latest, row) => {
    const seen = row?.last_seen_at || row?.created_at || null;
    return seen && (!latest || seen > latest) ? seen : latest;
  }, null);

  return {
    scope: isCommunity ? "community" : "own",
    communitySlug: isCommunity ? communitySlug : null,
    username,
    postCount: rows.length,
    lastSyncedAt,
    months: [
      { ...countArticlesInWindow(rows, current), label: current.label },
      { ...countArticlesInWindow(rows, previous), label: previous.label },
    ],
  };
}

// Lắng nghe sự kiện webRequest để bắt headers
chrome.webRequest.onBeforeSendHeaders.addListener(
  function (details) {
    if (!details.requestHeaders) {
      return;
    }

    let cookie = null;
    let csrf = null;

    // Chỉ đọc tên header — không log giá trị cookie/CSRF ra console.
    for (const h of details.requestHeaders) {
      if (h.name.toLowerCase() === "cookie") {
        cookie = h.value;
      }
      if (h.name.toLowerCase() === "x-csrftoken") {
        csrf = h.value;
      }
    }

    if (cookie || csrf) {
      // Không log cookie/CSRF ra console (chế độ chạy im lặng, an toàn phiên).
      // Service worker có thể vừa restart nên capturedCredentials đang rỗng.
      // Merge thêm bản đã lưu để request GET không có X-CSRFToken không làm mất token.
      chrome.storage.local.get("techhubCredentials", (stored) => {
        const previous = stored.techhubCredentials || {};
        capturedCredentials = {
          cookie: cookie || capturedCredentials.cookie || previous.cookie,
          csrfToken: csrf || capturedCredentials.csrfToken || previous.csrfToken,
          capturedAt: new Date().toISOString(),
        };

        chrome.storage.local.set({ techhubCredentials: capturedCredentials }, () => {
          console.log("Credentials saved to storage");
          
          // Có phiên mới: chạy ngay nếu đã quá chu kỳ cấu hình.
          // (Chu kỳ/quota/delay nằm trong engagement settings, không hard-code.)
          (async () => {
            try {
              const settings = await EngagementWorker.getEngagementSettings();
              if (!settings.enabled) return;
              const stored = await chrome.storage.local.get('lastAutoInteractionTime');
              const lastTime =
                stored.lastAutoInteractionTime || lastMemoryInteractionTime || 0;
              if (Date.now() - lastTime > settings.intervalMinutes * 60 * 1000) {
                console.log("[Background] New credentials after interval, running engagement cycle.");
                lastMemoryInteractionTime = Date.now();
                runCrossInteraction(false);
              }
            } catch (error) {
              console.warn("[Background] Engagement auto-run check failed:", error);
            }
          })();
        });
      });
    } else {
      console.log("[Background] No Cookie or CSRF Token found in headers");
    }
  },
  {
    urls: ["https://techhub.fpt.net/api/v1/accounts/profile"],
  },
  ["requestHeaders", "extraHeaders"]
);

// Lắng nghe message từ popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (ADMIN_ONLY_ACTIONS.has(request.action)) {
    ensureActionAllowed(request.action)
      .then(() => handlePopupMessage(request, sendResponse))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  return handlePopupMessage(request, sendResponse);
});

// Action đặc quyền; mod chỉ được dùng tập MODERATOR_ACTIONS.
// (menu Tự động hóa / Bài người khác / Nguy hiểm / Người dùng)
const MODERATOR_ACTIONS = new Set([
  "startAutoComment",
  "stopAutoComment",
  "scheduleAutoComment",
  "cancelAutoCommentSchedule",
  "scheduleDeletePost",
  "cancelScheduledDelete",
  "deletePostNow",
]);

const ADMIN_ONLY_ACTIONS = new Set([
  "runInteractions",
  "setCrossInteractionEnabled",
  "startAutoComment",
  "stopAutoComment",
  "scheduleAutoComment",
  "cancelAutoCommentSchedule",
  "setAutoReplyEnabled",
  "runAutoReplyOnce",
  "generateReplyDrafts",
  "updateReplyDraft",
  "deleteReplyDraft",
  "deletePendingReplyDrafts",
  "setAutoDiscussionEnabled",
  "runAutoDiscussionOnce",
  "generateDiscussionDrafts",
  "updateDiscussionDraft",
  "deleteDiscussionDraft",
  "deletePendingDiscussionDrafts",
  "scanCommunityArticles",
  "resolveExternalDiscussionPost",
  "generateExternalDiscussionDrafts",
  "deletePendingExternalDiscussionDrafts",
  "setAutoExternalDiscussionEnabled",
  "runAutoExternalDiscussionOnce",
  "scheduleDeletePost",
  "cancelScheduledDelete",
  "deletePostNow",
  "getUsersOverview",
  "updateUserStatus",
  "deleteUser",
  // Engagement admin: campaign / kịch bản / vận hành (chỉ máy admin).
  "saveEngagementSettings",
  "engagementPlanCampaign",
  "engagementPauseCampaign",
  "engagementResumeCampaign",
  "engagementCancelCampaign",
  "engagementGetCampaigns",
  "engagementGetThreads",
  "engagementListTasks",
  "engagementImportThreads",
  "engagementUpdateTurn",
  "engagementRetryTurn",
  "engagementGetOpsStats",
  "engagementCleanupEvents",
  "engagementSetKillSwitch",
  "engagementSetEnabled",
  "engagementRevokeDevice",
  "engagementCreateEnrollmentInvitation",
  "engagementListEnrollmentRequests",
  "engagementApproveDevice",
  "engagementGetPoolSettings",
  "engagementSetPoolSettings",
  "engagementSetUserPolicy",
  "engagementPushComments",
  "engagementListBoosts",
  "engagementCancelBoost",
  "engagementPreviewQuickCampaign",
  "engagementLaunchQuickCampaign",
  "buildEngagementDiscussionPrompt",
  // Post-sync admin (chỉ máy admin/leader).
  "postSyncGetStatus",
  "postSyncCheckSession",
  "postSyncRunLeaderTick",
  "postSyncEnqueueJobs",
  "postSyncListJobs",
  "postSyncListHints",
  "postSyncListRuns",
  "postSyncResubmitHint",
  "postSyncRetryJob",
  "postSyncCancelJob",
]);

/**
 * Kiểm tra quyền admin/mod theo action và trạng thái tài khoản.
 * Ném lỗi nếu không được phép thực hiện thao tác.
 */
async function ensureActionAllowed(action) {
  const liveProfile = await readCurrentUserProfileFromTechHub();
  if (!liveProfile?.username || liveProfile._techhubSessionVerified !== true) {
    throw new Error("Không xác nhận được tài khoản TechHub hiện tại. Mở TechHub và đăng nhập trước.");
  }
  const { _techhubSessionVerified, ...profile } = liveProfile;
  await chrome.storage.local.set({ userProfile: profile });
  const context = await getCurrentAccessContext(profile.username);
  const user = context.account;
  if (user.isLocked) {
    throw new Error("Tài khoản đã bị khóa khỏi extension.");
  }
  if (!user.isAdmin && !(user.isModerator && MODERATOR_ACTIONS.has(action))) {
    throw new Error("Bạn không có quyền sử dụng chức năng này.");
  }
}

async function getCurrentAccessContext(username) {
  const expected = String(username || "").trim();
  if (!expected) throw new Error("Thiếu username TechHub.");
  await EngagementClient.ensureEngagementDevice(expected);
  try {
    let identity;
    try {
      identity = await EngagementClient.engagementGetIdentityState();
    } catch (error) {
      if (!["DEVICE_ENROLLMENT_REQUIRED", "DEVICE_REVOKED"].includes(error.code)) throw error;
      if (error.code === "DEVICE_REVOKED") {
        await EngagementClient.resetEngagementDevice(expected);
      }
      await EngagementClient.engagementRequestEnrollment(expected);
      identity = await EngagementClient.engagementGetIdentityState();
    }
    if (String(identity?.account?.username || "").toLowerCase() !== expected.toLowerCase()) {
      throw new Error("Device token không thuộc tài khoản TechHub hiện tại.");
    }
    return identity;
  } catch (deviceError) {
    const cfg = EngagementClient.getEngagementApiConfig();
    if (!cfg.adminToken) throw deviceError;
    const adminContext = await EngagementClient.engagementAdmin("getAccessContext", { username: expected });
    if (String(adminContext?.account?.username || "").toLowerCase() !== expected.toLowerCase()) {
      throw new Error("Không xác minh được quyền của tài khoản hiện tại.");
    }
    return adminContext;
  }
}

/**
 * Gọi edge function admin-api (service role) cho các thao tác quản lý user.
 * ADMIN_TOKEN chỉ nằm trong config.js của máy quản trị viên —
 * sinh bởi scripts/setup-supabase.sh.
 */
async function adminApiRequest(action, payload = {}) {
  const cfg = typeof ADMIN_API_CONFIG !== "undefined" ? ADMIN_API_CONFIG : {};
  if (!cfg.url || !cfg.token || cfg.url === "YOUR_ADMIN_API_URL") {
    throw new Error(
      "Chưa cấu hình ADMIN_API_CONFIG trong config.js — chạy scripts/setup-supabase.sh để thiết lập"
    );
  }
  const response = await fetch(cfg.url.replace(/\/+$/, ""), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `Admin API HTTP ${response.status}`);
  }
  return data;
}

function handlePopupMessage(request, sendResponse) {
  if (request.action === "getCredentials") {
    // Trả về credentials đã capture
    chrome.storage.local.get("techhubCredentials", (result) => {
      sendResponse({
        success: true,
        credentials: result.techhubCredentials || capturedCredentials,
      });
    });
    return true; // Giữ kênh message mở cho async response
  }

  if (request.action === "getUserProfile") {
    (async () => {
      const { profile: liveProfile, reason } = await inspectCurrentUserProfileFromTechHub();
      if (liveProfile?.username && liveProfile._techhubSessionVerified === true) {
        const { _techhubSessionVerified, ...userProfile } = liveProfile;
        await chrome.storage.local.set({ userProfile });
        return { success: true, userProfile, sessionVerified: true };
      }
      return {
        success: false,
        error: reason || "Chưa xác nhận được tài khoản TechHub hiện tại.",
      };
    })()
      .then(sendResponse)
      .catch(() => sendResponse({ success: false, error: "Không đọc được profile TechHub. Vui lòng thử lại." }));
    return true;
  }

  if (request.action === "getAccessContext") {
    readCurrentUserProfileFromTechHub()
      .then(async (profile) => {
        if (!profile?.username) throw new Error("Không xác nhận được tài khoản TechHub hiện tại.");
        const context = await getCurrentAccessContext(profile.username);
        return { success: true, ...context };
      })
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message, code: error.code }));
    return true;
  }

  if (request.action === "runInteractions") {
    runCrossInteraction(true);
    sendResponse({ success: true });
    return false;
  }

  if (request.action === "getCrossInteractionStatus") {
    getCrossInteractionEnabled()
      .then((enabled) => sendResponse({ success: true, enabled }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "setCrossInteractionEnabled") {
    setCrossInteractionEnabled(!!request.enabled)
      .then((enabled) => sendResponse({ success: true, enabled }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // ---- Tương tác chéo giữa các user (lớp user: mọi tài khoản hợp lệ) ----
  if (request.action === "getEngagementState") {
    EngagementWorker.ensureEngagementUserAllowed()
      .then(() => Promise.all([
        EngagementWorker.getEngagementSettings(),
        EngagementWorker.getEngagementStatus(),
      ]))
      .then(([settings, status]) =>
        sendResponse({
          success: true,
          settings,
          status,
          queueConfigured: EngagementClient.isEngagementQueueConfigured(),
        })
      )
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "setEngagementEnabled") {
    EngagementClient.engagementUpdateConsent({
      consentVersion: request.consentVersion,
      engagementEnabled: request.enabled === true,
      autoPublishEnabled: request.autoPublishEnabled,
      delegatedEngagementEnabled: request.delegatedEngagementEnabled,
      dailyActionLimit: request.dailyActionLimit,
      quietHours: request.quietHours,
    })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message, code: error.code }));
    return true;
  }

  if (request.action === "engagementRequestEnrollment") {
    readCurrentUserProfileFromTechHub()
      .then((profile) => {
        const username = profile?.username || request.username;
        if (!username) throw new Error("Hãy đăng nhập TechHub trước khi đăng ký thiết bị.");
        return EngagementClient.engagementRequestEnrollment(username);
      })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message, code: error.code }));
    return true;
  }

  if (request.action === "engagementEnrollDevice") {
    readCurrentUserProfileFromTechHub()
      .then((profile) => {
        const username = profile?.username || request.username;
        if (!username) throw new Error("Hãy đăng nhập TechHub trước khi dùng mã mời.");
        return EngagementClient.engagementEnrollDevice(username, request.invitationCode);
      })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message, code: error.code }));
    return true;
  }

  if (request.action === "engagementGetIdentityState") {
    EngagementClient.engagementGetIdentityState()
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message, code: error.code }));
    return true;
  }

  if (request.action === "engagementDisconnectDevice") {
    EngagementClient.engagementDisconnectDevice()
      .then(async (result) => {
        await chrome.storage.local.remove(EngagementClient.ENGAGEMENT_DEVICE_KEY);
        sendResponse({ success: true, ...result });
      })
      .catch((error) => sendResponse({ success: false, error: error.message, code: error.code }));
    return true;
  }

  if (request.action === "redeemEngagementUltra") {
    EngagementWorker.ensureEngagementUserAllowed()
      .then(() => EngagementClient.engagementRedeemUltra(request.techhubId))
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "buildMyEngagementDiscussionPrompt") {
    EngagementWorker.ensureEngagementUserAllowed()
      .then(async (user) => {
        const techhubId = normalizeTechhubId(request.techhubId);
        if (!techhubId) throw new Error("ID bài viết không hợp lệ.");
        const [post] = await getPostsForAiJob(user.username, techhubId);
        if (String(post.verification_status || "") !== "verified") {
          throw new Error(`Bài #${techhubId} chưa được xác minh.`);
        }
        const stored = await chrome.storage.local.get(["techhubCredentials"]);
        if (!stored.techhubCredentials?.csrfToken) {
          throw new Error("Thiếu phiên TechHub để đọc nội dung bài.");
        }
        const heartbeat = await EngagementClient.engagementHeartbeat(user.username);
        const count = Math.min(3, Math.max(1, Number(heartbeat?.preferences?.discussions_per_post) || 3));
        const detail = await fetchArticleDetail(post.techhub_uuid, stored.techhubCredentials);
        const title = String(detail?.title || post.title || `Bài #${techhubId}`).trim();
        const articleBody = stripHtml(detail?.body || "").replace(/\s+/g, " ").trim().slice(0, 6000);
        const schema = [{
          name: "chuoi-1",
          turns: [
            { actor: "A", content: "..." },
            { actor: "B", content: "..." },
            { actor: "A", content: "..." },
          ],
        }];
        return {
          techhubId,
          count,
          prompt: [
            `Bài viết: ${title}`,
            `Nội dung: ${articleBody || "Không có nội dung chi tiết; bám sát tiêu đề."}`,
            "",
            `Hãy tạo đúng ${count} chuỗi thảo luận độc lập, tự nhiên bằng tiếng Việt cho bài này.`,
            `- JSON schemaVersion 1 phải có đúng ${count} phần tử trong threads; mỗi phần tử là một chuỗi riêng.`,
            "- Mỗi chuỗi chọn ngẫu nhiên đúng 2 hoặc 3 lượt, luân phiên A, B, A.",
            "- A là người ghé thăm, B là tác giả; lượt sau phải trả lời trực tiếp lượt trước.",
            "- Nội dung ngắn gọn, có ý nghĩa, không khen chung chung, không hashtag/emoji/nhắc AI.",
            "- Chỉ trả JSON hợp lệ, không markdown và không giải thích.",
            `Schema: ${JSON.stringify({ schemaVersion: 1, threads: schema })}`,
          ].join("\n"),
        };
      })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "submitMyEngagementThreads") {
    EngagementWorker.ensureEngagementUserAllowed()
      .then(() => EngagementClient.engagementSubmitOwnThreads(request.techhubId, request.threads))
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "saveMyDiscussionDraft") {
    EngagementWorker.ensureEngagementUserAllowed()
      .then(() => EngagementClient.engagementSaveOwnDiscussionDraft(request.techhubId, request.threads))
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message, code: error.code || null }));
    return true;
  }

  if (request.action === "getMyDiscussionDraft") {
    EngagementWorker.ensureEngagementUserAllowed()
      .then(() => EngagementClient.engagementGetOwnDiscussionDraft(request.techhubId))
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message, code: error.code || null }));
    return true;
  }

  if (request.action === "submitMyDiscussionDraft") {
    EngagementWorker.ensureEngagementUserAllowed()
      .then(() => EngagementClient.engagementSubmitDiscussionDraft(request.techhubId))
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message, code: error.code || null }));
    return true;
  }

  if (request.action === "listMyDiscussionApprovals") {
    EngagementWorker.ensureEngagementUserAllowed()
      .then(() => EngagementClient.engagementListOwnDiscussionApprovals())
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message, code: error.code || null }));
    return true;
  }

  if (request.action === "decideMyDiscussionApproval") {
    EngagementWorker.ensureEngagementUserAllowed()
      .then(() => EngagementClient.engagementDecideDiscussionApproval(request.approvalId, request.decision))
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message, code: error.code || null }));
    return true;
  }

  if (request.action === "buildEngagementDiscussionPrompt") {
    (async () => {
      const techhubId = normalizeTechhubId(request.techhubId);
      if (!techhubId) throw new Error("ID bài viết không hợp lệ.");
      const post = await supabase.getPostByTechhubId(techhubId);
      if (!post?.techhub_uuid || !post?.username) {
        throw new Error(`Không tìm thấy bài #${techhubId}. Hãy đồng bộ bài trước.`);
      }
      if (String(post.verification_status || "") !== "verified") {
        throw new Error(`Bài #${techhubId} chưa được xác minh.`);
      }
      const stored = await chrome.storage.local.get(["techhubCredentials"]);
      if (!stored.techhubCredentials?.csrfToken) {
        throw new Error("Thiếu phiên TechHub để đọc nội dung bài.");
      }
      const detail = await fetchArticleDetail(post.techhub_uuid, stored.techhubCredentials);
      const count = Math.min(50, Math.max(1, Number(request.count) || 1));
      const visitor = String(request.visitor || "visitor").trim() || "visitor";
      const title = String(detail?.title || post.title || `Bài #${techhubId}`).trim();
      const articleBody = stripHtml(detail?.body || "").replace(/\s+/g, " ").trim().slice(0, 6000);
      const schema = [{
        name: "chuoi-1",
        targetTechhubId: techhubId,
        visitor,
        actors: { A: "visitor", B: "author" },
        turns: [
          { actor: "A", content: "..." },
          { actor: "B", content: "..." },
          { actor: "A", content: "..." },
        ],
      }];
      const prompt = [
        `Bài viết: ${title}`,
        `Nội dung: ${articleBody || "Không có nội dung chi tiết; bám sát tiêu đề."}`,
        "",
        `Hãy tạo đúng ${count} chuỗi thảo luận độc lập, tự nhiên bằng tiếng Việt cho bài này.`,
        `- JSON phải có đúng ${count} phần tử; mỗi phần tử là một chuỗi riêng, không gộp nhiều câu hỏi vào cùng chuỗi.`,
        "- Mỗi chuỗi chọn ngẫu nhiên đúng 2 hoặc 3 lượt; phân bổ xen kẽ, không để tất cả cùng độ dài.",
        "- Luân phiên A, B, A; A là người ghé thăm, B là tác giả bài.",
        "- Lượt sau phải trả lời trực tiếp và có ý nghĩa với lượt trước; không khen chung chung.",
        "- Mỗi lượt ngắn gọn, khác nhau; không hashtag, không emoji, không nhắc tới AI.",
        "- Chỉ trả về JSON array hợp lệ, không markdown và không giải thích.",
        `Schema: ${JSON.stringify(schema)}`,
      ].join("\n");
      return { prompt, techhubId, count, title };
    })()
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "runEngagementOnce") {
    EngagementWorker.ensureEngagementUserAllowed()
      .then(() => EngagementWorker.runEngagementCycle({ manual: true }))
      .then((result) => EngagementWorker.getEngagementStatus()
        .then((status) => sendResponse({ success: true, result, status })))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "checkTechHubSession") {
    // Chỉ gọi khi user chủ động mở panel (chế độ chạy im lặng).
    EngagementWorker.checkTechHubSession()
      .then((result) => EngagementWorker.getEngagementStatus()
        .then((status) => sendResponse({ success: true, ...result, status })))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "getEngagementQueueStatus") {
    EngagementWorker.ensureEngagementUserAllowed()
      .then(() => EngagementClient.engagementGetStatus())
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // ---- Tương tác chéo (lớp admin: đã qua ensureActionAllowed) ----
  if (request.action === "saveEngagementSettings") {
    EngagementWorker.saveEngagementSettings(request.settings || {})
      .then((settings) => sendResponse({ success: true, settings }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "engagementPlanCampaign") {
    EngagementClient.engagementAdmin("planCampaign", request.payload || {})
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (
    request.action === "engagementPauseCampaign" ||
    request.action === "engagementResumeCampaign" ||
    request.action === "engagementCancelCampaign"
  ) {
    const apiAction =
      request.action === "engagementPauseCampaign"
        ? "pauseCampaign"
        : request.action === "engagementResumeCampaign"
          ? "resumeCampaign"
          : "cancelCampaign";
    EngagementClient.engagementAdmin(apiAction, { campaignId: request.campaignId })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "engagementGetCampaigns") {
    EngagementClient.engagementAdmin("getCampaigns", {})
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "engagementGetThreads") {
    EngagementClient.engagementAdmin("getThreads", {
      status: request.status,
      limit: request.limit,
    })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "engagementListTasks") {
    EngagementClient.engagementAdmin("listTasks", {
      status: request.status,
      actor: request.actor,
      campaignId: request.campaignId,
      taskAction: request.taskAction,
      limit: request.limit,
    })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "engagementImportThreads") {
    EngagementClient.engagementAdmin("importThreads", {
      threads: request.threads,
      defaults: request.defaults || {},
      campaignId: request.campaignId || null,
      dryRun: request.dryRun === true,
    })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "engagementUpdateTurn") {
    EngagementClient.engagementAdmin("updateTurn", {
      turnId: request.turnId,
      content: request.content,
    })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "engagementRetryTurn") {
    EngagementClient.engagementAdmin("retryTurn", {
      turnId: request.turnId,
      content: request.content,
    })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "engagementGetOpsStats") {
    EngagementClient.engagementAdmin("getOpsStats", {})
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "engagementCleanupEvents") {
    EngagementClient.engagementAdmin("cleanupEvents", {
      olderThanDays: request.olderThanDays,
    })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "engagementSetKillSwitch") {
    EngagementClient.engagementAdmin("setKillSwitch", { enabled: !!request.enabled })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "engagementRevokeDevice") {
    EngagementClient.engagementAdmin("revokeDevice", {
      deviceId: request.deviceId,
      username: request.username,
      revoked: request.revoked !== false,
    })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "engagementGetPoolSettings") {
    EngagementClient.engagementAdmin("getPoolSettings", {})
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "engagementSetPoolSettings") {
    EngagementClient.engagementAdmin("setPoolSettings", request.settings || {})
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "engagementSetUserPolicy") {
    EngagementClient.engagementAdmin("setUserPolicy", {
      username: request.username,
      enabled: request.enabled,
    })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "engagementPushComments") {
    EngagementClient.engagementAdmin("pushComments", {
      techhubId: request.techhubId,
      discussions: request.discussions,
    })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "engagementListBoosts") {
    EngagementClient.engagementAdmin("listBoosts", {
      status: request.status || "active",
      limit: request.limit || 100,
    })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // R4: hủy Push/Ultra đang chờ; hoàn lượt Ultra đúng một lần nếu chưa có
  // chuỗi nào mở turn đầu (đối soát qua settle_engagement_boosts).
  if (request.action === "engagementCancelBoost") {
    EngagementClient.engagementAdmin("cancelBoost", {
      boostId: request.boostId,
      reason: request.reason,
    })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // R4: chiến dịch nhanh — năm trường cấu hình + preset; preview là dry-run
  // nên không tạo campaign/thread/task.
  if (request.action === "engagementPreviewQuickCampaign") {
    EngagementClient.engagementAdmin("previewQuickCampaign", request.payload || {})
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "engagementLaunchQuickCampaign") {
    EngagementClient.engagementAdmin("launchQuickCampaign", request.payload || {})
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "engagementCreateEnrollmentInvitation") {
    EngagementClient.engagementAdmin("createEnrollmentInvitation", { username: request.username })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "engagementListEnrollmentRequests") {
    EngagementClient.engagementAdmin("listEnrollmentRequests", {})
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "engagementApproveDevice") {
    EngagementClient.engagementAdmin("approveDevice", {
      username: request.username,
      deviceId: request.deviceId,
    })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "engagementSetEnabled") {
    EngagementClient.engagementAdmin("setEngagementEnabled", {
      enabled: request.enabled !== false,
    })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "startAutoComment") {
    autoCommentRestorePromise
      .then(() =>
        startAutoComment(request.techhubId, null, request.targetCount, {
          autoDeleteEnabled: request.autoDeleteEnabled,
          deleteAfterMinutes: request.deleteAfterMinutes,
          completionMinutes: request.completionMinutes,
          isExternalTarget: request.isExternalTarget,
        })
      )
      .then((state) => sendResponse({ success: true, state }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "stopAutoComment") {
    autoCommentRestorePromise
      .then(() => cancelAutoCommentCompletely())
      .then((state) => sendResponse({ success: true, state }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "scheduleAutoComment") {
    autoCommentRestorePromise
      .then(() =>
        scheduleAutoCommentStart(request.techhubId, request.targetCount, request.startAt, {
          autoDeleteEnabled: request.autoDeleteEnabled,
          deleteAfterMinutes: request.deleteAfterMinutes,
          completionMinutes: request.completionMinutes,
          isExternalTarget: request.isExternalTarget,
        })
      )
      .then((state) => sendResponse({ success: true, state }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "cancelAutoCommentSchedule") {
    cancelAutoCommentSchedule()
      .then((state) => sendResponse({ success: true, state }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "getAutoCommentStatus") {
    autoCommentRestorePromise
      .then(() => loadAutoCommentDeleteQueue())
      .then(() => sendResponse({ success: true, state: getAutoCommentStatus() }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "getAutoCommentDeleteLog") {
    loadAutoCommentDeleteQueue()
      .then((items) =>
        sendResponse({
          success: true,
          items: items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
        })
      )
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "syncMyPosts") {
    queueMyPostsSync()
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "setAutoReplyEnabled") {
    setAutoReplyEnabled(
      !!request.enabled,
      request.useAi,
      request.techhubId,
      request.maxConsecutiveSelfReplies,
      request.targetCount,
      request.minIntervalMinutes,
      request.maxIntervalMinutes
    )
      .then((state) => sendResponse({ success: true, state }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "runAutoReplyOnce") {
    runAutoReply({
      manual: true,
      techhubId: request.techhubId,
    })
      .then((result) => sendResponse({ success: true, ...result, state: getAutoReplyStatus() }))
      .catch((error) => sendResponse({ success: false, error: error.message, state: getAutoReplyStatus() }));
    return true;
  }

  if (request.action === "getAutoReplyStatus") {
    autoReplyRestorePromise
      .then(() => sendResponse({ success: true, state: getAutoReplyStatus() }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "getReplyDrafts") {
    getReplyDraftsForUi(request.techhubId)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "generateReplyDrafts") {
    generateReplyDrafts(
      request.techhubId,
      request.count,
      request.maxConsecutiveSelfReplies
    )
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "updateReplyDraft") {
    updateReplyDraft(request.id, request.body)
      .then((draft) => sendResponse({ success: true, draft }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "deleteReplyDraft") {
    deleteReplyDraft(request.id)
      .then((draft) => sendResponse({ success: true, draft }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "deletePendingReplyDrafts") {
    deletePendingReplyDrafts(request.techhubId)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "setAutoDiscussionEnabled") {
    setAutoDiscussionEnabled(
      !!request.enabled,
      request.techhubId,
      request.targetCount,
      request.minIntervalMinutes,
      request.maxIntervalMinutes
    )
      .then((state) => sendResponse({ success: true, state }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "runAutoDiscussionOnce") {
    runAutoDiscussion({
      manual: true,
      techhubId: request.techhubId,
      targetCount: request.targetCount,
    })
      .then((result) =>
        sendResponse({ success: true, ...result, state: getAutoDiscussionStatus() })
      )
      .catch((error) =>
        sendResponse({
          success: false,
          error: error.message,
          state: getAutoDiscussionStatus(),
        })
      );
    return true;
  }

  if (request.action === "getDiscussionDrafts") {
    getDiscussionDraftsForUi(request.techhubId)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "generateDiscussionDrafts") {
    generateDiscussionDrafts(request.techhubId, request.count)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "updateDiscussionDraft") {
    updateDiscussionDraft(request.id, request.body)
      .then((draft) => sendResponse({ success: true, draft }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "deleteDiscussionDraft") {
    deleteDiscussionDraft(request.id)
      .then((draft) => sendResponse({ success: true, draft }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "deletePendingDiscussionDrafts") {
    deletePendingDiscussionDrafts(request.techhubId)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "getAutoDiscussionStatus") {
    autoDiscussionRestorePromise
      .then(() => sendResponse({ success: true, state: getAutoDiscussionStatus() }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "getMonthlyPostStats") {
    getMonthlyPostStats(request.scope, request.communitySlug)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "scanCommunityArticles") {
    scanCommunityArticles(request.communitySlug, request.fromMonth, request.toMonth)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "getCachedCommunityPosts") {
    getCachedCommunityPosts(request.communitySlug)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "resolveExternalDiscussionPost") {
    resolveExternalDiscussionPost(request.techhubId)
      .then(({ post }) => sendResponse({ success: true, post }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "getExternalDiscussionDrafts") {
    getExternalDiscussionDraftsForUi(request.techhubId)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "generateExternalDiscussionDrafts") {
    generateExternalDiscussionDrafts(request.techhubId, request.count)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "deletePendingExternalDiscussionDrafts") {
    deletePendingExternalDiscussionDrafts(request.techhubId)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "setAutoExternalDiscussionEnabled") {
    autoExternalDiscussionRestorePromise
      .then(() =>
        setAutoExternalDiscussionEnabled(
          !!request.enabled,
          request.techhubId,
          request.targetCount,
          request.minIntervalMinutes,
          request.maxIntervalMinutes
        )
      )
      .then((state) => sendResponse({ success: true, state }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "runAutoExternalDiscussionOnce") {
    runAutoExternalDiscussion({ manual: true, techhubId: request.techhubId })
      .then((result) =>
        sendResponse({
          success: true,
          ...result,
          state: getAutoExternalDiscussionStatus(),
        })
      )
      .catch((error) =>
        sendResponse({
          success: false,
          error: error.message,
          state: getAutoExternalDiscussionStatus(),
        })
      );
    return true;
  }

  if (request.action === "getAutoExternalDiscussionStatus") {
    autoExternalDiscussionRestorePromise
      .then(() =>
        sendResponse({ success: true, state: getAutoExternalDiscussionStatus() })
      )
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "getMyPosts") {
    getMyPostsForUi()
      .then((posts) => sendResponse({ success: true, posts }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "scheduleDeletePost") {
    scheduleDeletePost(request.techhubId, request.deleteAt)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "cancelScheduledDelete") {
    cancelScheduledDelete(request.techhubId)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "getScheduledDeletes") {
    getScheduledDeletes()
      .then((items) => sendResponse({ success: true, items }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "deletePostNow") {
    deletePostNow(request.techhubId)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "getUsersOverview") {
    adminApiRequest("getUsersOverview")
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "updateUserStatus") {
    const payload = { username: request.username };
    if (request.isAdmin !== undefined) payload.isAdmin = !!request.isAdmin;
    if (request.isModerator !== undefined) payload.isModerator = !!request.isModerator;
    if (request.isLocked !== undefined) payload.isLocked = !!request.isLocked;
    adminApiRequest("updateUserStatus", payload)
      .then((result) => sendResponse({ success: true, user: result.user || null }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "deleteUser") {
    adminApiRequest("deleteUser", { username: request.username })
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // ---- Post-sync (user: xem bài đã sync của chính mình) ----
  if (request.action === "postSyncGetState") {
    PostSyncClient.getMySyncedPosts({ limit: request.limit || 50, offset: request.offset || 0 })
      .then((result) => sendResponse({ success: true, ...result, isLeader: PostSyncClient.isPostSyncLeader() }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // ---- Post-sync admin (chỉ leader) ----
  if (request.action === "postSyncGetStatus") {
    PostSyncClient.postSyncAdmin("getStatus", {})
      .then((result) => sendResponse({ success: true, ...result, isLeader: PostSyncClient.isPostSyncLeader(), configured: PostSyncClient.isPostSyncConfigured() }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === "postSyncCheckSession") {
    PostSyncWorker.checkSessionQuiet()
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === "postSyncRunLeaderTick") {
    PostSyncWorker.enqueueScheduledJobs()
      .then(() => PostSyncWorker.claimAndRunOneJob())
      .then((result) => PostSyncClient.postSyncAdmin("getStatus", {}).then((status) => sendResponse({ success: true, result, ...status })))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === "postSyncEnqueueJobs") {
    PostSyncWorker.enqueueScheduledJobs()
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === "postSyncListJobs") {
    PostSyncClient.postSyncAdmin("listJobs", { status: request.status, limit: request.limit || 50, offset: request.offset || 0 })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === "postSyncListHints") {
    PostSyncClient.postSyncAdmin("listHints", { status: request.status, limit: request.limit || 50, offset: request.offset || 0 })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === "postSyncListRuns") {
    PostSyncClient.postSyncAdmin("listRuns", { jobId: request.jobId, limit: request.limit || 50, offset: request.offset || 0 })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === "postSyncResubmitHint") {
    PostSyncClient.postSyncAdmin("resubmitHint", { hintId: request.hintId })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === "postSyncRetryJob") {
    PostSyncClient.postSyncAdmin("retryJob", { jobId: request.jobId })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === "postSyncCancelJob") {
    PostSyncClient.postSyncAdmin("cancelJob", { jobId: request.jobId })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
}

console.log("TechHub Profile Sync - Background script loaded");

// Bật tính năng Side Panel khi bấm vào icon Extension
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

function setupAlarms() {
  syncCrossInteractionAlarm().catch((error) => {
    console.error("[Background] Could not sync cross interaction alarm:", error);
  });
  // Chế độ chạy im lặng: không ping profile định kỳ. Session chỉ được kiểm
  // tra khi user mở panel; hết phiên phát hiện qua HTTP 401/403 khi chạy task.
  // Dọn alarm keep-alive của bản cũ nếu còn sót.
  chrome.alarms.clear("keepAliveAlarm").catch(() => {});
  chrome.alarms.get(AUTO_REPLY_ALARM, (alarm) => {
    if (!alarm && autoReplyState.enabled) {
      scheduleNextAutoReply().catch((error) => {
        console.error("[Background] Could not schedule auto reply:", error);
      });
    }
  });
  // Tự thảo luận dùng alarm one-shot riêng để mỗi lượt cách ngẫu nhiên 1–5 phút.
  chrome.alarms.get(AUTO_DISCUSSION_ALARM, (alarm) => {
    if (!alarm && autoDiscussionState.enabled) {
      scheduleNextAutoDiscussion().catch((error) => {
        console.error("[Background] Could not schedule auto discussion:", error);
      });
    }
  });
  chrome.alarms.get(AUTO_EXTERNAL_DISCUSSION_ALARM, (alarm) => {
    if (!alarm && autoExternalDiscussionState.enabled) {
      scheduleNextAutoExternalDiscussion().catch((error) => {
        console.error("[Background] Could not schedule external discussion:", error);
      });
    }
  });
  chrome.alarms.get("scheduledDeleteSweep", (alarm) => {
    if (!alarm) {
      chrome.alarms.create("scheduledDeleteSweep", { periodInMinutes: 1 });
    }
  });
  ensureAutoCommentDeleteAlarm().catch((error) => {
    console.error("[Background] Could not restore auto-comment delete alarm:", error);
  });
  // Alarm one-shot có thể bị mất khi service worker khởi động lại, cần watchdog gắn lại.
  chrome.alarms.get(AI_JOB_WATCHDOG_ALARM, (alarm) => {
    if (!alarm) {
      chrome.alarms.create(AI_JOB_WATCHDOG_ALARM, { periodInMinutes: 1 });
    }
  });
  // Đồng bộ bài cá nhân: mỗi máy tự lấy và lưu bài của user đang đăng nhập.
  // Mỗi user tự đồng bộ bài của chính mình như extension tham chiếu.
  chrome.alarms.get(MY_POSTS_SYNC_ALARM, (alarm) => {
    if (!alarm || alarm.periodInMinutes !== MY_POSTS_SYNC_INTERVAL_MINUTES) {
      if (alarm) chrome.alarms.clear(MY_POSTS_SYNC_ALARM).catch(() => {});
      chrome.alarms.create(MY_POSTS_SYNC_ALARM, {
        periodInMinutes: MY_POSTS_SYNC_INTERVAL_MINUTES,
        delayInMinutes: MY_POSTS_SYNC_INTERVAL_MINUTES,
      });
    }
  });
  // Dọn alarm leader từ phiên bản cũ; lease trên server sẽ tự hết hạn.
  if (typeof PostSyncWorker !== "undefined") PostSyncWorker.clearAlarms();
}

async function rearmAiJobAlarms() {
  await Promise.all([
    autoReplyRestorePromise,
    autoDiscussionRestorePromise,
    autoExternalDiscussionRestorePromise,
  ]);
  if (autoReplyState.enabled && !autoReplyRunning) {
    const alarm = await chrome.alarms.get(AUTO_REPLY_ALARM);
    if (!alarm) {
      console.warn("[Background] Auto reply alarm missing, re-arming.");
      await scheduleNextAutoReply();
    }
  }
  if (autoDiscussionState.enabled && !autoDiscussionRunning) {
    const alarm = await chrome.alarms.get(AUTO_DISCUSSION_ALARM);
    if (!alarm) {
      console.warn("[Background] Auto discussion alarm missing, re-arming.");
      await scheduleNextAutoDiscussion();
    }
  }
  if (autoExternalDiscussionState.enabled && !autoExternalDiscussionRunning) {
    const alarm = await chrome.alarms.get(AUTO_EXTERNAL_DISCUSSION_ALARM);
    if (!alarm) {
      console.warn("[Background] External discussion alarm missing, re-arming.");
      await scheduleNextAutoExternalDiscussion();
    }
  }
}

// Bắt đầu setup Alarm cho Cross Interaction và Keep Alive
chrome.runtime.onInstalled.addListener(setupAlarms);
chrome.runtime.onStartup.addListener(setupAlarms);
// Chạy setup 1 lần khi Service Worker được load để đảm bảo alarm luôn tồn tại
setupAlarms();
const autoCommentRestorePromise = restoreAutoComment().then(() =>
  restoreAutoCommentSchedule()
);
const autoReplyRestorePromise = restoreAutoReply();
const autoDiscussionRestorePromise = restoreAutoDiscussion();
const autoExternalDiscussionRestorePromise = restoreAutoExternalDiscussion();
restoreScheduledDeletes().catch((err) => {
  console.error("[Background] Failed to restore scheduled deletes:", err);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CROSS_INTERACTION_ALARM) {
    runCrossInteraction(false).catch((err) => {
      console.error("[Background] Engagement cycle failed:", err);
    });
  } else if (alarm.name === AUTO_REPLY_ALARM) {
    // Chờ restore xong, nếu không state vẫn là mặc định (enabled = false) và job sẽ tự tắt.
    autoReplyRestorePromise
      .then(() => runAutoReply({ manual: false }))
      .catch((err) => {
        console.error("[Background] Auto reply alarm failed:", err);
      });
  } else if (alarm.name === AI_JOB_WATCHDOG_ALARM) {
    rearmAiJobAlarms().catch((err) => {
      console.error("[Background] Could not re-arm AI job alarms:", err);
    });
  } else if (alarm.name === AUTO_COMMENT_START_ALARM || alarm.name.startsWith(`${AUTO_COMMENT_START_ALARM}-`)) {
    const scheduleId = alarm.name === AUTO_COMMENT_START_ALARM
      ? null
      : alarm.name.slice(AUTO_COMMENT_START_ALARM.length + 1);
    autoCommentRestorePromise
      .then(() => queueScheduledAutoCommentStart(scheduleId))
      .catch((err) => {
        console.error("[Background] Scheduled auto comment failed:", err);
      });
  } else if (alarm.name === AUTO_COMMENT_DELETE_ALARM) {
    processDueAutoCommentDeletes().catch((err) => {
      console.error("[Background] Auto-comment delete failed:", err);
    });
  } else if (alarm.name === AUTO_DISCUSSION_ALARM) {
    autoDiscussionRestorePromise
      .then(() => runAutoDiscussion({ manual: false }))
      .catch((err) => {
        console.error("[Background] Auto discussion alarm failed:", err);
      });
  } else if (alarm.name === AUTO_EXTERNAL_DISCUSSION_ALARM) {
    autoExternalDiscussionRestorePromise
      .then(() => runAutoExternalDiscussion({ manual: false }))
      .catch((err) => {
        console.error("[Background] External discussion alarm failed:", err);
      });
  } else if (alarm.name === "scheduledDeleteSweep" || alarm.name.startsWith("deletePost-")) {
    processDueScheduledDeletes().catch((err) => {
      console.error("[Background] Scheduled delete failed:", err);
    });
  } else if (alarm.name === MY_POSTS_SYNC_ALARM) {
    queueMyPostsSync().catch((err) => {
      // Đồng bộ nền phải im lặng; lỗi sẽ hiện khi user chủ động bấm Đồng bộ.
      console.warn("[Background] Đồng bộ bài cá nhân thất bại:", err.message);
    });
  }
});

async function runAutoJobsFromAlarm() {
  // Giữ hàm để tương thích cũ; auto-reply giờ dùng alarm one-shot riêng.
}

async function interactWithTechHub(post, type, content, credentials, signal = undefined, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-CSRFToken': credentials.csrfToken
  };
  
  if (type === 'comment' || type === 'reply') {
    const url = `https://techhub.fpt.net/api/v1/comments/`;
    const body = { article: post.techhub_id, body: content };
    if (type === 'reply' && options.parentCommentId != null) {
      body.ancestry = options.parentCommentId;
    }
    return fetch(url, {
      method: 'POST',
      headers,
      credentials: 'include',
      signal,
      body: JSON.stringify(body)
    });
  } else if (type === 'like') {
    const url = `https://techhub.fpt.net/api/v1/reactions/toggle/`;
    return fetch(url, {
      method: 'POST',
      headers,
      credentials: 'include',
      signal,
      body: JSON.stringify({
        reactable_type: "Article",
        reactable_id: post.techhub_id,
        category: "upvote"
      })
    });
  }
}

/**
 * Lấy comment gốc trên bài (TechHub: GET /articles/{uuid}/comments/)
 */
async function fetchArticleComments(articleUuid, credentials, { sort = "new", page = 1, createdAt = null } = {}) {
  const params = new URLSearchParams({ sort: String(sort) });
  if (sort === "top" || sort === "best") {
    params.set("page", String(page));
  } else if (createdAt) {
    params.set("created_at", createdAt);
  }
  const url = `https://techhub.fpt.net/api/v1/articles/${encodeURIComponent(articleUuid)}/comments/?${params}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": credentials.csrfToken,
    },
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Không lấy được comments (HTTP ${response.status})`);
  }
  const data = await response.json();
  const list = Array.isArray(data?.results?.data)
    ? data.results.data
    : Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data)
        ? data
        : [];
  return {
    comments: list,
    next: data?.next ?? null,
    remaining: data?.results?.remaining_count ?? null,
  };
}

async function fetchArticleDetail(articleUuid, credentials) {
  const url = `https://techhub.fpt.net/api/v1/articles/${encodeURIComponent(articleUuid)}/`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": credentials.csrfToken,
    },
    credentials: "include",
  });
  if (!response.ok) {
    const error = new Error(`Không lấy được nội dung bài (HTTP ${response.status})`);
    error.httpStatus = response.status;
    const retryAfter = Number(response.headers.get("Retry-After"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterSeconds = retryAfter;
    throw error;
  }
  const data = await response.json();
  const article = data?.data || data;
  let body =
    article?.body ||
    article?.content ||
    article?.content_html ||
    article?.description ||
    article?.body_html ||
    "";
  return {
    ...article,
    body: stripHtml(body),
  };
}

function getCommentAuthorUsername(comment) {
  return (
    comment?.user?.username ||
    comment?.author?.username ||
    comment?.username ||
    null
  );
}

function broadcastProgress(msg, type = "info") {
  chrome.runtime.sendMessage({
    action: "interactProgress",
    message: msg,
    type: type
  }).catch(() => {});
}

async function refreshCSRFToken() {
  try {
    if (chrome.cookies) {
      const cookies = await chrome.cookies.getAll({ url: "https://techhub.fpt.net" });
      const csrfCookie = cookies.find(c => c.name.toLowerCase().includes('csrf'));
      if (csrfCookie && csrfCookie.value) {
        return csrfCookie.value;
      }
    }
    console.log("[Background] CSRF token not found in cookies");
  } catch (err) {
    console.error("[Background] Failed to refresh CSRF token via cookies:", err);
  }
  return null;
}

function isTechHubTab(tab) {
  try {
    const url = new URL(tab?.url || "");
    return url.protocol === "https:" && url.hostname === "techhub.fpt.net";
  } catch (_) {
    return false;
  }
}

async function inspectCurrentUserProfileFromTechHub() {
  try {
    const tabs = await chrome.tabs.query({});
    const techhubTabs = tabs.filter(isTechHubTab).sort((a, b) => Number(b.active) - Number(a.active));
    if (!techhubTabs.length) return { profile: null, reason: "Không tìm thấy tab TechHub trong cửa sổ Edge này." };

    let lastResult = null;
    let scriptingError = null;
    for (const techhubTab of techhubTabs) {
      if (!techhubTab.id) continue;
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: techhubTab.id },
          func: async () => {
        // Máy mới có thể chưa có userProfile trong localStorage; dùng phiên
        // TechHub đang đăng nhập để lấy profile từ API cùng origin.
        let reason;
        try {
          const response = await fetch("/api/v1/accounts/profile", {
            method: "GET",
            credentials: "include",
          });
          if (response.ok) {
            let payload;
            try {
              payload = await response.json();
            } catch (_) {
              reason = "TechHub trả dữ liệu profile không phải JSON.";
            }
            const queue = [{ value: payload, path: "root", depth: 0 }];
            const seen = new Set();
            const paths = [];
            let profile = null;
            let username = null;
            while (queue.length && !username) {
              const current = queue.shift();
              const value = current.value;
              if (!value || typeof value !== "object" || seen.has(value)) continue;
              seen.add(value);
              const keys = Object.keys(value).slice(0, 30);
              paths.push(`${current.path}: ${keys.join(",")}`);
              const candidate = value.username || value.user_name;
              if (typeof candidate === "string" && candidate.trim()) {
                profile = value;
                username = candidate.trim();
                break;
              }
              if (current.depth < 4) {
                for (const key of ["data", "user", "profile", "account", "result", "me", "info"]) {
                  if (value[key] && typeof value[key] === "object") {
                    queue.push({ value: value[key], path: `${current.path}.${key}`, depth: current.depth + 1 });
                  }
                }
              }
            }
            if (username) {
              return { profile: {
                username,
                display_name: profile?.display_name || profile?.full_name || username,
                email: profile?.email || null,
                avatar: profile?.avatar || null,
                _techhubSessionVerified: true,
              }, reason: null };
            }
            if (!reason) reason = `TechHub trả HTTP 200 nhưng không có username. Cấu trúc: ${paths.slice(0, 6).join(" | ").slice(0, 350)}`;
          } else {
            reason = `API profile TechHub trả HTTP ${response.status}.`;
          }
        } catch (_) {
          reason = "Không gọi được API profile TechHub từ tab hiện tại.";
        }
        try {
          const raw = localStorage.getItem("userProfile");
          const profile = raw ? JSON.parse(raw) : null;
          if (profile?.username) {
            return { profile: { ...profile, _techhubSessionVerified: false }, reason };
          }
        } catch (_) {
          // Cache của TechHub không có hoặc không hợp lệ.
        }
        return { profile: null, reason };
          },
        });
        const result = results?.[0]?.result;
        if (result?.profile?._techhubSessionVerified === true) return result;
        lastResult = result || { profile: null, reason: "Edge không trả kết quả khi đọc tab TechHub." };
      } catch (error) {
        scriptingError = error;
      }
    }
    if (lastResult) return lastResult;
    const message = String(scriptingError?.message || "");
    const reason = /cannot access contents|permission|host permission|not allowed/i.test(message)
      ? "Edge chặn quyền đọc nội dung tab TechHub (SCRIPT_PERMISSION)."
      : /no tab with id|tab was closed|frame was removed|frame with id/i.test(message)
        ? "Tab TechHub đã đổi hoặc đóng khi My Angel đang đọc (TAB_CHANGED). Tải lại tab rồi thử lại."
        : `Edge không chạy được đoạn đọc profile trên tab TechHub (SCRIPT_ERROR: ${scriptingError?.name || "unknown"}).`;
    return { profile: null, reason };
  } catch (error) {
    console.warn("[Background] Could not read current TechHub profile:", error?.name || "UnknownError");
    return {
      profile: null,
      reason: `Edge không liệt kê được tab TechHub (TABS_ERROR: ${error?.name || "unknown"}).`,
    };
  }
}

async function readCurrentUserProfileFromTechHub() {
  const result = await inspectCurrentUserProfileFromTechHub();
  return result.profile;
}

function getAutoCommentStatus() {
  return {
    ...autoCommentState,
    jobs: autoCommentJobs.map((job) => ({ ...job })),
    activeJobCount: autoCommentJobs.filter((job) => job.active).length,
    maxJobs: MAX_AUTO_COMMENT_JOBS,
    schedule: { ...autoCommentSchedule },
    schedules: autoCommentSchedules.map((schedule) => ({ ...schedule })),
    maxSchedules: MAX_AUTO_COMMENT_SCHEDULES,
    intervalMinMs: AUTO_COMMENT_MIN_INTERVAL_MS,
    intervalMaxMs: AUTO_COMMENT_MAX_INTERVAL_MS,
    deleteQueue: { ...autoCommentDeleteSummary },
  };
}

function broadcastAutoCommentProgress(message, type = "info") {
  chrome.runtime.sendMessage({
    action: "autoCommentProgress",
    message,
    type,
    state: getAutoCommentStatus(),
  }).catch(() => {});
}

async function saveAutoCommentState() {
  if (autoCommentState.techhubId) {
    const index = autoCommentJobs.findIndex((job) => job.jobId === autoCommentState.jobId);
    if (index >= 0) autoCommentJobs[index] = { ...autoCommentState };
  }
  await chrome.storage.local.set({ autoCommentState, autoCommentJobs });
}

function appendAutoCommentJob(nextJob) {
  autoCommentJobs = autoCommentJobs.filter((job) => job.jobId !== nextJob.jobId);
  // Giới hạn năm dòng gần nhất nhưng luôn bỏ job đã kết thúc trước, không làm mất
  // job đang chạy khi thêm nhanh một lô nhiều bài.
  while (autoCommentJobs.length >= MAX_AUTO_COMMENT_JOBS) {
    const completedIndex = autoCommentJobs.findIndex((job) => !job.active);
    if (completedIndex < 0) break;
    autoCommentJobs.splice(completedIndex, 1);
  }
  autoCommentJobs.push(nextJob);
}

async function saveAutoCommentSchedule() {
  autoCommentSchedule =
    autoCommentSchedules.find((schedule) => schedule.status === "waiting") ||
    autoCommentSchedules[autoCommentSchedules.length - 1] ||
    { techhubId: null, targetCount: null, startAt: null };
  await chrome.storage.local.set({ autoCommentSchedule, autoCommentSchedules });
}

function normalizeAutoCommentDeleteOptions(options = {}) {
  const enabled = options.autoDeleteEnabled === true;
  const minutes = Number(options.deleteAfterMinutes);
  if (enabled && (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440)) {
    throw new Error("Thời gian tự xóa comment phải từ 1 đến 1440 phút.");
  }
  return {
    autoDeleteEnabled: enabled,
    deleteAfterMinutes: enabled
      ? minutes
      : DEFAULT_AUTO_COMMENT_DELETE_AFTER_MINUTES,
  };
}

async function getFreshTechHubSession() {
  const [stored, liveUserProfile, freshCsrf] = await Promise.all([
    chrome.storage.local.get(["techhubCredentials", "userProfile"]),
    readCurrentUserProfileFromTechHub(),
    refreshCSRFToken(),
  ]);
  const userProfile = liveUserProfile || stored.userProfile || null;
  const credentials = { ...(stored.techhubCredentials || {}) };
  if (freshCsrf) credentials.csrfToken = freshCsrf;

  const updates = {};
  if (liveUserProfile) updates.userProfile = liveUserProfile;
  if (credentials.csrfToken) updates.techhubCredentials = credentials;
  if (Object.keys(updates).length) await chrome.storage.local.set(updates);

  return {
    credentials,
    userProfile,
    username: userProfile?.username || null,
  };
}

function normalizeAutoCommentCompletionMinutes(value, targetCount) {
  const minutes = Number(value ?? 1);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    throw new Error("Thời gian hoàn thành phải từ 1 đến 1440 phút.");
  }
  if (targetCount > 1) {
    const averageGap = (minutes * 60 * 1000) / (targetCount - 1);
    if (averageGap < 500) {
      throw new Error("Thời gian hoàn thành quá ngắn; mỗi comment cần cách nhau ít nhất 0,5 giây.");
    }
  }
  return minutes;
}

async function scheduleAutoCommentStart(techhubId, targetCount, startAt, options = {}) {
  const parsedTechhubId = Number(techhubId);
  if (!Number.isInteger(parsedTechhubId) || parsedTechhubId < 1) {
    throw new Error("techhub_id phải là số nguyên >= 1.");
  }
  const parsedTarget = Number(targetCount);
  if (!Number.isInteger(parsedTarget) || parsedTarget < 1) {
    throw new Error("Số lượng comment mục tiêu phải là số nguyên >= 1.");
  }
  const when = new Date(startAt);
  if (Number.isNaN(when.getTime())) {
    throw new Error("Thời gian bắt đầu không hợp lệ.");
  }
  if (when.getTime() <= Date.now() - 5000) {
    throw new Error("Thời gian bắt đầu phải ở tương lai.");
  }
  const deleteOptions = normalizeAutoCommentDeleteOptions(options);
  const completionMinutes = normalizeAutoCommentCompletionMinutes(
    options.completionMinutes,
    parsedTarget
  );

  const isExternalTarget = options.isExternalTarget === true;
  if (isExternalTarget) {
    await resolveExternalDiscussionPost(parsedTechhubId);
  } else {
    const post = await supabase.getPostByTechhubId(parsedTechhubId);
    if (!post) {
      throw new Error(`Không tìm thấy bài #${parsedTechhubId} trong DB. Hãy Quét bài trước.`);
    }
  }

  const waitingSchedules = autoCommentSchedules.filter((schedule) => schedule.status === "waiting");
  if (waitingSchedules.length >= MAX_AUTO_COMMENT_SCHEDULES) {
    throw new Error(`Chỉ được hẹn tối đa ${MAX_AUTO_COMMENT_SCHEDULES} job auto comment.`);
  }
  if (waitingSchedules.some((schedule) => Number(schedule.techhubId) === parsedTechhubId)) {
    throw new Error(`Bài #${parsedTechhubId} đã có lịch auto comment đang chờ.`);
  }
  autoCommentSchedules = autoCommentSchedules.filter((schedule) => schedule.status === "waiting");
  const scheduleId = globalThis.crypto?.randomUUID?.() || `schedule-${Date.now()}-${parsedTechhubId}`;
  const nextSchedule = {
    scheduleId,
    techhubId: parsedTechhubId,
    targetCount: parsedTarget,
    startAt: when.toISOString(),
    createdAt: new Date().toISOString(),
    lastError: null,
    ...deleteOptions,
    completionMinutes,
    isExternalTarget,
    status: "waiting",
    activatedAt: null,
  };
  autoCommentSchedules.push(nextSchedule);
  autoCommentSchedule = nextSchedule;
  // Lịch mới không được mang theo tiến độ của job đã dừng trên bài trước.
  if (!autoCommentState.active) {
    autoCommentState = {
      active: false,
      techhubId: null,
      username: null,
      commentCount: 0,
      targetCount: 0,
      lastCommentAt: null,
      lastError: null,
      autoDeleteEnabled: false,
      deleteAfterMinutes: DEFAULT_AUTO_COMMENT_DELETE_AFTER_MINUTES,
      completionMinutes: 1,
      startedAt: null,
    };
  }
  chrome.alarms.create(autoCommentStartAlarmName(scheduleId), { when: when.getTime() });
  await Promise.all([saveAutoCommentSchedule(), saveAutoCommentState()]);

  broadcastAutoCommentProgress(
    `Đã hẹn auto comment bài #${parsedTechhubId} lúc ${when.toLocaleString("vi-VN")} · mục tiêu ${parsedTarget} cmt.`,
    "success"
  );
  return getAutoCommentStatus();
}

async function cancelAutoCommentSchedule() {
  await chrome.alarms.clear(AUTO_COMMENT_START_ALARM);
  await Promise.all(
    autoCommentSchedules.map((schedule) =>
      chrome.alarms.clear(autoCommentStartAlarmName(schedule.scheduleId))
    )
  );
  autoCommentSchedules = [];
  autoCommentSchedule = {
    techhubId: null,
    targetCount: null,
    startAt: null,
    createdAt: null,
    lastError: null,
    autoDeleteEnabled: false,
    deleteAfterMinutes: DEFAULT_AUTO_COMMENT_DELETE_AFTER_MINUTES,
    completionMinutes: 1,
    isExternalTarget: false,
  };
  await saveAutoCommentSchedule();
  broadcastAutoCommentProgress("Đã hủy lịch auto comment.", "muted");
  return getAutoCommentStatus();
}

async function runScheduledAutoCommentStart(scheduleId = null) {
  const scheduleIndex = scheduleId
    ? autoCommentSchedules.findIndex((schedule) => schedule.scheduleId === scheduleId)
    : autoCommentSchedules.findIndex((schedule) => schedule.status === "waiting");
  const pending = scheduleIndex >= 0
    ? { ...autoCommentSchedules[scheduleIndex] }
    : { ...autoCommentSchedule };
  if (!pending.techhubId || !pending.startAt) return;
  await chrome.alarms.clear(
    pending.scheduleId ? autoCommentStartAlarmName(pending.scheduleId) : AUTO_COMMENT_START_ALARM
  );

  try {
    await startAutoComment(pending.techhubId, null, pending.targetCount, pending);
    if (scheduleIndex >= 0) {
      autoCommentSchedules[scheduleIndex] = {
        ...pending,
        status: "activated",
        activatedAt: new Date().toISOString(),
        lastError: null,
      };
    }
    await saveAutoCommentSchedule();
    broadcastAutoCommentProgress(
      `Đến giờ hẹn: bắt đầu auto comment bài #${pending.techhubId}.`,
      "success"
    );
  } catch (error) {
    if (scheduleIndex >= 0) {
      autoCommentSchedules[scheduleIndex] = {
        ...pending,
        status: "error",
        lastError: error.message,
      };
    } else {
      autoCommentSchedule = { ...pending, lastError: error.message };
    }
    await saveAutoCommentSchedule();
    broadcastAutoCommentProgress(
      `Lịch auto comment bài #${pending.techhubId} thất bại: ${error.message}`,
      "error"
    );
  }
}

async function restoreAutoCommentSchedule() {
  try {
    const stored = await chrome.storage.local.get(["autoCommentSchedule", "autoCommentSchedules"]);
    autoCommentSchedules = Array.isArray(stored.autoCommentSchedules)
      ? stored.autoCommentSchedules.slice(-MAX_AUTO_COMMENT_SCHEDULES)
      : stored.autoCommentSchedule?.techhubId
        ? [{ ...stored.autoCommentSchedule, scheduleId: `legacy-${Date.now()}`, status: "waiting" }]
        : [];
    await saveAutoCommentSchedule();
    for (const schedule of autoCommentSchedules.filter((item) => item.status === "waiting")) {
      const when = new Date(schedule.startAt).getTime();
      if (!Number.isFinite(when)) continue;
      if (when <= Date.now()) await runScheduledAutoCommentStart(schedule.scheduleId);
      else chrome.alarms.create(autoCommentStartAlarmName(schedule.scheduleId), { when });
    }
  } catch (error) {
    console.error("[Background] Failed to restore auto comment schedule:", error);
  }
}

function getRandomAutoCommentDelay() {
  return Math.floor(
    Math.random() *
      (AUTO_COMMENT_MAX_INTERVAL_MS - AUTO_COMMENT_MIN_INTERVAL_MS + 1)
  ) + AUTO_COMMENT_MIN_INTERVAL_MS;
}

function getNextAutoCommentDelay() {
  const startedAt = new Date(autoCommentState.startedAt || 0).getTime();
  const completionMinutes = Number(autoCommentState.completionMinutes);
  const remainingCount = autoCommentState.targetCount - autoCommentState.commentCount;
  if (!Number.isFinite(startedAt) || startedAt <= 0 || !completionMinutes || remainingCount <= 0) {
    return getRandomAutoCommentDelay();
  }
  const deadline = startedAt + completionMinutes * 60 * 1000;
  const remainingMs = Math.max(0, deadline - Date.now());
  return Math.max(500, Math.floor(remainingMs / remainingCount));
}

function scheduleAutoCommentTick(generation, delayMs = null) {
  if (!autoCommentState.active || generation !== autoCommentGeneration) return;
  if (autoCommentTimerId) clearTimeout(autoCommentTimerId);
  const actualDelay = delayMs == null ? getNextAutoCommentDelay() : delayMs;
  autoCommentTimerId = setTimeout(() => runAutoCommentTick(generation), actualDelay);
}

async function startAutoComment(
  techhubId,
  restoredState = null,
  targetCount = null,
  options = {}
) {
  if (autoReplyRunning || autoDiscussionRunning || autoExternalDiscussionRunning) {
    throw new Error("Đang có job AI chạy. Hãy đợi xong trước.");
  }

  const parsedTechhubId = Number(techhubId);
  if (!Number.isInteger(parsedTechhubId) || parsedTechhubId < 1) {
    throw new Error("techhub_id phải là số nguyên >= 1.");
  }

  const parsedTarget =
    restoredState && restoredState.techhubId === parsedTechhubId && restoredState.targetCount
      ? Number(restoredState.targetCount)
      : Number(targetCount);
  if (!Number.isInteger(parsedTarget) || parsedTarget < 1) {
    throw new Error("Số lượng comment mục tiêu phải là số nguyên >= 1.");
  }
  const deleteOptions = normalizeAutoCommentDeleteOptions(
    restoredState && restoredState.techhubId === parsedTechhubId
      ? restoredState
      : options
  );
  const completionMinutes = normalizeAutoCommentCompletionMinutes(
    restoredState && restoredState.techhubId === parsedTechhubId
      ? restoredState.completionMinutes || 1
      : options.completionMinutes,
    parsedTarget
  );
  const isExternalTarget =
    restoredState && restoredState.techhubId === parsedTechhubId
      ? restoredState.isExternalTarget === true
      : options.isExternalTarget === true;
  if (isExternalTarget) {
    await resolveExternalDiscussionPost(parsedTechhubId);
  }

  const result = await chrome.storage.local.get(["techhubCredentials", "userProfile"]);
  const liveUserProfile = await readCurrentUserProfileFromTechHub();
  const userProfile = liveUserProfile || result.userProfile;
  if (!result.techhubCredentials || !userProfile?.username) {
    throw new Error("Thiếu phiên đăng nhập hoặc profile. Hãy mở TechHub và đăng nhập lại.");
  }
  if (liveUserProfile) {
    await chrome.storage.local.set({ userProfile: liveUserProfile });
  }

  const freshCsrf = await refreshCSRFToken();
  const credentials = result.techhubCredentials;
  if (freshCsrf) {
    credentials.csrfToken = freshCsrf;
    await chrome.storage.local.set({ techhubCredentials: credentials });
  }
  if (!credentials.csrfToken) {
    throw new Error("Không tìm thấy CSRF token. Hãy mở TechHub và đăng nhập lại.");
  }

  autoCommentTemplates = await supabase.getCommentTemplates({ kind: "comment" });
  if (!autoCommentTemplates.length) {
    throw new Error("Không tìm thấy mẫu bình luận đang hoạt động.");
  }

  const startingCount =
    restoredState && restoredState.techhubId === parsedTechhubId
      ? Number(restoredState.commentCount) || 0
      : 0;
  if (startingCount >= parsedTarget) {
    throw new Error(`Đã đạt mục tiêu ${parsedTarget} comment rồi.`);
  }

  const isRestoring = !!restoredState;
  const activeJobs = autoCommentJobs.filter((job) => job.active);
  if (!isRestoring && activeJobs.length >= MAX_AUTO_COMMENT_JOBS) {
    throw new Error(`Chỉ được chạy tối đa ${MAX_AUTO_COMMENT_JOBS} job auto comment.`);
  }
  if (
    !isRestoring &&
    activeJobs.some((job) => Number(job.techhubId) === parsedTechhubId)
  ) {
    throw new Error(`Bài #${parsedTechhubId} đã có job auto comment đang chạy.`);
  }

  const nextJob = {
    jobId:
      restoredState?.jobId ||
      (globalThis.crypto?.randomUUID?.() || `auto-comment-${Date.now()}-${parsedTechhubId}`),
    active: true,
    techhubId: parsedTechhubId,
    username: userProfile.username,
    commentCount: startingCount,
    targetCount: parsedTarget,
    lastCommentAt:
      restoredState && restoredState.techhubId === parsedTechhubId
        ? restoredState.lastCommentAt || null
        : null,
    lastError: null,
    ...deleteOptions,
    completionMinutes,
    startedAt:
      restoredState && restoredState.techhubId === parsedTechhubId
        ? restoredState.startedAt || new Date().toISOString()
        : new Date().toISOString(),
    isExternalTarget,
  };

  if (!isRestoring && autoCommentState.active) {
    appendAutoCommentJob(nextJob);
    await saveAutoCommentState();
    broadcastAutoCommentProgress(
      `Đã thêm job ${activeJobs.length + 1}/${MAX_AUTO_COMMENT_JOBS} cho bài #${parsedTechhubId} · mục tiêu ${parsedTarget} cmt.`,
      "success"
    );
    return getAutoCommentStatus();
  }

  autoCommentGeneration++;
  if (autoCommentTimerId) clearTimeout(autoCommentTimerId);
  if (autoCommentAbortController) autoCommentAbortController.abort();
  autoCommentTimerId = null;
  autoCommentAbortController = null;
  autoCommentTickRunning = false;
  autoCommentState = nextJob;
  if (!isRestoring) {
    appendAutoCommentJob(nextJob);
  } else if (!autoCommentJobs.length) {
    autoCommentJobs = [nextJob];
  }
  await saveAutoCommentState();

  const generation = autoCommentGeneration;
  broadcastAutoCommentProgress(
    `Đã bắt đầu auto comment bài #${parsedTechhubId} · mục tiêu ${parsedTarget} cmt · @${autoCommentState.username}.`,
    "success"
  );
  scheduleAutoCommentTick(generation, 0);
  return getAutoCommentStatus();
}

function stopAutoComment(reason = "Đã dừng auto comment.", type = "info") {
  const stoppedJobId = autoCommentState.jobId;
  autoCommentGeneration++;
  if (autoCommentTimerId) clearTimeout(autoCommentTimerId);
  if (autoCommentAbortController) autoCommentAbortController.abort();
  autoCommentTimerId = null;
  autoCommentAbortController = null;
  autoCommentState.active = false;
  autoCommentState.lastError = type === "error" ? reason : null;
  const stoppedIndex = autoCommentJobs.findIndex((job) => job.jobId === stoppedJobId);
  if (stoppedIndex >= 0) autoCommentJobs[stoppedIndex] = { ...autoCommentState };
  const nextJob = autoCommentJobs.find((job) => job.active);
  if (nextJob) {
    autoCommentState = nextJob;
    const generation = autoCommentGeneration;
    saveAutoCommentState().then(() => scheduleAutoCommentTick(generation, 0));
    broadcastAutoCommentProgress(`${reason} Chuyển sang bài #${nextJob.techhubId}.`, type);
  } else {
    saveAutoCommentState();
    broadcastAutoCommentProgress(reason, type);
  }
}

async function rotateAutoCommentJob(generation) {
  if (generation !== autoCommentGeneration) return false;
  const activeJobs = autoCommentJobs.filter((job) => job.active);
  if (activeJobs.length < 2) return false;
  const currentIndex = activeJobs.findIndex((job) => job.jobId === autoCommentState.jobId);
  const nextJob = activeJobs[(currentIndex + 1) % activeJobs.length];
  if (!nextJob || nextJob.jobId === autoCommentState.jobId) return false;
  autoCommentGeneration++;
  autoCommentState = nextJob;
  await saveAutoCommentState();
  scheduleAutoCommentTick(autoCommentGeneration);
  return true;
}

/**
 * Hủy thủ công: dừng request/timer hiện tại, xóa bài cũ và hủy luôn lịch chờ.
 * Các lần tự dừng do hoàn tất/lỗi vẫn giữ lịch sử để hiển thị kết quả.
 */
async function cancelAutoCommentCompletely() {
  autoCommentGeneration++;
  if (autoCommentTimerId) clearTimeout(autoCommentTimerId);
  if (autoCommentAbortController) autoCommentAbortController.abort();
  autoCommentTimerId = null;
  autoCommentAbortController = null;
  autoCommentTemplates = [];
  autoCommentJobs = [];
  autoCommentState = {
    active: false,
    techhubId: null,
    username: null,
    commentCount: 0,
    targetCount: 0,
    lastCommentAt: null,
    lastError: null,
    autoDeleteEnabled: false,
    deleteAfterMinutes: DEFAULT_AUTO_COMMENT_DELETE_AFTER_MINUTES,
    completionMinutes: 1,
    startedAt: null,
    isExternalTarget: false,
  };

  await chrome.alarms.clear(AUTO_COMMENT_START_ALARM);
  await Promise.all(
    autoCommentSchedules.map((schedule) =>
      chrome.alarms.clear(autoCommentStartAlarmName(schedule.scheduleId))
    )
  );
  autoCommentSchedules = [];
  autoCommentSchedule = {
    techhubId: null,
    targetCount: null,
    startAt: null,
    createdAt: null,
    lastError: null,
    autoDeleteEnabled: false,
    deleteAfterMinutes: DEFAULT_AUTO_COMMENT_DELETE_AFTER_MINUTES,
    completionMinutes: 1,
    isExternalTarget: false,
  };
  await Promise.all([saveAutoCommentState(), saveAutoCommentSchedule()]);
  broadcastAutoCommentProgress(
    "Đã hủy auto comment, lịch hẹn và bài mục tiêu cũ.",
    "muted"
  );
  return getAutoCommentStatus();
}

async function runAutoCommentTick(generation) {
  if (
    !autoCommentState.active ||
    generation !== autoCommentGeneration ||
    autoCommentTickRunning
  ) {
    return;
  }

  autoCommentTickRunning = true;
  const controller = new AbortController();
  autoCommentAbortController = controller;
  try {
    const result = await chrome.storage.local.get(["techhubCredentials", "userProfile"]);
    const credentials = result.techhubCredentials;
    const liveUserProfile = await readCurrentUserProfileFromTechHub();
    const userProfile = liveUserProfile || result.userProfile;
    const username = userProfile?.username;
    if (!credentials?.csrfToken || !username) {
      stopAutoComment(
        "Đã dừng: thiếu phiên đăng nhập hoặc profile TechHub.",
        "error"
      );
      return;
    }
    if (liveUserProfile && liveUserProfile.username !== result.userProfile?.username) {
      await chrome.storage.local.set({ userProfile: liveUserProfile });
    }

    if (!autoCommentTemplates.length) {
      autoCommentTemplates = await supabase.getCommentTemplates({ kind: "comment" });
    }
    if (!autoCommentTemplates.length) {
      stopAutoComment("Đã dừng: không có mẫu bình luận đang hoạt động.", "error");
      return;
    }

    const template =
      autoCommentTemplates[Math.floor(Math.random() * autoCommentTemplates.length)];
    const response = await interactWithTechHub(
      { techhub_id: autoCommentState.techhubId },
      "comment",
      template.content,
      credentials,
      controller.signal
    );

    if (!autoCommentState.active || generation !== autoCommentGeneration) return;

    if (!response?.ok) {
      const status = response?.status || "không xác định";
      if (status === 401 || status === 403 || status === 429) {
        stopAutoComment(
          `Đã dừng: TechHub trả về HTTP ${status}. Hãy kiểm tra đăng nhập/rate limit.`,
          "error"
        );
        return;
      }
      throw new Error(`TechHub trả về HTTP ${status}`);
    }

    let autoDeleteWarning = null;
    if (autoCommentState.autoDeleteEnabled) {
      const commentId = await getCreatedCommentId(response);
      if (commentId) {
        try {
          await enqueueAutoCommentDelete({
            commentId,
            techhubId: autoCommentState.techhubId,
            username,
            createdAt: new Date().toISOString(),
            deleteAfterMinutes: autoCommentState.deleteAfterMinutes,
          });
        } catch (error) {
          autoDeleteWarning = `Không lưu được lịch xóa comment #${commentId}: ${error.message}`;
        }
      } else {
        autoDeleteWarning =
          "TechHub không trả về comment ID nên comment vừa đăng không thể hẹn tự xóa.";
      }
    }

    autoCommentState.username = username;
    autoCommentState.commentCount += 1;
    autoCommentState.lastCommentAt = new Date().toISOString();
    autoCommentState.lastError = null;
    await saveAutoCommentState();
    try {
      await supabase.recordInteraction(
        username,
        autoCommentState.techhubId,
        "comment"
      );
    } catch (error) {
      // Đã đăng thành công nhưng chưa lưu lịch sử → báo rõ để xử lý, không nuốt lỗi.
      broadcastAutoCommentProgress(
        `Đã comment nhưng chưa lưu được lịch sử: ${error.message}`,
        "error"
      );
    }

    const reached =
      autoCommentState.targetCount > 0 &&
      autoCommentState.commentCount >= autoCommentState.targetCount;

    broadcastAutoCommentProgress(
      reached
        ? `Đủ ${autoCommentState.commentCount}/${autoCommentState.targetCount} comment vào bài #${autoCommentState.techhubId}. Dừng.`
        : `Đã comment ${autoCommentState.commentCount}/${autoCommentState.targetCount || "?"} vào bài #${autoCommentState.techhubId}.`,
      "success"
    );
    if (autoDeleteWarning) {
      broadcastAutoCommentProgress(autoDeleteWarning, "error");
    }

    if (reached) {
      stopAutoComment(
        `Hoàn tất: đủ ${autoCommentState.commentCount}/${autoCommentState.targetCount} comment.`,
        "success"
      );
      return;
    }
    if (await rotateAutoCommentJob(generation)) return;
  } catch (error) {
    if (error.name === "AbortError") return;
    if (generation !== autoCommentGeneration) return;
    console.error("[Background] Auto comment tick failed:", error);
    autoCommentState.lastError = error.message;
    await saveAutoCommentState();
    broadcastAutoCommentProgress(`Lỗi auto comment: ${error.message}`, "error");
  } finally {
    if (autoCommentAbortController === controller) {
      autoCommentAbortController = null;
    }
    autoCommentTickRunning = false;
    scheduleAutoCommentTick(generation);
  }
}

async function getCreatedCommentId(response) {
  try {
    const payload = await response.clone().json();
    const rawId =
      payload?.id ?? payload?.comment_id ?? payload?.comment?.id ?? payload?.data?.id;
    const id = Number(rawId);
    if (Number.isInteger(id) && id > 0) return id;
  } catch (_) {
    // Một số response thành công không có JSON; thử lấy ID từ Location header.
  }
  const location = response.headers?.get("Location") || "";
  const match = location.match(/\/comments\/(\d+)\/?$/i);
  return match ? Number(match[1]) : null;
}

async function loadAutoCommentDeleteQueue() {
  const stored = await chrome.storage.local.get(AUTO_COMMENT_DELETE_QUEUE_KEY);
  const queue = stored[AUTO_COMMENT_DELETE_QUEUE_KEY];
  const items = Array.isArray(queue) ? queue : [];
  autoCommentDeleteSummary = {
    pending: items.filter((item) => item.status === "pending").length,
    done: items.filter((item) => item.status === "done").length,
    error: items.filter((item) => item.status === "error").length,
  };
  return items;
}

async function saveAutoCommentDeleteQueue(queue) {
  autoCommentDeleteSummary = {
    pending: queue.filter((item) => item.status === "pending").length,
    done: queue.filter((item) => item.status === "done").length,
    error: queue.filter((item) => item.status === "error").length,
  };
  await chrome.storage.local.set({ [AUTO_COMMENT_DELETE_QUEUE_KEY]: queue });
}

function mutateAutoCommentDeleteQueue(mutator) {
  const task = autoCommentDeleteQueueMutation.then(async () => {
    const current = await loadAutoCommentDeleteQueue();
    const next = (await mutator(current)) || current;
    await saveAutoCommentDeleteQueue(next);
    return next;
  });
  autoCommentDeleteQueueMutation = task.catch(() => {});
  return task;
}

async function enqueueAutoCommentDelete({
  commentId,
  techhubId,
  username,
  createdAt,
  deleteAfterMinutes,
}) {
  const createdTime = new Date(createdAt).getTime();
  const deleteAt = new Date(createdTime + deleteAfterMinutes * 60 * 1000).toISOString();
  const queue = await mutateAutoCommentDeleteQueue((items) => {
    const next = items.filter((item) => Number(item.commentId) !== Number(commentId));
    next.push({
      commentId: Number(commentId),
      techhubId: Number(techhubId),
      username: username || null,
      createdAt,
      deleteAt,
      status: "pending",
      attempts: 0,
      lastError: null,
    });
    return next;
  });
  await ensureAutoCommentDeleteAlarm(queue);
}

async function ensureAutoCommentDeleteAlarm(queue = null) {
  const items = queue || (await loadAutoCommentDeleteQueue());
  const pending = items
    .filter((item) => item.status === "pending" && item.deleteAt)
    .sort((a, b) => new Date(a.deleteAt) - new Date(b.deleteAt));
  await chrome.alarms.clear(AUTO_COMMENT_DELETE_ALARM);
  if (!pending.length) return;
  const dueAt = new Date(pending[0].deleteAt).getTime();
  chrome.alarms.create(AUTO_COMMENT_DELETE_ALARM, {
    when: Math.max(Date.now() + 1000, dueAt),
  });
}

function getRetryAfterMs(response, attempts) {
  const raw = response?.headers?.get("Retry-After");
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const dateMs = raw ? new Date(raw).getTime() - Date.now() : NaN;
  if (Number.isFinite(dateMs) && dateMs > 0) return dateMs;
  return Math.min(5 * 60 * 1000, 15 * 1000 * Math.pow(2, Math.max(0, attempts - 1)));
}

async function deleteAutoCommentOnTechHub(commentId, credentials) {
  return fetch(
    `https://techhub.fpt.net/api/v1/comments/${encodeURIComponent(commentId)}/`,
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": credentials.csrfToken,
      },
      credentials: "include",
    }
  );
}

async function processDueAutoCommentDeletes() {
  if (autoCommentDeleteRunning) return;
  autoCommentDeleteRunning = true;
  let queue = await loadAutoCommentDeleteQueue();
  try {
    const { credentials } = await getFreshTechHubSession();
    if (!credentials?.csrfToken) {
      throw new Error("Thiếu phiên TechHub khi đến giờ xóa comment.");
    }

    const due = queue
      .filter(
        (item) =>
          item.status === "pending" && new Date(item.deleteAt).getTime() <= Date.now()
      )
      .sort((a, b) => new Date(a.deleteAt) - new Date(b.deleteAt));

    for (let index = 0; index < due.length; index++) {
      const item = due[index];
      const response = await deleteAutoCommentOnTechHub(item.commentId, credentials);
      item.attempts = Number(item.attempts || 0) + 1;
      if (response.ok || response.status === 404) {
        item.status = "done";
        item.completedAt = new Date().toISOString();
        item.lastError = null;
        broadcastAutoCommentProgress(`Đã tự xóa comment #${item.commentId}.`, "success");
      } else if (response.status === 429 && item.attempts <= 5) {
        const retryMs = getRetryAfterMs(response, item.attempts);
        item.deleteAt = new Date(Date.now() + retryMs).toISOString();
        item.lastError = `HTTP 429, thử lại sau ${Math.ceil(retryMs / 1000)} giây`;
      } else {
        let detail = "";
        try {
          detail = (await response.text()).slice(0, 300);
        } catch (_) {}
        item.status = "error";
        item.completedAt = new Date().toISOString();
        item.lastError = `HTTP ${response.status}${detail ? `: ${detail}` : ""}`;
        broadcastAutoCommentProgress(
          `Không xóa được comment #${item.commentId}: ${item.lastError}`,
          "error"
        );
      }

      queue = await mutateAutoCommentDeleteQueue((items) =>
        items.map((queued) =>
          Number(queued.commentId) === Number(item.commentId) ? item : queued
        )
      );

      if (index < due.length - 1) {
        const gap =
          Math.floor(
            Math.random() *
              (AUTO_COMMENT_DELETE_MAX_GAP_MS - AUTO_COMMENT_DELETE_MIN_GAP_MS + 1)
          ) + AUTO_COMMENT_DELETE_MIN_GAP_MS;
        await new Promise((resolve) => setTimeout(resolve, gap));
      }
    }

    queue = await mutateAutoCommentDeleteQueue((items) => {
      const pending = items.filter((item) => item.status === "pending");
      const history = items
        .filter((item) => item.status !== "pending")
        .sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0))
        .slice(0, 100);
      return [...pending, ...history];
    });
    await ensureAutoCommentDeleteAlarm(queue);
  } catch (error) {
    const retryAt = new Date(Date.now() + 60 * 1000).toISOString();
    queue = await mutateAutoCommentDeleteQueue((items) =>
      items.map((item) =>
        item.status === "pending" && new Date(item.deleteAt).getTime() <= Date.now()
          ? { ...item, deleteAt: retryAt, lastError: error.message }
          : item
      )
    );
    await ensureAutoCommentDeleteAlarm(queue);
    broadcastAutoCommentProgress(`Tạm hoãn tự xóa comment: ${error.message}`, "error");
  } finally {
    autoCommentDeleteRunning = false;
  }
}

async function restoreAutoComment() {
  try {
    const result = await chrome.storage.local.get(["autoCommentState", "autoCommentJobs"]);
    autoCommentJobs = Array.isArray(result.autoCommentJobs)
      ? result.autoCommentJobs.filter((job) => job?.jobId).slice(-MAX_AUTO_COMMENT_JOBS)
      : [];
    const restoredActive = autoCommentJobs[0] ||
      (result.autoCommentState?.active ? result.autoCommentState : null);
    if (restoredActive) {
      if (!autoCommentJobs.length) autoCommentJobs = [restoredActive];
      await startAutoComment(
        restoredActive.techhubId,
        restoredActive,
        restoredActive.targetCount
      );
    } else if (result.autoCommentState) {
      autoCommentState = { ...autoCommentState, ...result.autoCommentState };
    }
  } catch (error) {
    console.error("[Background] Failed to restore auto comment:", error);
    autoCommentState = {
      ...autoCommentState,
      active: false,
      lastError: error.message,
    };
    await saveAutoCommentState();
  }
}

function getAutoReplyStatus() {
  return { ...autoReplyState };
}

function broadcastAutoReplyProgress(message, type = "info") {
  chrome.runtime.sendMessage({
    action: "autoReplyProgress",
    message,
    type,
    state: getAutoReplyStatus(),
  }).catch(() => {});
}

async function saveAutoReplyState() {
  await chrome.storage.local.set({ autoReplyState });
}

function getRandomReplyDelayMinutes() {
  const min = Number(autoReplyState.minIntervalMinutes) || DEFAULT_REPLY_MIN_INTERVAL_MINUTES;
  const max = Number(autoReplyState.maxIntervalMinutes) || DEFAULT_REPLY_MAX_INTERVAL_MINUTES;
  return min + Math.random() * (max - min);
}

async function scheduleNextAutoReply() {
  if (!autoReplyState.enabled) {
    autoReplyState.nextRunAt = null;
    await chrome.alarms.clear(AUTO_REPLY_ALARM);
    await saveAutoReplyState();
    return null;
  }
  const delayInMinutes = getRandomReplyDelayMinutes();
  const when = Date.now() + delayInMinutes * 60 * 1000;
  await chrome.alarms.clear(AUTO_REPLY_ALARM);
  chrome.alarms.create(AUTO_REPLY_ALARM, { when });
  autoReplyState.nextRunAt = new Date(when).toISOString();
  await saveAutoReplyState();
  return when;
}

async function getReplyDraftsForUi(techhubId) {
  const targetId = normalizeTechhubId(techhubId);
  if (!targetId) {
    return { drafts: [], pendingCount: 0, usedCount: 0 };
  }
  const stored = await chrome.storage.local.get("userProfile");
  const username = stored.userProfile?.username;
  if (!username) throw new Error("Không tìm thấy profile TechHub.");
  await getPostsForAiJob(username, targetId);
  const drafts = await supabase.getReplyDrafts(username, targetId);
  return {
    drafts,
    pendingCount: drafts.filter((draft) => draft.status === "pending").length,
    usedCount: drafts.filter((draft) => draft.status === "used").length,
  };
}

async function updateReplyDraft(id, body) {
  const draftId = Number(id);
  const content = String(body || "").trim();
  if (!Number.isInteger(draftId) || draftId < 1) throw new Error("ID mẫu không hợp lệ.");
  if (!content) throw new Error("Nội dung trả lời không được để trống.");
  if (content.length > 10000) throw new Error("Nội dung trả lời quá dài.");
  const stored = await chrome.storage.local.get("userProfile");
  const username = stored.userProfile?.username;
  if (!username) throw new Error("Không tìm thấy profile TechHub.");
  return supabase.updateReplyDraftBody(username, draftId, content);
}

async function deleteReplyDraft(id) {
  const draftId = Number(id);
  if (!Number.isInteger(draftId) || draftId < 1) throw new Error("ID mẫu không hợp lệ.");
  const stored = await chrome.storage.local.get("userProfile");
  const username = stored.userProfile?.username;
  if (!username) throw new Error("Không tìm thấy profile TechHub.");
  return supabase.deleteReplyDraft(username, draftId);
}

async function deletePendingReplyDrafts(techhubId) {
  const targetId = normalizeTechhubId(techhubId);
  if (!targetId) throw new Error("Hãy chọn bài cần xóa mẫu.");
  const stored = await chrome.storage.local.get("userProfile");
  const username = stored.userProfile?.username;
  if (!username) throw new Error("Không tìm thấy profile TechHub.");
  const deleted = await supabase.deletePendingReplyDrafts(username, targetId);
  const result = await getReplyDraftsForUi(targetId);
  return {
    ...result,
    deletedCount: deleted.length,
    message: deleted.length
      ? `Đã xóa ${deleted.length} mẫu trả lời chưa dùng của bài #${targetId}.`
      : `Bài #${targetId} không còn mẫu trả lời chưa dùng.`,
  };
}

function collectReplyCandidates(allComments, username, selfReplyLimit, useAi) {
  const leafIds = new Set(
    findThreadLeafComments(allComments).map((c) => Number(c.id))
  );
  return allComments.filter((c) => {
    const author = getCommentAuthorUsername(c);
    if (!c?.id || !author) return false;
    if (author !== username) return true;
    if (selfReplyLimit < 2 || !useAi) return false;
    if (!leafIds.has(Number(c.id))) return false;
    return countTrailingSelfComments(c, allComments, username) < selfReplyLimit;
  });
}

async function parseSettingNumber(map, key, fallback) {
  const raw = map?.[key]?.value;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

async function parseSettingBool(map, key, fallback = false) {
  const raw = map?.[key]?.value;
  if (raw === true || raw === "true" || raw === 1 || raw === "1") return true;
  if (raw === false || raw === "false" || raw === 0 || raw === "0") return false;
  return fallback;
}

function queueMyPostsSync() {
  if (myPostsSyncPromise) return myPostsSyncPromise;
  myPostsSyncPromise = syncMyPosts().finally(() => {
    myPostsSyncPromise = null;
  });
  return myPostsSyncPromise;
}

async function syncMyPosts() {
  const liveUserProfile = await readCurrentUserProfileFromTechHub();
  const stored = await chrome.storage.local.get("userProfile");
  const userProfile = liveUserProfile || stored.userProfile;
  if (!userProfile?.username) {
    throw new Error("Thiếu profile. Mở TechHub và đăng nhập trước.");
  }
  if (liveUserProfile) {
    await chrome.storage.local.set({ userProfile: liveUserProfile });
  }

  await EngagementWorker.ensureEngagementUserAllowed();
  // Heartbeat tạo/khôi phục device token dùng để server khóa quyền ghi theo username.
  await EngagementClient.engagementHeartbeat(userProfile.username);

  // Giống extension tham chiếu: chính user gọi danh sách bài theo username của mình.
  // Không trả hàng nghìn dòng về popup để tránh làm side panel bị lag.
  const articles = [];
  let page = 1;
  let hasNext = true;
  while (hasNext && page <= 50) {
    broadcastAutoReplyProgress(`Đang tải trang ${page}...`, "muted");
    const data = await supabase.fetchTechHubArticles(userProfile.username, page);
    if (!Array.isArray(data?.results)) {
      throw new Error(`TechHub trả dữ liệu không hợp lệ ở trang ${page}; chưa đối soát xóa bài.`);
    }
    const rows = data.results;
    if (data?.next && rows.length === 0) {
      throw new Error(`TechHub báo còn trang sau nhưng trang ${page} rỗng; chưa đối soát xóa bài.`);
    }
    articles.push(...rows);
    hasNext = !!data?.next;
    page += 1;
  }
  if (hasNext) {
    throw new Error("Danh sách bài vượt quá 50 trang; chưa đối soát xóa bài để tránh mất dữ liệu.");
  }

  const invalidLiveArticle = articles.find((article) => {
    const techhubId = Number(article?.id ?? article?.techhub_id);
    return !Number.isInteger(techhubId) || techhubId <= 0;
  });
  if (invalidLiveArticle) {
    throw new Error("TechHub trả về bài thiếu ID; chưa đối soát xóa bài để tránh mất dữ liệu.");
  }
  const liveTechhubIds = [...new Set(
    articles.map((article) => Number(article?.id ?? article?.techhub_id))
  )];
  const posts = articles
    .map((article) => supabase.buildTechHubPostPayload(article))
    .filter(Boolean);

  const result = await PostSyncClient.saveMyScannedPosts(posts);
  const saved = Number(result?.saved) || 0;
  const created = Number(result?.created) || 0;
  const updated = Number(result?.updated) || 0;
  const persisted = saved === posts.length;
  if (!persisted) {
    throw new Error(`Supabase chỉ nhận ${saved}/${posts.length} bài.`);
  }

  const reconcileResult = await PostSyncClient.reconcileMyScannedPosts(liveTechhubIds);
  const removed = Number(reconcileResult?.removed) || 0;

  let visiblePosts = posts
    .filter((post) => !post.published_at)
    .slice(0, 100);
  if (persisted) {
    try {
      visiblePosts = await supabase.getOwnPosts(userProfile.username, { limit: 100 });
    } catch (error) {
      console.warn("[Background] Không đọc lại được danh sách bài sau khi lưu:", error);
    }
  }

  return {
    created,
    updated,
    removed,
    readOnlyPreview: !persisted,
    persisted,
    saved,
    message: `Đã đồng bộ ${saved} bài của @${userProfile.username}: ${created} bài mới, ${updated} bài cập nhật, ${removed} bài đã xóa khỏi dữ liệu.`,
    posts: visiblePosts,
    username: userProfile.username,
  };
}

async function getMyPostsForUi() {
  const liveUserProfile = await readCurrentUserProfileFromTechHub();
  const stored = await chrome.storage.local.get("userProfile");
  const userProfile = liveUserProfile || stored.userProfile;
  if (!userProfile?.username) return [];
  return supabase.getOwnPosts(userProfile.username, { limit: 100 });
}

function deleteAlarmName(techhubId) {
  return `deletePost-${techhubId}`;
}

function broadcastDeleteProgress(message, type = "info", items = null) {
  chrome.runtime.sendMessage({
    action: "scheduledDeleteProgress",
    message,
    type,
    items,
  }).catch(() => {});
}

async function loadScheduledDeleteList() {
  const result = await chrome.storage.local.get("scheduledDeletes");
  return Array.isArray(result.scheduledDeletes) ? result.scheduledDeletes : [];
}

async function saveScheduledDeleteList(items) {
  await chrome.storage.local.set({ scheduledDeletes: items });
}

async function getScheduledDeletes() {
  const items = await loadScheduledDeleteList();
  return items.sort((a, b) => new Date(a.deleteAt) - new Date(b.deleteAt));
}

async function restoreScheduledDeletes() {
  const items = await loadScheduledDeleteList();
  for (const item of items) {
    if (item.status === "pending" && item.deleteAt) {
      await ensureDeleteAlarm(item);
    }
  }
  await processDueScheduledDeletes();
}

async function ensureDeleteAlarm(item) {
  const when = new Date(item.deleteAt).getTime();
  if (!Number.isFinite(when)) return;
  const name = deleteAlarmName(item.techhubId);
  // Chrome alarms: if when is in the past, process immediately via sweep
  if (when <= Date.now()) return;
  await chrome.alarms.clear(name);
  chrome.alarms.create(name, { when });
}

async function scheduleDeletePost(techhubId, deleteAt) {
  const parsedId = Number(techhubId);
  if (!Number.isInteger(parsedId) || parsedId < 1) {
    throw new Error("techhub_id phải là số nguyên >= 1.");
  }
  const when = new Date(deleteAt);
  if (Number.isNaN(when.getTime())) {
    throw new Error("Thời gian xóa không hợp lệ.");
  }
  if (when.getTime() <= Date.now() - 5000) {
    throw new Error("Thời gian xóa phải ở tương lai.");
  }

  const post = await supabase.getPostByTechhubId(parsedId);
  if (!post) {
    throw new Error(`Không tìm thấy bài #${parsedId} trong DB. Hãy Quét bài trước.`);
  }
  if (!post.techhub_uuid) {
    throw new Error(`Bài #${parsedId} thiếu techhub_uuid, không thể xóa qua API.`);
  }

  const { credentials, username } = await getFreshTechHubSession();
  if (!credentials?.csrfToken) {
    throw new Error("Thiếu phiên TechHub. Mở TechHub và đăng nhập lại.");
  }

  let items = await loadScheduledDeleteList();
  items = items.filter((i) => Number(i.techhubId) !== parsedId);
  const entry = {
    techhubId: parsedId,
    techhubUuid: post.techhub_uuid,
    title: post.title || "",
    username: post.username || username || null,
    deleteAt: when.toISOString(),
    status: "pending",
    createdAt: new Date().toISOString(),
    lastError: null,
  };
  items.push(entry);
  await saveScheduledDeleteList(items);
  await ensureDeleteAlarm(entry);

  const message = `Đã hẹn xóa bài #${parsedId} lúc ${when.toLocaleString()}`;
  broadcastDeleteProgress(message, "success", items);
  return { item: entry, items: await getScheduledDeletes(), message };
}

async function cancelScheduledDelete(techhubId) {
  const parsedId = Number(techhubId);
  let items = await loadScheduledDeleteList();
  const before = items.length;
  items = items.filter((i) => Number(i.techhubId) !== parsedId);
  if (items.length === before) {
    throw new Error(`Không có lịch xóa cho bài #${parsedId}`);
  }
  await saveScheduledDeleteList(items);
  await chrome.alarms.clear(deleteAlarmName(parsedId));
  const message = `Đã hủy lịch xóa bài #${parsedId}`;
  broadcastDeleteProgress(message, "muted", items);
  return { items: await getScheduledDeletes(), message };
}

async function deleteArticleOnTechHub(uuid, credentials) {
  const url = `https://techhub.fpt.net/api/v1/articles/${encodeURIComponent(uuid)}/`;
  return fetch(url, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": credentials.csrfToken,
    },
    credentials: "include",
  });
}

async function executeDeletePost(item) {
  const { credentials } = await getFreshTechHubSession();
  if (!credentials?.csrfToken) {
    throw new Error("Thiếu phiên TechHub khi đến giờ xóa.");
  }

  const response = await deleteArticleOnTechHub(item.techhubUuid, credentials);
  if (!response?.ok && response?.status !== 204 && response?.status !== 404) {
    throw new Error(`TechHub DELETE HTTP ${response?.status || "unknown"}`);
  }

  try {
    await supabase.deletePostByTechhubId(item.techhubId);
  } catch (error) {
    console.warn("[Background] Deleted on TechHub but failed to remove from DB:", error);
  }

  await chrome.alarms.clear(deleteAlarmName(item.techhubId));
}

async function processDueScheduledDeletes() {
  let items = await loadScheduledDeleteList();
  const now = Date.now();
  let changed = false;

  for (const item of items) {
    if (item.status !== "pending") continue;
    if (new Date(item.deleteAt).getTime() > now) continue;

    try {
      await executeDeletePost(item);
      item.status = "done";
      item.completedAt = new Date().toISOString();
      item.lastError = null;
      changed = true;
      broadcastDeleteProgress(`Đã xóa bài #${item.techhubId} trên TechHub.`, "success");
    } catch (error) {
      item.status = "error";
      item.lastError = error.message;
      item.completedAt = new Date().toISOString();
      changed = true;
      broadcastDeleteProgress(`Lỗi xóa #${item.techhubId}: ${error.message}`, "error");
    }
  }

  // Giữ pending + vài lịch sử gần nhất
  const pending = items.filter((i) => i.status === "pending");
  const history = items
    .filter((i) => i.status !== "pending")
    .sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0))
    .slice(0, 10);
  items = [...pending, ...history];
  if (changed) {
    await saveScheduledDeleteList(items);
    broadcastDeleteProgress("Đã cập nhật lịch xóa.", "info", items);
  }
  return items;
}

async function deletePostNow(techhubId) {
  const parsedId = Number(techhubId);
  if (!Number.isInteger(parsedId) || parsedId < 1) {
    throw new Error("techhub_id phải là số nguyên >= 1.");
  }
  const post = await supabase.getPostByTechhubId(parsedId);
  if (!post?.techhub_uuid) {
    throw new Error(`Không tìm thấy bài #${parsedId} (hoặc thiếu uuid) trong DB.`);
  }
  await executeDeletePost({
    techhubId: parsedId,
    techhubUuid: post.techhub_uuid,
  });

  // Bỏ khỏi lịch nếu có
  let items = await loadScheduledDeleteList();
  items = items.filter((i) => Number(i.techhubId) !== parsedId);
  await saveScheduledDeleteList(items);
  await chrome.alarms.clear(deleteAlarmName(parsedId));

  const message = `Đã xóa ngay bài #${parsedId}`;
  broadcastDeleteProgress(message, "success", items);
  return { message, items };
}

function getCommentBody(comment) {
  return (
    comment?.body ||
    comment?.content ||
    comment?.text ||
    stripHtml(comment?.body_html || comment?.bodyAsHTML || "") ||
    ""
  );
}

function getCommentParentId(comment) {
  const raw =
    comment?.ancestry ??
    comment?.parent_id ??
    comment?.parent_comment_id ??
    comment?.parent?.id ??
    null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function flattenComments(list, out = []) {
  for (const comment of list || []) {
    if (!comment) continue;
    out.push(comment);
    const kids = comment.children || comment.replies || comment.comments;
    if (Array.isArray(kids) && kids.length) flattenComments(kids, out);
  }
  return out;
}

/**
 * Dựng chuỗi hội thoại tới comment đích: A → B → A ...
 * Dòng của chính mình được đánh dấu "(bạn - tác giả)" để AI nối mạch đúng.
 */
function buildCommentThreadText(targetComment, allComments, selfUsername = null) {
  if (!targetComment) return "";
  const flat = flattenComments(allComments);
  const byId = new Map();
  for (const c of flat) {
    if (c?.id != null) byId.set(Number(c.id), c);
  }

  const chain = [];
  let current = targetComment;
  const seen = new Set();
  while (current && !seen.has(Number(current.id))) {
    seen.add(Number(current.id));
    chain.unshift(current);
    const parentId = getCommentParentId(current);
    current = parentId ? byId.get(parentId) || null : null;
  }

  return chain
    .map((c) => {
      const author = getCommentAuthorUsername(c) || "user";
      const body = stripHtml(getCommentBody(c)).slice(0, 500);
      const selfTag = selfUsername && author === selfUsername ? " (bạn - tác giả)" : "";
      return `@${author}${selfTag}: ${body}`;
    })
    .filter((line) => !line.endsWith(": "))
    .join("\n");
}

/**
 * Comment cuối của mỗi chuỗi (leaf): A → B reply A → C reply B → ...
 * Nối tiếp vào các leaf này giúp giữ đúng cấu trúc hội thoại.
 */
function findThreadLeafComments(allComments) {
  const flat = flattenComments(allComments);
  const parentIds = new Set();
  for (const comment of flat) {
    const parentId = getCommentParentId(comment);
    if (parentId) parentIds.add(parentId);
  }

  const leaves = flat.filter(
    (comment) => comment?.id && !parentIds.has(Number(comment.id))
  );

  const depthOf = (comment) => {
    const byId = new Map(flat.filter((c) => c?.id != null).map((c) => [Number(c.id), c]));
    let depth = 0;
    let current = comment;
    const seen = new Set();
    while (current && !seen.has(Number(current.id))) {
      seen.add(Number(current.id));
      const parentId = getCommentParentId(current);
      current = parentId ? byId.get(parentId) || null : null;
      if (current) depth += 1;
    }
    return depth;
  };

  // Chuỗi sâu nhất trước để ưu tiên nối tiếp hội thoại đang diễn ra
  return leaves.sort((a, b) => depthOf(b) - depthOf(a));
}

function countTrailingSelfComments(targetComment, allComments, username) {
  if (!targetComment || !username) return 0;
  const flat = flattenComments(allComments);
  const byId = new Map(
    flat.filter((comment) => comment?.id != null).map((comment) => [Number(comment.id), comment])
  );
  let count = 0;
  let current = targetComment;
  const seen = new Set();

  while (current && !seen.has(Number(current.id))) {
    seen.add(Number(current.id));
    if (getCommentAuthorUsername(current) !== username) break;
    count += 1;
    const parentId = getCommentParentId(current);
    current = parentId ? byId.get(parentId) || null : null;
  }
  return count;
}

async function composeAutoReplyBody({
  useAi,
  fallbackTemplate,
  comment,
  post,
  articleBody,
  threadText,
  username,
  status = "used",
  persistDraft = true,
}) {
  const commentBody = getCommentBody(comment);
  const commentAuthor = getCommentAuthorUsername(comment);
  const isSelfComment = !!username && commentAuthor === username;
  const threadSnapshot =
    threadText ||
    `@${commentAuthor || "user"}: ${stripHtml(commentBody)}`;

  if (useAi) {
    const replyBody = await nvidiaGenerateReply({
      postTitle: post.title,
      articleBody,
      commentAuthor,
      commentBody,
      threadText: threadSnapshot,
      isSelfComment,
      username,
    });
    const cfg = getNvidiaConfig();
    if (persistDraft) {
      await supabase.saveReplyDraft({
        username,
        techhubId: post.techhub_id,
        parentCommentId: comment.id,
        commentAuthor,
        commentBody: threadSnapshot,
        replyBody,
        source: "nvidia",
        model: cfg.model,
        status,
      });
    }
    return {
      body: replyBody,
      source: "nvidia",
      model: cfg.model,
      commentAuthor,
      threadSnapshot,
    };
  }

  if (isSelfComment) {
    throw new Error("Nối lượt của chính mình cần bật NVIDIA AI (template không phù hợp).");
  }
  if (!fallbackTemplate?.content) {
    throw new Error("Không có template reply để dùng.");
  }
  return {
    body: fallbackTemplate.content,
    source: "template",
    model: null,
    commentAuthor,
    threadSnapshot,
  };
}

async function generateReplyDrafts(techhubId, count, maxConsecutiveSelfReplies) {
  const targetId = normalizeTechhubId(techhubId);
  const requestedCount = Number(count);
  if (!targetId) throw new Error("Hãy chọn bài cần tạo mẫu trả lời.");
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 50) {
    throw new Error("Số mẫu cần tạo phải từ 1 đến 50.");
  }
  if (
    autoReplyRunning ||
    autoDiscussionRunning ||
    autoExternalDiscussionRunning ||
    autoCommentState.active
  ) {
    throw new Error("Đang có job AI/comment khác chạy. Hãy đợi xong trước.");
  }

  autoReplyRunning = true;
  try {
    const { credentials, username } = await getFreshTechHubSession();
    if (!credentials?.csrfToken || !username) {
      throw new Error("Thiếu phiên đăng nhập hoặc profile TechHub.");
    }

    const useAi = true;
    const cfg = validateNvidiaConfig();

    const parsedSelfReplies = Number(maxConsecutiveSelfReplies);
    const selfReplyLimit =
      Number.isInteger(parsedSelfReplies) && parsedSelfReplies >= 1 && parsedSelfReplies <= 3
        ? parsedSelfReplies
        : autoReplyState.maxConsecutiveSelfReplies || 1;

    const [post] = await getPostsForAiJob(username, targetId);
    if (!post?.techhub_uuid) throw new Error(`Bài #${targetId} thiếu TechHub UUID.`);

    const [pageData, articleDetail, existingDrafts] = await Promise.all([
      fetchArticleComments(post.techhub_uuid, credentials, { sort: "new", page: 1 }),
      fetchArticleDetail(post.techhub_uuid, credentials),
      supabase.getReplyDrafts(username, targetId),
    ]);
    const allComments = flattenComments(pageData.comments || []);
    const candidates = collectReplyCandidates(
      allComments,
      username,
      selfReplyLimit,
      useAi
    );
    if (!candidates.length) {
      throw new Error("Không có comment nào cần tạo mẫu trả lời trên bài này.");
    }

    const alreadyReplied = await supabase.getRepliedParentCommentIds(
      username,
      candidates.map((c) => c.id)
    );
    const pendingParentIds = new Set(
      existingDrafts
        .filter((draft) => draft.status === "pending" || draft.status === "posting")
        .map((draft) => Number(draft.parent_comment_id))
    );
    const openCandidates = candidates.filter((comment) => {
      const id = Number(comment.id);
      return !alreadyReplied.has(id) && !pendingParentIds.has(id);
    });
    if (!openCandidates.length) {
      throw new Error(
        "Mọi comment cần trả lời đã có mẫu pending hoặc đã reply. Không còn comment mới để gen."
      );
    }

    const toGenerate = openCandidates.slice(0, requestedCount);
    const created = [];
    const templates = await supabase.getCommentTemplates({ kind: "reply" });

    for (let index = 0; index < toGenerate.length; index += 1) {
      const comment = toGenerate[index];
      chrome.runtime
        .sendMessage({
          action: "replyDraftProgress",
          message: `Đang tạo mẫu reply ${index + 1}/${toGenerate.length} cho comment #${comment.id}...`,
          type: "info",
        })
        .catch(() => {});

      const threadText = buildCommentThreadText(comment, allComments, username);
      let replyPayload;
      try {
        const template =
          templates.length > 0
            ? templates[Math.floor(Math.random() * templates.length)]
            : null;
        replyPayload = await composeAutoReplyBody({
          useAi,
          fallbackTemplate: template,
          comment,
          post,
          articleBody: articleDetail.body,
          threadText,
          username,
          status: "pending",
          persistDraft: false,
        });
      } catch (error) {
        throw new Error(`Gen mẫu cho comment #${comment.id} thất bại: ${error.message}`);
      }

      try {
        const draft = await supabase.saveReplyDraft({
          username,
          techhubId: targetId,
          parentCommentId: comment.id,
          commentAuthor: replyPayload.commentAuthor,
          commentBody: replyPayload.threadSnapshot,
          replyBody: replyPayload.body,
          source: replyPayload.source,
          model: replyPayload.model,
          status: "pending",
        });
        if (!draft) {
          throw new Error("Supabase không trả về dữ liệu.");
        }
        created.push(draft);
      } catch (error) {
        throw new Error(`Không lưu được mẫu ${index + 1}: ${error.message}`);
      }
    }

    autoReplyState.maxConsecutiveSelfReplies = selfReplyLimit;
    await saveAutoReplyState();
    const result = await getReplyDraftsForUi(targetId);
    const skipped = requestedCount - created.length;
    const message =
      `Đã tạo ${created.length} mẫu reply cho bài #${targetId}. Còn ${result.pendingCount} mẫu chưa dùng.` +
      (skipped > 0 ? ` (chỉ còn ${created.length} comment cần gen)` : "");
    return { ...result, createdCount: created.length, message };
  } finally {
    autoReplyRunning = false;
  }
}

async function setAutoReplyEnabled(
  enabled,
  useAi,
  techhubId,
  maxConsecutiveSelfReplies,
  targetCount,
  minIntervalMinutes,
  maxIntervalMinutes
) {
  if (enabled && autoCommentState.active) {
    throw new Error("Đang chạy auto-comment 1 bài. Hãy dừng trước khi bật auto-reply.");
  }

  const liveUserProfile = await readCurrentUserProfileFromTechHub();
  const stored = await chrome.storage.local.get(["userProfile", "techhubCredentials"]);
  const userProfile = liveUserProfile || stored.userProfile;
  if (enabled && (!stored.techhubCredentials?.csrfToken || !userProfile?.username)) {
    throw new Error("Thiếu phiên đăng nhập hoặc profile TechHub.");
  }

  const targetId = normalizeTechhubId(techhubId);
  const parsedTargetCount = Number(targetCount);
  const parsedMinInterval = Number(minIntervalMinutes);
  const parsedMaxInterval = Number(maxIntervalMinutes);
  if (enabled && !targetId) {
    throw new Error("Hãy chọn một bài trước khi bật tự trả lời.");
  }
  if (
    enabled &&
    (!Number.isInteger(parsedTargetCount) || parsedTargetCount < 1 || parsedTargetCount > 100)
  ) {
    throw new Error("Số lượng đăng phải từ 1 đến 100.");
  }
  if (
    enabled &&
    (!Number.isFinite(parsedMinInterval) ||
      !Number.isFinite(parsedMaxInterval) ||
      parsedMinInterval < 1 ||
      parsedMaxInterval < parsedMinInterval ||
      parsedMaxInterval > 1440)
  ) {
    throw new Error("Khoảng thời gian phải hợp lệ (1–1440 phút, từ ≤ đến).");
  }
  if (enabled) {
    const pendingDrafts = await supabase.getReplyDrafts(
      userProfile.username,
      targetId,
      "pending"
    );
    if (pendingDrafts.length === 0) {
      throw new Error("Đã hết mẫu trả lời. Hãy nhờ AI tạo thêm mẫu.");
    }
    if (pendingDrafts.length < parsedTargetCount) {
      throw new Error(
        `Chỉ còn ${pendingDrafts.length} mẫu chưa dùng, không đủ để đăng ${parsedTargetCount} mẫu.`
      );
    }
  }

  const wasEnabled = autoReplyState.enabled;
  autoReplyState.enabled = enabled;
  if (typeof useAi === "boolean") {
    autoReplyState.useAi = useAi;
  }
  autoReplyState.username = userProfile?.username || autoReplyState.username;
  autoReplyState.targetTechhubId = targetId;
  const parsedSelfReplies = Number(maxConsecutiveSelfReplies);
  if (Number.isInteger(parsedSelfReplies) && parsedSelfReplies >= 1 && parsedSelfReplies <= 3) {
    autoReplyState.maxConsecutiveSelfReplies = parsedSelfReplies;
  }
  if (Number.isInteger(parsedTargetCount) && parsedTargetCount >= 1 && parsedTargetCount <= 100) {
    autoReplyState.targetCount = parsedTargetCount;
  }
  if (Number.isFinite(parsedMinInterval)) {
    autoReplyState.minIntervalMinutes = parsedMinInterval;
  }
  if (Number.isFinite(parsedMaxInterval)) {
    autoReplyState.maxIntervalMinutes = parsedMaxInterval;
  }
  if (enabled && !wasEnabled) autoReplyState.completedCount = 0;
  autoReplyState.lastError = null;
  autoReplyState.lastMessage = enabled
    ? `Đã bật tự trả lời · bài #${autoReplyState.targetTechhubId} · đăng ${
        autoReplyState.targetCount
      } mẫu · cách nhau ngẫu nhiên ${autoReplyState.minIntervalMinutes}–${
        autoReplyState.maxIntervalMinutes
      } phút.`
    : "Đã tắt tự trả lời comment.";

  if (enabled) {
    await scheduleNextAutoReply();
  } else {
    await chrome.alarms.clear(AUTO_REPLY_ALARM);
    autoReplyState.nextRunAt = null;
    await saveAutoReplyState();
  }

  try {
    await supabase.updateSetting("enable_auto_reply", enabled, { preserveUpdatedAt: true });
  } catch (error) {
    console.warn("[Background] Could not persist enable_auto_reply setting:", error);
  }
  try {
    await supabase.updateSetting("enable_ai_reply", !!autoReplyState.useAi, {
      preserveUpdatedAt: true,
    });
  } catch (error) {
    console.warn("[Background] Could not persist enable_ai_reply setting:", error);
  }

  broadcastAutoReplyProgress(autoReplyState.lastMessage, enabled ? "success" : "muted");
  return getAutoReplyStatus();
}

async function restoreAutoReply() {
  try {
    const result = await chrome.storage.local.get("autoReplyState");
    if (result.autoReplyState) {
      autoReplyState = { ...autoReplyState, ...result.autoReplyState };
    }
    try {
      const map = await supabase.getSettings(["enable_auto_reply", "enable_ai_reply"]);
      if (map.enable_auto_reply) {
        autoReplyState.enabled = await parseSettingBool(
          map,
          "enable_auto_reply",
          autoReplyState.enabled
        );
      }
      if (map.enable_ai_reply) {
        autoReplyState.useAi = await parseSettingBool(map, "enable_ai_reply", autoReplyState.useAi);
      }
      if (autoReplyState.enabled && !normalizeTechhubId(autoReplyState.targetTechhubId)) {
        autoReplyState.enabled = false;
        autoReplyState.lastMessage =
          "Job trả lời cũ đã dừng. Hãy chọn bài và chuẩn bị kho mẫu trước khi bật lại.";
        await supabase.updateSetting("enable_auto_reply", false, {
          preserveUpdatedAt: true,
        });
      }
      await saveAutoReplyState();
      if (autoReplyState.enabled) {
        const alarm = await chrome.alarms.get(AUTO_REPLY_ALARM);
        if (!alarm) await scheduleNextAutoReply();
      }
    } catch (error) {
      console.warn("[Background] Could not load auto-reply settings:", error);
    }
  } catch (error) {
    console.error("[Background] Failed to restore auto reply:", error);
  }
}

/**
 * Service worker có thể bị Chrome tắt giữa lượt đăng, để lại draft treo ở "posting"
 * và job sẽ tưởng là hết mẫu. Dựa vào interactions để biết mẫu đã đăng thật hay chưa.
 */
async function reclaimStuckReplyDrafts(username, techhubId) {
  let stuck = [];
  try {
    stuck = await supabase.getReplyDrafts(username, techhubId, "posting");
  } catch (error) {
    console.warn("[Background] Could not read stuck reply drafts:", error);
    return;
  }
  if (!stuck.length) return;
  let posted = new Set();
  try {
    posted = await supabase.getRepliedParentCommentIds(
      username,
      stuck.map((draft) => Number(draft.parent_comment_id))
    );
  } catch (error) {
    console.warn("[Background] Could not check replied comments:", error);
  }
  for (const draft of stuck) {
    const nextStatus = posted.has(Number(draft.parent_comment_id)) ? "used" : "pending";
    try {
      await supabase.updateReplyDraftStatus(draft.id, nextStatus);
    } catch (error) {
      console.warn(`[Background] Could not reclaim reply draft #${draft.id}:`, error);
    }
  }
}

async function runAutoReply({
  manual = false,
  techhubId = null,
} = {}) {
  if (autoReplyRunning) {
    if (!manual && autoReplyState.enabled) {
      await scheduleNextAutoReply();
    }
    return { replied: 0, skipped: true, message: "Auto-reply đang chạy." };
  }
  if (!manual && !autoReplyState.enabled) {
    return { replied: 0, skipped: true, message: "Auto-reply đang tắt." };
  }
  if (autoCommentState.active) {
    if (!manual && autoReplyState.enabled) {
      await scheduleNextAutoReply();
    }
    const message = "Bỏ qua auto-reply vì auto-comment 1 bài đang chạy.";
    broadcastAutoReplyProgress(message, "info");
    return { replied: 0, skipped: true, message };
  }
  if (autoDiscussionRunning || autoExternalDiscussionRunning) {
    if (!manual && autoReplyState.enabled) {
      await scheduleNextAutoReply();
    }
    return {
      replied: 0,
      skipped: true,
      message: "Bỏ qua auto-reply vì một job AI thảo luận đang chạy.",
    };
  }

  autoReplyRunning = true;
  let replied = 0;
  try {
    const stored = await chrome.storage.local.get(["techhubCredentials", "userProfile"]);
    const liveUserProfile = await readCurrentUserProfileFromTechHub();
    const userProfile = liveUserProfile || stored.userProfile;
    const credentials = stored.techhubCredentials;
    const username = userProfile?.username;
    if (!credentials?.csrfToken || !username) {
      throw new Error("Thiếu phiên đăng nhập hoặc profile TechHub.");
    }
    if (liveUserProfile) {
      await chrome.storage.local.set({ userProfile: liveUserProfile });
    }

    const freshCsrf = await refreshCSRFToken();
    if (freshCsrf) {
      credentials.csrfToken = freshCsrf;
      await chrome.storage.local.set({ techhubCredentials: credentials });
    }

    const scopeTechhubId = manual
      ? normalizeTechhubId(techhubId)
      : autoReplyState.targetTechhubId;
    if (!scopeTechhubId) throw new Error("Hãy chọn bài cần trả lời.");
    const [post] = await getPostsForAiJob(username, scopeTechhubId);
    if (!post?.techhub_id) {
      throw new Error(`Không tìm thấy bài #${scopeTechhubId} trong DB.`);
    }

    if (
      !manual &&
      Number(autoReplyState.completedCount) >= Number(autoReplyState.targetCount)
    ) {
      autoReplyState.enabled = false;
      autoReplyState.nextRunAt = null;
      await chrome.alarms.clear(AUTO_REPLY_ALARM);
      try {
        await supabase.updateSetting("enable_auto_reply", false, {
          preserveUpdatedAt: true,
        });
      } catch (error) {
        console.warn("[Background] Could not persist completed reply state:", error);
      }
      const message = `Đã đăng đủ ${autoReplyState.targetCount} mẫu reply trên bài #${post.techhub_id}. Đã tự dừng.`;
      autoReplyState.lastMessage = message;
      await saveAutoReplyState();
      broadcastAutoReplyProgress(message, "success");
      return { replied: 0, message };
    }

    await reclaimStuckReplyDrafts(username, post.techhub_id);

    const pendingDrafts = await supabase.getReplyDrafts(
      username,
      post.techhub_id,
      "pending"
    );
    const draft = pendingDrafts[0];
    if (!draft) {
      if (!manual) {
        autoReplyState.enabled = false;
        autoReplyState.nextRunAt = null;
        await chrome.alarms.clear(AUTO_REPLY_ALARM);
        try {
          await supabase.updateSetting("enable_auto_reply", false, {
            preserveUpdatedAt: true,
          });
        } catch (error) {
          console.warn("[Background] Could not persist empty reply state:", error);
        }
      }
      const message = `Đã hết mẫu trả lời cho bài #${post.techhub_id}. Hãy nhờ AI tạo thêm mẫu.${
        manual ? "" : " Đã tự dừng."
      }`;
      autoReplyState.lastMessage = message;
      autoReplyState.lastRunAt = new Date().toISOString();
      await saveAutoReplyState();
      broadcastAutoReplyProgress(message, "muted");
      return { replied: 0, message };
    }

    const nextNumber = manual
      ? 1
      : Number(autoReplyState.completedCount || 0) + 1;
    broadcastAutoReplyProgress(
      `Đang đăng mẫu reply cho bài #${post.techhub_id}${
        manual ? "" : ` · ${nextNumber}/${autoReplyState.targetCount}`
      }...`,
      "info"
    );

    await supabase.updateReplyDraftStatus(draft.id, "posting");
    try {
      const response = await interactWithTechHub(
        { techhub_id: post.techhub_id },
        "reply",
        draft.reply_body,
        credentials,
        undefined,
        { parentCommentId: draft.parent_comment_id }
      );
      if (!response?.ok) {
        const status = response?.status || "unknown";
        throw new Error(`TechHub HTTP ${status} khi reply comment #${draft.parent_comment_id}.`);
      }
    } catch (error) {
      await supabase.updateReplyDraftStatus(draft.id, "pending");
      throw error;
    }

    await supabase.updateReplyDraftStatus(draft.id, "used");
    try {
      await supabase.recordInteraction(
        username,
        post.techhub_id,
        "reply",
        draft.parent_comment_id
      );
    } catch (error) {
      // Reply đã đăng (draft đã used) nhưng chưa lưu lịch sử → báo rõ, không retry mù.
      broadcastAutoReplyProgress(
        `Đã reply nhưng chưa lưu được lịch sử: ${error.message}`,
        "error"
      );
    }
    replied = 1;
    if (!manual) autoReplyState.completedCount = nextNumber;

    const reachedTarget =
      !manual &&
      Number(autoReplyState.completedCount) >= Number(autoReplyState.targetCount);
    if (reachedTarget) {
      autoReplyState.enabled = false;
      autoReplyState.nextRunAt = null;
      await chrome.alarms.clear(AUTO_REPLY_ALARM);
      try {
        await supabase.updateSetting("enable_auto_reply", false, {
          preserveUpdatedAt: true,
        });
      } catch (error) {
        console.warn("[Background] Could not persist completed reply state:", error);
      }
    }

    const message = manual
      ? `Đã đăng 1 mẫu reply trên bài #${post.techhub_id} · comment #${draft.parent_comment_id}.`
      : `Đã đăng ${autoReplyState.completedCount}/${autoReplyState.targetCount} mẫu reply trên bài #${post.techhub_id}.${
          reachedTarget ? " Đã tự dừng." : ""
        }`;
    autoReplyState.username = username;
    autoReplyState.lastRunAt = new Date().toISOString();
    autoReplyState.lastReplyCount = replied;
    autoReplyState.lastError = null;
    autoReplyState.lastMessage = message;
    await saveAutoReplyState();
    broadcastAutoReplyProgress(message, "success");
    return { replied, message };
  } catch (error) {
    console.error("[Background] Auto reply failed:", error);
    autoReplyState.lastError = error.message;
    autoReplyState.lastMessage = error.message;
    autoReplyState.lastRunAt = new Date().toISOString();
    await saveAutoReplyState();
    broadcastAutoReplyProgress(`Lỗi auto-reply: ${error.message}`, "error");
    throw error;
  } finally {
    autoReplyRunning = false;
    if (!manual && autoReplyState.enabled) {
      await scheduleNextAutoReply();
      broadcastAutoReplyProgress(
        `${autoReplyState.lastMessage} Lượt kế tiếp lúc ${new Date(
          autoReplyState.nextRunAt
        ).toLocaleTimeString("vi-VN")}.`,
        autoReplyState.lastError ? "error" : "success"
      );
    }
  }
}

function getAutoDiscussionStatus() {
  return {
    ...autoDiscussionState,
  };
}

async function getDiscussionDraftsForUi(techhubId) {
  const targetId = normalizeTechhubId(techhubId);
  if (!targetId) {
    return { drafts: [], pendingCount: 0, usedCount: 0 };
  }
  const stored = await chrome.storage.local.get("userProfile");
  const username = stored.userProfile?.username;
  if (!username) throw new Error("Không tìm thấy profile TechHub.");
  await getPostsForAiJob(username, targetId);
  const drafts = await supabase.getDiscussionDrafts(username, targetId);
  return {
    drafts,
    pendingCount: drafts.filter((draft) => draft.status === "pending").length,
    usedCount: drafts.filter((draft) => draft.status === "used").length,
  };
}

async function updateDiscussionDraft(id, body) {
  const draftId = Number(id);
  const content = String(body || "").trim();
  if (!Number.isInteger(draftId) || draftId < 1) throw new Error("ID mẫu không hợp lệ.");
  if (!content) throw new Error("Nội dung thảo luận không được để trống.");
  if (content.length > 10000) throw new Error("Nội dung thảo luận quá dài.");
  const stored = await chrome.storage.local.get("userProfile");
  const username = stored.userProfile?.username;
  if (!username) throw new Error("Không tìm thấy profile TechHub.");
  return supabase.updateDiscussionDraftBody(username, draftId, content);
}

async function deleteDiscussionDraft(id) {
  const draftId = Number(id);
  if (!Number.isInteger(draftId) || draftId < 1) throw new Error("ID mẫu không hợp lệ.");
  const stored = await chrome.storage.local.get("userProfile");
  const username = stored.userProfile?.username;
  if (!username) throw new Error("Không tìm thấy profile TechHub.");
  return supabase.deleteDiscussionDraft(username, draftId);
}

async function deletePendingDiscussionDrafts(techhubId) {
  const targetId = normalizeTechhubId(techhubId);
  if (!targetId) throw new Error("Hãy chọn bài cần xóa mẫu.");
  const stored = await chrome.storage.local.get("userProfile");
  const username = stored.userProfile?.username;
  if (!username) throw new Error("Không tìm thấy profile TechHub.");
  const deleted = await supabase.deletePendingDiscussionDrafts(username, targetId);
  const result = await getDiscussionDraftsForUi(targetId);
  return {
    ...result,
    deletedCount: deleted.length,
    message: deleted.length
      ? `Đã xóa ${deleted.length} mẫu thảo luận chưa dùng của bài #${targetId}.`
      : `Bài #${targetId} không còn mẫu thảo luận chưa dùng.`,
  };
}

async function generateDiscussionDrafts(techhubId, count) {
  const targetId = normalizeTechhubId(techhubId);
  const requestedCount = Number(count);
  if (!targetId) throw new Error("Hãy chọn bài cần tạo mẫu thảo luận.");
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 50) {
    throw new Error("Số mẫu cần tạo phải từ 1 đến 50.");
  }
  if (
    autoDiscussionRunning ||
    autoExternalDiscussionRunning ||
    autoCommentState.active ||
    autoReplyRunning
  ) {
    throw new Error("Đang có job AI/comment khác chạy. Hãy đợi xong trước.");
  }

  autoDiscussionRunning = true;
  try {
    const { credentials, username } = await getFreshTechHubSession();
    if (!credentials?.csrfToken || !username) {
      throw new Error("Thiếu phiên đăng nhập hoặc profile TechHub.");
    }
    const cfg = validateNvidiaConfig();

    const [post] = await getPostsForAiJob(username, targetId);
    if (!post?.techhub_uuid) throw new Error(`Bài #${targetId} thiếu TechHub UUID.`);
    const [pageData, articleDetail, existingDrafts] = await Promise.all([
      fetchArticleComments(post.techhub_uuid, credentials, { sort: "new", page: 1 }),
      fetchArticleDetail(post.techhub_uuid, credentials),
      supabase.getDiscussionDrafts(username, targetId),
    ]);
    const previousTexts = flattenComments(pageData.comments || [])
      .filter(
        (comment) =>
          !getCommentParentId(comment) &&
          getCommentAuthorUsername(comment) === username &&
          getCommentBody(comment)
      )
      .slice(0, 10)
      .map((comment) => getCommentBody(comment));
    previousTexts.push(...existingDrafts.map((draft) => draft.discussion_body).filter(Boolean));

    const created = [];
    for (let index = 0; index < requestedCount; index += 1) {
      chrome.runtime
        .sendMessage({
          action: "discussionDraftProgress",
          message: `Đang tạo mẫu ${index + 1}/${requestedCount} cho bài #${targetId}...`,
          type: "info",
        })
        .catch(() => {});
      const discussionBody = await nvidiaGenerateDiscussion({
        postTitle: post.title,
        articleBody: articleDetail.body,
        previousBodies: previousTexts,
        discussionNumber: existingDrafts.length + index + 1,
        discussionTarget: existingDrafts.length + requestedCount,
        username,
        isOwnPost: true,
      });
      let draft;
      try {
        draft = await supabase.saveDiscussionDraft({
          username,
          techhubId: targetId,
          sourceCommentId: null,
          sourceCommentBody: previousTexts.join("\n") || null,
          discussionBody,
          model: cfg.model,
          status: "pending",
        });
      } catch (error) {
        throw new Error(`Không lưu được mẫu ${index + 1}: ${error.message}`);
      }
      if (!draft) {
        throw new Error(`Không lưu được mẫu ${index + 1}: Supabase không trả về dữ liệu.`);
      }
      created.push(draft);
      previousTexts.push(discussionBody);
    }

    const result = await getDiscussionDraftsForUi(targetId);
    const message = `Đã tạo ${created.length} mẫu cho bài #${targetId}. Còn ${result.pendingCount} mẫu chưa dùng.`;
    return { ...result, createdCount: created.length, message };
  } finally {
    autoDiscussionRunning = false;
  }
}

function broadcastAutoDiscussionProgress(message, type = "info") {
  chrome.runtime.sendMessage({
    action: "autoDiscussionProgress",
    message,
    type,
    state: getAutoDiscussionStatus(),
  }).catch(() => {});
}

async function saveAutoDiscussionState() {
  await chrome.storage.local.set({ autoDiscussionState });
}

function getRandomDiscussionDelayMinutes() {
  const min = Number(autoDiscussionState.minIntervalMinutes) ||
    DEFAULT_DISCUSSION_MIN_INTERVAL_MINUTES;
  const max = Number(autoDiscussionState.maxIntervalMinutes) ||
    DEFAULT_DISCUSSION_MAX_INTERVAL_MINUTES;
  return min + Math.random() * (max - min);
}

async function scheduleNextAutoDiscussion() {
  if (!autoDiscussionState.enabled) {
    autoDiscussionState.nextRunAt = null;
    await chrome.alarms.clear(AUTO_DISCUSSION_ALARM);
    await saveAutoDiscussionState();
    return null;
  }
  const delayInMinutes = getRandomDiscussionDelayMinutes();
  const when = Date.now() + delayInMinutes * 60 * 1000;
  await chrome.alarms.clear(AUTO_DISCUSSION_ALARM);
  chrome.alarms.create(AUTO_DISCUSSION_ALARM, { when });
  autoDiscussionState.nextRunAt = new Date(when).toISOString();
  await saveAutoDiscussionState();
  return when;
}

async function setAutoDiscussionEnabled(
  enabled,
  techhubId,
  targetCount,
  minIntervalMinutes,
  maxIntervalMinutes
) {
  if (enabled && autoCommentState.active) {
    throw new Error("Hãy dừng auto-comment trước khi bật tự thảo luận.");
  }
  const stored = await chrome.storage.local.get(["userProfile", "techhubCredentials"]);
  if (enabled && (!stored.userProfile?.username || !stored.techhubCredentials?.csrfToken)) {
    throw new Error("Thiếu phiên đăng nhập hoặc profile TechHub.");
  }

  const targetId = normalizeTechhubId(techhubId);
  const parsedTargetCount = Number(targetCount);
  const parsedMinInterval = Number(minIntervalMinutes);
  const parsedMaxInterval = Number(maxIntervalMinutes);
  if (enabled && !targetId) {
    throw new Error("Hãy chọn một bài trước khi bật tự thảo luận.");
  }
  if (
    enabled &&
    (!Number.isInteger(parsedTargetCount) || parsedTargetCount < 1 || parsedTargetCount > 100)
  ) {
    throw new Error("Số lượng đăng phải từ 1 đến 100.");
  }
  if (
    enabled &&
    (!Number.isFinite(parsedMinInterval) ||
      !Number.isFinite(parsedMaxInterval) ||
      parsedMinInterval < 1 ||
      parsedMaxInterval < parsedMinInterval ||
      parsedMaxInterval > 1440)
  ) {
    throw new Error("Khoảng thời gian phải hợp lệ (1–1440 phút, từ ≤ đến).");
  }
  if (enabled) {
    const pendingDrafts = await supabase.getDiscussionDrafts(
      stored.userProfile.username,
      targetId,
      "pending"
    );
    if (pendingDrafts.length === 0) {
      throw new Error("Đã hết mẫu thảo luận. Hãy nhờ AI tạo thêm mẫu.");
    }
    if (pendingDrafts.length < parsedTargetCount) {
      throw new Error(
        `Chỉ còn ${pendingDrafts.length} mẫu chưa dùng, không đủ để đăng ${parsedTargetCount} mẫu.`
      );
    }
  }

  const wasEnabled = autoDiscussionState.enabled;
  autoDiscussionState.enabled = enabled;
  autoDiscussionState.username =
    stored.userProfile?.username || autoDiscussionState.username;
  autoDiscussionState.targetTechhubId = targetId;
  if (Number.isInteger(parsedTargetCount) && parsedTargetCount >= 1 && parsedTargetCount <= 100) {
    autoDiscussionState.targetCount = parsedTargetCount;
  }
  if (Number.isFinite(parsedMinInterval)) {
    autoDiscussionState.minIntervalMinutes = parsedMinInterval;
  }
  if (Number.isFinite(parsedMaxInterval)) {
    autoDiscussionState.maxIntervalMinutes = parsedMaxInterval;
  }
  if (enabled && !wasEnabled) autoDiscussionState.completedCount = 0;
  autoDiscussionState.lastError = null;
  autoDiscussionState.lastMessage = enabled
    ? `Đã bật tự thảo luận · bài #${autoDiscussionState.targetTechhubId} · đăng ${
        autoDiscussionState.targetCount
      } mẫu · cách nhau ngẫu nhiên ${autoDiscussionState.minIntervalMinutes}–${
        autoDiscussionState.maxIntervalMinutes
      } phút.`
    : "Đã tắt AI tự thảo luận.";
  if (enabled) {
    await scheduleNextAutoDiscussion();
  } else {
    await chrome.alarms.clear(AUTO_DISCUSSION_ALARM);
    autoDiscussionState.nextRunAt = null;
    await saveAutoDiscussionState();
  }

  try {
    await supabase.updateSetting("enable_ai_discussion", enabled, {
      preserveUpdatedAt: true,
    });
  } catch (error) {
    console.warn("[Background] Could not persist discussion setting:", error);
  }

  broadcastAutoDiscussionProgress(
    autoDiscussionState.lastMessage,
    enabled ? "success" : "muted"
  );
  return getAutoDiscussionStatus();
}

async function restoreAutoDiscussion() {
  try {
    const result = await chrome.storage.local.get("autoDiscussionState");
    if (result.autoDiscussionState) {
      autoDiscussionState = {
        ...autoDiscussionState,
        ...result.autoDiscussionState,
      };
    }
    try {
      const settings = await supabase.getSettings(["enable_ai_discussion"]);
      if (settings.enable_ai_discussion) {
        autoDiscussionState.enabled = await parseSettingBool(
          settings,
          "enable_ai_discussion",
          autoDiscussionState.enabled
        );
      }
      if (autoDiscussionState.enabled && !normalizeTechhubId(autoDiscussionState.targetTechhubId)) {
        autoDiscussionState.enabled = false;
        autoDiscussionState.lastMessage =
          "Job thảo luận cũ đã dừng. Hãy chọn bài và chuẩn bị kho mẫu trước khi bật lại.";
        await supabase.updateSetting("enable_ai_discussion", false, {
          preserveUpdatedAt: true,
        });
      }
      await saveAutoDiscussionState();
      if (autoDiscussionState.enabled) {
        const alarm = await chrome.alarms.get(AUTO_DISCUSSION_ALARM);
        if (!alarm) await scheduleNextAutoDiscussion();
      }
    } catch (error) {
      console.warn("[Background] Could not load discussion setting:", error);
    }
  } catch (error) {
    console.error("[Background] Failed to restore auto discussion:", error);
  }
}

/**
 * Cứu mẫu thảo luận treo ở "posting" khi service worker bị tắt giữa lượt đăng.
 * Mẫu gốc (source_comment_id null) không tra được interactions nên trả về pending.
 */
async function reclaimStuckDiscussionDrafts(username, techhubId) {
  let stuck = [];
  try {
    stuck = await supabase.getDiscussionDrafts(username, techhubId, "posting");
  } catch (error) {
    console.warn("[Background] Could not read stuck discussion drafts:", error);
    return;
  }
  if (!stuck.length) return;
  const sourceIds = stuck
    .map((draft) => Number(draft.source_comment_id))
    .filter((id) => Number.isFinite(id));
  let posted = new Set();
  if (sourceIds.length) {
    try {
      posted = await supabase.getDiscussedSourceCommentIds(username, sourceIds);
    } catch (error) {
      console.warn("[Background] Could not check discussed comments:", error);
    }
  }
  for (const draft of stuck) {
    const sourceId = Number(draft.source_comment_id);
    const nextStatus =
      Number.isFinite(sourceId) && posted.has(sourceId) ? "used" : "pending";
    try {
      await supabase.updateDiscussionDraftStatus(draft.id, nextStatus);
    } catch (error) {
      console.warn(`[Background] Could not reclaim discussion draft #${draft.id}:`, error);
    }
  }
}

async function runAutoDiscussion({
  manual = false,
  techhubId = null,
} = {}) {
  if (autoDiscussionRunning) {
    if (!manual && autoDiscussionState.enabled) {
      await scheduleNextAutoDiscussion();
    }
    return { discussed: 0, skipped: true, message: "AI thảo luận đang chạy." };
  }
  if (!manual && !autoDiscussionState.enabled) {
    return { discussed: 0, skipped: true, message: "AI thảo luận đang tắt." };
  }
  if (autoCommentState.active || autoReplyRunning || autoExternalDiscussionRunning) {
    if (!manual && autoDiscussionState.enabled) {
      await scheduleNextAutoDiscussion();
    }
    return {
      discussed: 0,
      skipped: true,
      message: "Đang có job comment/reply khác chạy.",
    };
  }

  autoDiscussionRunning = true;
  let discussed = 0;
  try {
    const stored = await chrome.storage.local.get(["techhubCredentials", "userProfile"]);
    const credentials = stored.techhubCredentials;
    const username = stored.userProfile?.username;
    if (!credentials?.csrfToken || !username) {
      throw new Error("Thiếu phiên đăng nhập hoặc profile TechHub.");
    }

    const scopeTechhubId = manual
      ? normalizeTechhubId(techhubId)
      : autoDiscussionState.targetTechhubId;
    if (!scopeTechhubId) throw new Error("Hãy chọn bài cần thảo luận.");
    const [post] = await getPostsForAiJob(username, scopeTechhubId);
    if (!post.techhub_uuid || !post.techhub_id) {
      throw new Error(`Bài #${post.techhub_id || "?"} thiếu TechHub UUID.`);
    }

    if (
      !manual &&
      Number(autoDiscussionState.completedCount) >= Number(autoDiscussionState.targetCount)
    ) {
      autoDiscussionState.enabled = false;
      autoDiscussionState.nextRunAt = null;
      await chrome.alarms.clear(AUTO_DISCUSSION_ALARM);
      try {
        await supabase.updateSetting("enable_ai_discussion", false, {
          preserveUpdatedAt: true,
        });
      } catch (error) {
        console.warn("[Background] Could not persist completed discussion state:", error);
      }
      const message = `Đã đăng đủ ${autoDiscussionState.targetCount} mẫu trên bài #${post.techhub_id}. Đã tự dừng.`;
      autoDiscussionState.lastMessage = message;
      await saveAutoDiscussionState();
      broadcastAutoDiscussionProgress(message, "success");
      return { discussed: 0, message };
    }

    await reclaimStuckDiscussionDrafts(username, post.techhub_id);

    const pendingDrafts = await supabase.getDiscussionDrafts(
      username,
      post.techhub_id,
      "pending"
    );
    const draft = pendingDrafts[0];
    if (!draft) {
      if (!manual) {
        autoDiscussionState.enabled = false;
        autoDiscussionState.nextRunAt = null;
        await chrome.alarms.clear(AUTO_DISCUSSION_ALARM);
        try {
          await supabase.updateSetting("enable_ai_discussion", false, {
            preserveUpdatedAt: true,
          });
        } catch (error) {
          console.warn("[Background] Could not persist empty discussion state:", error);
        }
      }
      const message = `Đã hết mẫu thảo luận cho bài #${post.techhub_id}. Hãy nhờ AI tạo thêm mẫu.${
        manual ? "" : " Đã tự dừng."
      }`;
      autoDiscussionState.lastMessage = message;
      autoDiscussionState.lastRunAt = new Date().toISOString();
      await saveAutoDiscussionState();
      broadcastAutoDiscussionProgress(message, "muted");
      return { discussed: 0, message };
    }

    const nextNumber = manual
      ? 1
      : Number(autoDiscussionState.completedCount || 0) + 1;
    broadcastAutoDiscussionProgress(
      `Đang đăng mẫu cho bài #${post.techhub_id}${
        manual ? "" : ` · ${nextNumber}/${autoDiscussionState.targetCount}`
      }...`,
      "info"
    );

    await supabase.updateDiscussionDraftStatus(draft.id, "posting");
    let response;
    try {
      response = await interactWithTechHub(
        { techhub_id: post.techhub_id },
        "comment",
        draft.discussion_body,
        credentials
      );
      if (!response?.ok) {
        const status = response?.status || "unknown";
        throw new Error(`TechHub HTTP ${status} khi đăng comment thảo luận.`);
      }
    } catch (error) {
      await supabase.updateDiscussionDraftStatus(draft.id, "pending");
      throw error;
    }

    await supabase.updateDiscussionDraftStatus(draft.id, "used");
    try {
      await supabase.recordInteraction(
        username,
        post.techhub_id,
        "self_discussion"
      );
    } catch (error) {
      broadcastAutoDiscussionProgress(
        `Đã đăng nhưng chưa lưu được lịch sử: ${error.message}`,
        "error"
      );
    }
    discussed = 1;
    if (!manual) autoDiscussionState.completedCount = nextNumber;
    autoDiscussionState.lastPostDiscussionCount =
      Number(autoDiscussionState.lastPostDiscussionCount || 0) + 1;
    broadcastAutoDiscussionProgress(
      `Đã đăng một mẫu vào bài #${post.techhub_id}.`,
      "success"
    );

    const reachedTarget =
      !manual &&
      Number(autoDiscussionState.completedCount) >= Number(autoDiscussionState.targetCount);
    if (reachedTarget) {
      autoDiscussionState.enabled = false;
      autoDiscussionState.nextRunAt = null;
      await chrome.alarms.clear(AUTO_DISCUSSION_ALARM);
      try {
        await supabase.updateSetting("enable_ai_discussion", false, {
          preserveUpdatedAt: true,
        });
      } catch (error) {
        console.warn("[Background] Could not persist completed discussion state:", error);
      }
    }
    const message = manual
      ? `Đã đăng 1 mẫu thảo luận trên bài #${post.techhub_id}.`
      : `Đã đăng ${autoDiscussionState.completedCount}/${autoDiscussionState.targetCount} mẫu trên bài #${post.techhub_id}.${
          reachedTarget ? " Đã tự dừng." : ""
        }`;
    autoDiscussionState.username = username;
    autoDiscussionState.lastRunAt = new Date().toISOString();
    autoDiscussionState.lastDiscussionCount = discussed;
    autoDiscussionState.lastError = null;
    autoDiscussionState.lastMessage = message;
    await saveAutoDiscussionState();
    broadcastAutoDiscussionProgress(message, "success");
    return { discussed, message };
  } catch (error) {
    autoDiscussionState.lastError = error.message;
    autoDiscussionState.lastMessage = error.message;
    autoDiscussionState.lastRunAt = new Date().toISOString();
    await saveAutoDiscussionState();
    broadcastAutoDiscussionProgress(
      `Lỗi AI thảo luận: ${error.message}`,
      "error"
    );
    throw error;
  } finally {
    autoDiscussionRunning = false;
    if (!manual && autoDiscussionState.enabled) {
      await scheduleNextAutoDiscussion();
      broadcastAutoDiscussionProgress(
        `${autoDiscussionState.lastMessage} Lượt kế tiếp lúc ${new Date(
          autoDiscussionState.nextRunAt
        ).toLocaleTimeString("vi-VN")}.`,
        autoDiscussionState.lastError ? "error" : "success"
      );
    }
  }
}

function getAutoExternalDiscussionStatus() {
  return { ...autoExternalDiscussionState };
}

async function saveAutoExternalDiscussionState() {
  await chrome.storage.local.set({ autoExternalDiscussionState });
}

function broadcastAutoExternalDiscussionProgress(message, type = "info") {
  chrome.runtime
    .sendMessage({
      action: "autoExternalDiscussionProgress",
      message,
      type,
      state: getAutoExternalDiscussionStatus(),
    })
    .catch(() => {});
}

async function getExternalDiscussionDraftsForUi(techhubId) {
  const { post, actorUsername } = await resolveExternalDiscussionPost(techhubId);
  const drafts = await supabase.getDiscussionDrafts(actorUsername, post.techhub_id);
  return {
    post,
    drafts,
    pendingCount: drafts.filter((draft) => draft.status === "pending").length,
    usedCount: drafts.filter((draft) => draft.status === "used").length,
  };
}

async function deletePendingExternalDiscussionDrafts(techhubId) {
  const { post, actorUsername } = await resolveExternalDiscussionPost(techhubId);
  const deleted = await supabase.deletePendingDiscussionDrafts(
    actorUsername,
    post.techhub_id
  );
  const result = await getExternalDiscussionDraftsForUi(post.techhub_id);
  return {
    ...result,
    deletedCount: deleted.length,
    message: deleted.length
      ? `Đã xóa ${deleted.length} mẫu thảo luận chưa dùng của bài #${post.techhub_id}.`
      : `Bài #${post.techhub_id} không còn mẫu chưa dùng.`,
  };
}

async function generateExternalDiscussionDrafts(techhubId, count) {
  const requestedCount = Number(count);
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 50) {
    throw new Error("Số mẫu cần tạo phải từ 1 đến 50.");
  }
  if (
    autoExternalDiscussionRunning ||
    autoDiscussionRunning ||
    autoReplyRunning ||
    autoCommentState.active
  ) {
    throw new Error("Đang có job AI/comment khác chạy. Hãy đợi xong trước.");
  }

  autoExternalDiscussionRunning = true;
  try {
    const { post, detail, actorUsername } =
      await resolveExternalDiscussionPost(techhubId);
    const { credentials } = await getFreshTechHubSession();
    const cfg = validateNvidiaConfig();
    const [pageData, existingDrafts] = await Promise.all([
      fetchArticleComments(post.techhub_uuid, credentials, { sort: "new", page: 1 }),
      supabase.getDiscussionDrafts(actorUsername, post.techhub_id),
    ]);
    const previousTexts = flattenComments(pageData.comments || [])
      .filter(
        (comment) =>
          !getCommentParentId(comment) &&
          getCommentAuthorUsername(comment) === actorUsername &&
          getCommentBody(comment)
      )
      .slice(0, 10)
      .map((comment) => getCommentBody(comment));
    previousTexts.push(
      ...existingDrafts.map((draft) => draft.discussion_body).filter(Boolean)
    );

    const created = [];
    for (let index = 0; index < requestedCount; index += 1) {
      chrome.runtime
        .sendMessage({
          action: "externalDiscussionDraftProgress",
          message: `Đang tạo mẫu ${index + 1}/${requestedCount} cho bài #${
            post.techhub_id
          }...`,
          type: "info",
        })
        .catch(() => {});
      const discussionBody = await nvidiaGenerateExternalDiscussion({
        postTitle: post.title,
        postAuthor: post.username,
        articleBody: detail.body,
        previousBodies: previousTexts,
        discussionNumber: existingDrafts.length + index + 1,
        discussionTarget: existingDrafts.length + requestedCount,
        username: actorUsername,
      });
      const draft = await supabase.saveDiscussionDraft({
        username: actorUsername,
        techhubId: post.techhub_id,
        sourceCommentId: null,
        sourceCommentBody: previousTexts.join("\n") || null,
        discussionBody,
        model: cfg.model,
        status: "pending",
      });
      if (!draft) {
        throw new Error(`Không lưu được mẫu ${index + 1}: Supabase không trả dữ liệu.`);
      }
      created.push(draft);
      previousTexts.push(discussionBody);
    }
    const result = await getExternalDiscussionDraftsForUi(post.techhub_id);
    return {
      ...result,
      createdCount: created.length,
      message: `Đã tạo ${created.length} mẫu cho bài #${post.techhub_id}. Còn ${result.pendingCount} mẫu chưa dùng.`,
    };
  } finally {
    autoExternalDiscussionRunning = false;
  }
}

function getRandomExternalDiscussionDelayMinutes() {
  const min =
    Number(autoExternalDiscussionState.minIntervalMinutes) ||
    DEFAULT_DISCUSSION_MIN_INTERVAL_MINUTES;
  const max =
    Number(autoExternalDiscussionState.maxIntervalMinutes) ||
    DEFAULT_DISCUSSION_MAX_INTERVAL_MINUTES;
  return min + Math.random() * (max - min);
}

async function scheduleNextAutoExternalDiscussion() {
  if (!autoExternalDiscussionState.enabled) {
    autoExternalDiscussionState.nextRunAt = null;
    await chrome.alarms.clear(AUTO_EXTERNAL_DISCUSSION_ALARM);
    await saveAutoExternalDiscussionState();
    return null;
  }
  const when =
    Date.now() + getRandomExternalDiscussionDelayMinutes() * 60 * 1000;
  await chrome.alarms.clear(AUTO_EXTERNAL_DISCUSSION_ALARM);
  chrome.alarms.create(AUTO_EXTERNAL_DISCUSSION_ALARM, { when });
  autoExternalDiscussionState.nextRunAt = new Date(when).toISOString();
  await saveAutoExternalDiscussionState();
  return when;
}

async function setAutoExternalDiscussionEnabled(
  enabled,
  techhubId,
  targetCount,
  minIntervalMinutes,
  maxIntervalMinutes
) {
  const targetId = normalizeTechhubId(techhubId);
  const parsedTarget = Number(targetCount);
  const parsedMin = Number(minIntervalMinutes);
  const parsedMax = Number(maxIntervalMinutes);
  if (enabled && !targetId) throw new Error("Hãy tải bài người khác trước.");
  if (
    enabled &&
    (!Number.isInteger(parsedTarget) || parsedTarget < 1 || parsedTarget > 100)
  ) {
    throw new Error("Số lượng đăng phải từ 1 đến 100.");
  }
  if (
    enabled &&
    (!Number.isFinite(parsedMin) ||
      !Number.isFinite(parsedMax) ||
      parsedMin < 1 ||
      parsedMax < parsedMin ||
      parsedMax > 1440)
  ) {
    throw new Error("Khoảng thời gian phải hợp lệ (1–1440 phút, từ ≤ đến).");
  }
  const { post, actorUsername } = await resolveExternalDiscussionPost(targetId);
  if (enabled) {
    const pending = await supabase.getDiscussionDrafts(
      actorUsername,
      post.techhub_id,
      "pending"
    );
    if (pending.length < parsedTarget) {
      throw new Error(
        pending.length
          ? `Chỉ còn ${pending.length} mẫu chưa dùng, không đủ đăng ${parsedTarget} mẫu.`
          : "Đã hết mẫu thảo luận. Hãy nhờ AI tạo thêm mẫu."
      );
    }
  }

  const wasEnabled = autoExternalDiscussionState.enabled;
  autoExternalDiscussionState.enabled = enabled;
  autoExternalDiscussionState.username = actorUsername;
  autoExternalDiscussionState.targetTechhubId = post.techhub_id;
  if (Number.isInteger(parsedTarget) && parsedTarget >= 1) {
    autoExternalDiscussionState.targetCount = parsedTarget;
  }
  if (Number.isFinite(parsedMin)) {
    autoExternalDiscussionState.minIntervalMinutes = parsedMin;
  }
  if (Number.isFinite(parsedMax)) {
    autoExternalDiscussionState.maxIntervalMinutes = parsedMax;
  }
  if (enabled && !wasEnabled) autoExternalDiscussionState.completedCount = 0;
  autoExternalDiscussionState.lastError = null;
  autoExternalDiscussionState.lastMessage = enabled
    ? `Đã bật thảo luận bài người khác #${post.techhub_id} · đăng ${
        autoExternalDiscussionState.targetCount
      } mẫu · cách nhau ${autoExternalDiscussionState.minIntervalMinutes}–${
        autoExternalDiscussionState.maxIntervalMinutes
      } phút.`
    : "Đã tắt thảo luận bài người khác.";
  if (enabled) {
    await scheduleNextAutoExternalDiscussion();
  } else {
    await chrome.alarms.clear(AUTO_EXTERNAL_DISCUSSION_ALARM);
    autoExternalDiscussionState.nextRunAt = null;
    await saveAutoExternalDiscussionState();
  }
  broadcastAutoExternalDiscussionProgress(
    autoExternalDiscussionState.lastMessage,
    enabled ? "success" : "muted"
  );
  return getAutoExternalDiscussionStatus();
}

async function restoreAutoExternalDiscussion() {
  try {
    const result = await chrome.storage.local.get("autoExternalDiscussionState");
    if (result.autoExternalDiscussionState) {
      autoExternalDiscussionState = {
        ...autoExternalDiscussionState,
        ...result.autoExternalDiscussionState,
      };
    }
    if (
      autoExternalDiscussionState.enabled &&
      !normalizeTechhubId(autoExternalDiscussionState.targetTechhubId)
    ) {
      autoExternalDiscussionState.enabled = false;
      autoExternalDiscussionState.lastMessage =
        "Job thảo luận bài người khác cũ đã dừng vì thiếu ID bài.";
    }
    await saveAutoExternalDiscussionState();
    if (autoExternalDiscussionState.enabled) {
      const alarm = await chrome.alarms.get(AUTO_EXTERNAL_DISCUSSION_ALARM);
      if (!alarm) await scheduleNextAutoExternalDiscussion();
    }
  } catch (error) {
    console.error("[Background] Failed to restore external discussion:", error);
  }
}

async function stopAutoExternalDiscussion(message, type = "success") {
  autoExternalDiscussionState.enabled = false;
  autoExternalDiscussionState.nextRunAt = null;
  autoExternalDiscussionState.lastMessage = message;
  await chrome.alarms.clear(AUTO_EXTERNAL_DISCUSSION_ALARM);
  await saveAutoExternalDiscussionState();
  broadcastAutoExternalDiscussionProgress(message, type);
}

async function runAutoExternalDiscussion({ manual = false, techhubId = null } = {}) {
  if (autoExternalDiscussionRunning) {
    if (!manual && autoExternalDiscussionState.enabled) {
      await scheduleNextAutoExternalDiscussion();
    }
    return { discussed: 0, skipped: true, message: "Job đang chạy." };
  }
  if (!manual && !autoExternalDiscussionState.enabled) {
    return { discussed: 0, skipped: true, message: "Job đang tắt." };
  }
  if (
    autoCommentState.active ||
    autoReplyRunning ||
    autoDiscussionRunning
  ) {
    if (!manual && autoExternalDiscussionState.enabled) {
      await scheduleNextAutoExternalDiscussion();
    }
    return {
      discussed: 0,
      skipped: true,
      message: "Đang có job AI/comment khác chạy.",
    };
  }

  autoExternalDiscussionRunning = true;
  let discussed = 0;
  try {
    const targetId = manual
      ? normalizeTechhubId(techhubId)
      : autoExternalDiscussionState.targetTechhubId;
    const { post, actorUsername } = await resolveExternalDiscussionPost(targetId);
    if (
      !manual &&
      autoExternalDiscussionState.username &&
      autoExternalDiscussionState.username !== actorUsername
    ) {
      const message = `Đã đổi tài khoản từ @${autoExternalDiscussionState.username} sang @${actorUsername}. Job đã tự dừng.`;
      await stopAutoExternalDiscussion(message, "error");
      return { discussed: 0, message };
    }
    const stored = await chrome.storage.local.get("techhubCredentials");
    const credentials = stored.techhubCredentials;
    if (
      !manual &&
      Number(autoExternalDiscussionState.completedCount) >=
        Number(autoExternalDiscussionState.targetCount)
    ) {
      const message = `Đã đăng đủ ${autoExternalDiscussionState.targetCount} mẫu trên bài #${post.techhub_id}. Đã tự dừng.`;
      await stopAutoExternalDiscussion(message);
      return { discussed: 0, message };
    }

    await reclaimStuckDiscussionDrafts(actorUsername, post.techhub_id);
    const pending = await supabase.getDiscussionDrafts(
      actorUsername,
      post.techhub_id,
      "pending"
    );
    const draft = pending[0];
    if (!draft) {
      const message = `Đã hết mẫu cho bài #${post.techhub_id}. Hãy nhờ AI tạo thêm mẫu.${
        manual ? "" : " Đã tự dừng."
      }`;
      if (!manual) await stopAutoExternalDiscussion(message, "muted");
      return { discussed: 0, message };
    }

    const nextNumber = manual
      ? 1
      : Number(autoExternalDiscussionState.completedCount || 0) + 1;
    broadcastAutoExternalDiscussionProgress(
      `Đang đăng mẫu vào bài #${post.techhub_id}${
        manual ? "" : ` · ${nextNumber}/${autoExternalDiscussionState.targetCount}`
      }...`,
      "info"
    );
    await supabase.updateDiscussionDraftStatus(draft.id, "posting");
    try {
      const response = await interactWithTechHub(
        { techhub_id: post.techhub_id },
        "comment",
        draft.discussion_body,
        credentials
      );
      if (!response?.ok) {
        throw new Error(`TechHub HTTP ${response?.status || "unknown"} khi đăng comment.`);
      }
    } catch (error) {
      await supabase.updateDiscussionDraftStatus(draft.id, "pending");
      throw error;
    }

    await supabase.updateDiscussionDraftStatus(draft.id, "used");
    try {
      await supabase.recordInteraction(
        actorUsername,
        post.techhub_id,
        "external_discussion"
      );
    } catch (error) {
      broadcastAutoExternalDiscussionProgress(
        `Đã đăng nhưng chưa lưu được lịch sử: ${error.message}`,
        "error"
      );
    }
    discussed = 1;
    if (!manual) autoExternalDiscussionState.completedCount = nextNumber;
    const reachedTarget =
      !manual &&
      Number(autoExternalDiscussionState.completedCount) >=
        Number(autoExternalDiscussionState.targetCount);
    if (reachedTarget) {
      autoExternalDiscussionState.enabled = false;
      autoExternalDiscussionState.nextRunAt = null;
      await chrome.alarms.clear(AUTO_EXTERNAL_DISCUSSION_ALARM);
    }
    const message = manual
      ? `Đã đăng 1 mẫu vào bài #${post.techhub_id} của @${post.username}.`
      : `Đã đăng ${autoExternalDiscussionState.completedCount}/${autoExternalDiscussionState.targetCount} mẫu vào bài #${post.techhub_id}.${
          reachedTarget ? " Đã tự dừng." : ""
        }`;
    autoExternalDiscussionState.lastRunAt = new Date().toISOString();
    autoExternalDiscussionState.lastDiscussionCount = discussed;
    autoExternalDiscussionState.lastError = null;
    autoExternalDiscussionState.lastMessage = message;
    await saveAutoExternalDiscussionState();
    broadcastAutoExternalDiscussionProgress(message, "success");
    return { discussed, message };
  } catch (error) {
    autoExternalDiscussionState.lastError = error.message;
    autoExternalDiscussionState.lastMessage = error.message;
    autoExternalDiscussionState.lastRunAt = new Date().toISOString();
    await saveAutoExternalDiscussionState();
    broadcastAutoExternalDiscussionProgress(
      `Lỗi thảo luận bài người khác: ${error.message}`,
      "error"
    );
    throw error;
  } finally {
    autoExternalDiscussionRunning = false;
    if (!manual && autoExternalDiscussionState.enabled) {
      await scheduleNextAutoExternalDiscussion();
      broadcastAutoExternalDiscussionProgress(
        `${autoExternalDiscussionState.lastMessage} Lượt kế tiếp lúc ${new Date(
          autoExternalDiscussionState.nextRunAt
        ).toLocaleTimeString("vi-VN")}.`,
        autoExternalDiscussionState.lastError ? "error" : "success"
      );
    }
  }
}

// Tương tác chéo — giữ tên hàm cũ để tương thích, ủy quyền cho EngagementWorker.
// Chu kỳ/quota/delay nằm trong engagement settings (xem engagement-worker.js).

async function getCrossInteractionEnabled() {
  const settings = await EngagementWorker.getEngagementSettings();
  return settings.enabled === true;
}

async function syncCrossInteractionAlarm() {
  const settings = await EngagementWorker.getEngagementSettings();
  const alarm = await chrome.alarms.get(CROSS_INTERACTION_ALARM);
  if (settings.enabled) {
    // Dựng lại alarm khi chu kỳ đổi (periodInMinutes không cập nhật tại chỗ).
    const period = settings.intervalMinutes;
    const currentPeriod = alarm ? Math.round((alarm.periodInMinutes || 0) * 100) / 100 : null;
    if (!alarm || currentPeriod !== period) {
      await chrome.alarms.clear(CROSS_INTERACTION_ALARM);
      chrome.alarms.create(CROSS_INTERACTION_ALARM, { periodInMinutes: period });
    }
  } else if (alarm) {
    await chrome.alarms.clear(CROSS_INTERACTION_ALARM);
  }
  return settings.enabled;
}

async function setCrossInteractionEnabled(enabled) {
  const settings = await EngagementWorker.saveEngagementSettings({ enabled: !!enabled });
  return settings.enabled;
}

async function runCrossInteraction(isManual = false) {
  // Nhường các job đơn-bài đang chạy để không tranh phiên/CSRF.
  if (!isManual && autoCommentState.active) {
    return { ran: false, skipped: true, reason: "auto_comment_active" };
  }
  if (!isManual && autoReplyRunning) {
    return { ran: false, skipped: true, reason: "auto_reply_running" };
  }
  return EngagementWorker.runEngagementCycle({ manual: !!isManual });
}


// Bỏ qua lỗi CSRF bằng cách ghi đè Origin và Referer cho các API của TechHub
chrome.declarativeNetRequest.updateDynamicRules({
  removeRuleIds: [1],
  addRules: [
    {
      id: 1,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Origin", operation: "set", value: "https://techhub.fpt.net" },
          { header: "Referer", operation: "set", value: "https://techhub.fpt.net/" }
        ]
      },
      condition: {
        urlFilter: "||techhub.fpt.net/api/*",
        resourceTypes: ["xmlhttprequest"]
      }
    }
  ]
});
