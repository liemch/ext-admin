importScripts('config.js', 'supabase-client.js', 'nvidia-client.js');

// Background Service Worker - Lắng nghe và bắt headers từ TechHub API

// Biến lưu trữ Cookie và CSRF Token
let capturedCredentials = {};
let lastMemoryInteractionTime = 0;
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
};
const AUTO_COMMENT_START_ALARM = "autoCommentStartAlarm";
let autoCommentSchedule = {
  techhubId: null,
  targetCount: null,
  startAt: null,
  createdAt: null,
  lastError: null,
};
const AUTO_REPLY_ALARM = "autoReplyAlarm";
const DEFAULT_REPLY_MIN_INTERVAL_MINUTES = 1;
const DEFAULT_REPLY_MAX_INTERVAL_MINUTES = 5;
const AUTO_DISCUSSION_ALARM = "autoDiscussionAlarm";
const AUTO_EXTERNAL_DISCUSSION_ALARM = "autoExternalDiscussionAlarm";
const AI_JOB_WATCHDOG_ALARM = "aiJobWatchdogAlarm";
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
async function scanCommunityArticles(communitySlug, months = 1) {
  const actorUsername = await requireTechHubActor();
  const result = await supabase.fetchTechHubCommunityArticles(communitySlug, {
    months,
  });

  let saved = 0;
  let saveError = null;
  let communityColumnsMissing = false;
  try {
    const stats = await supabase.upsertScannedPosts(result.articles);
    saved = stats.saved;
    communityColumnsMissing = stats.communityColumnsMissing;
  } catch (error) {
    saveError = error.message;
    console.error("[Background] Không lưu được bài chuyên mục:", error);
  }

  // Ưu tiên đọc lại từ DB để danh sách hiển thị khớp đúng dữ liệu đã lưu.
  let posts = null;
  if (saved > 0 && !communityColumnsMissing) {
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
    console.log("[Background] Request intercepted:", details.url);
    console.log("[Background] All headers:", details.requestHeaders);

    if (!details.requestHeaders) {
      console.log("[Background] No request headers found");
      return;
    }

    let cookie = null;
    let csrf = null;

    for (const h of details.requestHeaders) {
      console.log(`[Background] Header: ${h.name} = ${h.value ? h.value.substring(0, 50) + "..." : "null"}`);
      if (h.name.toLowerCase() === "cookie") {
        cookie = h.value;
      }
      if (h.name.toLowerCase() === "x-csrftoken") {
        csrf = h.value;
      }
    }

    console.log("====== TECHHUB PROFILE REQUEST ======");
    console.log("Cookie found:", cookie ? "YES (" + cookie.length + " chars)" : "NO");
    console.log("X-CSRFToken found:", csrf ? "YES" : "NO");

    if (cookie || csrf) {
      console.log("Cookie:", cookie);
      console.log("X-CSRFToken:", csrf);

      // Lưu credentials vào storage, giữ lại giá trị cũ nếu request hiện tại không có
      capturedCredentials = {
        cookie: cookie || capturedCredentials.cookie,
        csrfToken: csrf || capturedCredentials.csrfToken,
        capturedAt: new Date().toISOString(),
      };

      // Lưu vào chrome.storage.local
      chrome.storage.local.set(
        {
          techhubCredentials: capturedCredentials,
        },
        () => {
          console.log("Credentials saved to storage");
          
          // Kiểm tra xem đã qua 15 phút kể từ lần tương tác trước chưa
          const now = Date.now();
          chrome.storage.local.get(['lastAutoInteractionTime'], (res) => {
            const lastTime = res.lastAutoInteractionTime || lastMemoryInteractionTime || 0;
            if (now - lastTime > 15 * 60 * 1000) {
              console.log("[Background] Detected new credentials and > 15 minutes since last interaction. Running immediately!");
              lastMemoryInteractionTime = now;
              chrome.storage.local.set({ lastAutoInteractionTime: now }, () => {
                runCrossInteraction(false);
              });
            }
          });
        }
      );
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
    chrome.storage.local.get("userProfile", (result) => {
      if (result.userProfile) {
        console.log("[Background] Found user profile in storage");
        sendResponse({ success: true, userProfile: result.userProfile });
      } else {
        // Lấy userProfile từ localStorage của tab TechHub
        console.log("[Background] Profile not in storage, querying tabs...");
        chrome.tabs.query({}, async (tabs) => {
          const techhubTabs = tabs.filter(t => t.url && t.url.includes("techhub.fpt.net"));
          console.log("[Background] TechHub tabs found:", techhubTabs.length);
          if (techhubTabs.length > 0) {
            try {
              console.log("[Background] Executing script on tab:", techhubTabs[0].id);
              const results = await chrome.scripting.executeScript({
                target: { tabId: techhubTabs[0].id },
                func: () => {
                  const userProfile = localStorage.getItem("userProfile");
                  return userProfile ? JSON.parse(userProfile) : null;
                },
              });
              console.log("[Background] Script results:", results);
              if (results && results[0] && results[0].result) {
                chrome.storage.local.set({ userProfile: results[0].result });
                sendResponse({ success: true, userProfile: results[0].result });
              } else {
                sendResponse({ success: false, error: "Không tìm thấy userProfile trong localStorage của TechHub. Vui lòng đăng nhập lại." });
              }
            } catch (error) {
              console.error("[Background] Error executing script:", error);
              sendResponse({ success: false, error: "Lỗi khi đọc userProfile: " + error.message });
            }
          } else {
            console.log("[Background] No TechHub tabs found");
            sendResponse({ success: false, error: "Vui lòng mở TechHub và đăng nhập trước khi sử dụng." });
          }
        });
      }
    });
    return true;
  }

  if (request.action === "runInteractions") {
    runCrossInteraction(true);
    sendResponse({ success: true });
    return false;
  }

  if (request.action === "startAutoComment") {
    autoCommentRestorePromise
      .then(() => startAutoComment(request.techhubId, null, request.targetCount))
      .then((state) => sendResponse({ success: true, state }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "stopAutoComment") {
    autoCommentRestorePromise
      .then(() => {
        stopAutoComment("Đã dừng theo yêu cầu.");
        sendResponse({ success: true, state: getAutoCommentStatus() });
      })
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "scheduleAutoComment") {
    autoCommentRestorePromise
      .then(() =>
        scheduleAutoCommentStart(request.techhubId, request.targetCount, request.startAt)
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
      .then(() => sendResponse({ success: true, state: getAutoCommentStatus() }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "syncMyPosts") {
    syncMyPosts()
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
    scanCommunityArticles(request.communitySlug, request.months)
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
});

console.log("TechHub Profile Sync - Background script loaded");

// Bật tính năng Side Panel khi bấm vào icon Extension
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

function setupAlarms() {
  chrome.alarms.get("crossInteractAlarm", (alarm) => {
    if (!alarm) {
      console.log("[Background] Creating crossInteractAlarm (15m)");
      chrome.alarms.create("crossInteractAlarm", { periodInMinutes: 15 });
    }
  });
  chrome.alarms.get("keepAliveAlarm", (alarm) => {
    if (!alarm) {
      console.log("[Background] Creating keepAliveAlarm (15m)");
      chrome.alarms.create("keepAliveAlarm", { periodInMinutes: 15 });
    }
  });
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
  // Alarm one-shot có thể bị mất khi service worker khởi động lại, cần watchdog gắn lại.
  chrome.alarms.get(AI_JOB_WATCHDOG_ALARM, (alarm) => {
    if (!alarm) {
      chrome.alarms.create(AI_JOB_WATCHDOG_ALARM, { periodInMinutes: 1 });
    }
  });
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
  if (alarm.name === "crossInteractAlarm") {
    runCrossInteraction();
  } else if (alarm.name === "keepAliveAlarm") {
    pingTechHubToKeepAlive();
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
  } else if (alarm.name === AUTO_COMMENT_START_ALARM) {
    autoCommentRestorePromise
      .then(() => runScheduledAutoCommentStart())
      .catch((err) => {
        console.error("[Background] Scheduled auto comment failed:", err);
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
  }
});

async function runAutoJobsFromAlarm() {
  // Giữ hàm để tương thích cũ; auto-reply giờ dùng alarm one-shot riêng.
}

async function pingTechHubToKeepAlive() {
  console.log("[Background] Pinging TechHub to keep session alive...");
  try {
    const res = await fetch("https://techhub.fpt.net/api/v1/accounts/profile", {
      method: "GET",
      credentials: "include" 
    });
    if (res.ok) {
      console.log("[Background] Keep-alive ping successful!");
    } else {
      console.log("[Background] Keep-alive ping failed with status:", res.status);
    }
  } catch (error) {
    console.error("[Background] Keep-alive ping error:", error);
  }
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
    throw new Error(`Không lấy được nội dung bài (HTTP ${response.status})`);
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

async function readCurrentUserProfileFromTechHub() {
  try {
    const tabs = await chrome.tabs.query({});
    const techhubTab = tabs.find((tab) => tab.url?.includes("techhub.fpt.net"));
    if (!techhubTab?.id) return null;

    const results = await chrome.scripting.executeScript({
      target: { tabId: techhubTab.id },
      func: () => {
        const rawProfile = localStorage.getItem("userProfile");
        return rawProfile ? JSON.parse(rawProfile) : null;
      },
    });
    return results?.[0]?.result || null;
  } catch (error) {
    console.warn("[Background] Could not read current TechHub profile:", error);
    return null;
  }
}

function getAutoCommentStatus() {
  return {
    ...autoCommentState,
    schedule: { ...autoCommentSchedule },
    intervalMinMs: AUTO_COMMENT_MIN_INTERVAL_MS,
    intervalMaxMs: AUTO_COMMENT_MAX_INTERVAL_MS,
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
  await chrome.storage.local.set({ autoCommentState });
}

async function saveAutoCommentSchedule() {
  await chrome.storage.local.set({ autoCommentSchedule });
}

async function scheduleAutoCommentStart(techhubId, targetCount, startAt) {
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

  const post = await supabase.getPostByTechhubId(parsedTechhubId);
  if (!post) {
    throw new Error(`Không tìm thấy bài #${parsedTechhubId} trong DB. Hãy Quét bài trước.`);
  }

  autoCommentSchedule = {
    techhubId: parsedTechhubId,
    targetCount: parsedTarget,
    startAt: when.toISOString(),
    createdAt: new Date().toISOString(),
    lastError: null,
  };
  await chrome.alarms.clear(AUTO_COMMENT_START_ALARM);
  chrome.alarms.create(AUTO_COMMENT_START_ALARM, { when: when.getTime() });
  await saveAutoCommentSchedule();

  broadcastAutoCommentProgress(
    `Đã hẹn auto comment bài #${parsedTechhubId} lúc ${when.toLocaleString("vi-VN")} · mục tiêu ${parsedTarget} cmt.`,
    "success"
  );
  return getAutoCommentStatus();
}

async function cancelAutoCommentSchedule() {
  await chrome.alarms.clear(AUTO_COMMENT_START_ALARM);
  autoCommentSchedule = {
    techhubId: null,
    targetCount: null,
    startAt: null,
    createdAt: null,
    lastError: null,
  };
  await saveAutoCommentSchedule();
  broadcastAutoCommentProgress("Đã hủy lịch auto comment.", "muted");
  return getAutoCommentStatus();
}

async function runScheduledAutoCommentStart() {
  const pending = { ...autoCommentSchedule };
  if (!pending.techhubId || !pending.startAt) return;

  autoCommentSchedule = {
    techhubId: null,
    targetCount: null,
    startAt: null,
    createdAt: null,
    lastError: null,
  };
  await chrome.alarms.clear(AUTO_COMMENT_START_ALARM);
  await saveAutoCommentSchedule();

  try {
    await startAutoComment(pending.techhubId, null, pending.targetCount);
    broadcastAutoCommentProgress(
      `Đến giờ hẹn: bắt đầu auto comment bài #${pending.techhubId}.`,
      "success"
    );
  } catch (error) {
    autoCommentSchedule = { ...pending, lastError: error.message };
    await saveAutoCommentSchedule();
    broadcastAutoCommentProgress(
      `Lịch auto comment bài #${pending.techhubId} thất bại: ${error.message}`,
      "error"
    );
  }
}

async function restoreAutoCommentSchedule() {
  try {
    const stored = await chrome.storage.local.get("autoCommentSchedule");
    if (!stored.autoCommentSchedule?.techhubId) return;
    autoCommentSchedule = { ...autoCommentSchedule, ...stored.autoCommentSchedule };
    const when = new Date(autoCommentSchedule.startAt).getTime();
    if (!Number.isFinite(when)) return;
    // Quá giờ khi browser đang tắt → chạy ngay, còn lại thì đặt lại alarm.
    if (when <= Date.now()) {
      await runScheduledAutoCommentStart();
      return;
    }
    await chrome.alarms.clear(AUTO_COMMENT_START_ALARM);
    chrome.alarms.create(AUTO_COMMENT_START_ALARM, { when });
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

function scheduleAutoCommentTick(generation, delayMs = getRandomAutoCommentDelay()) {
  if (!autoCommentState.active || generation !== autoCommentGeneration) return;
  if (autoCommentTimerId) clearTimeout(autoCommentTimerId);
  autoCommentTimerId = setTimeout(() => runAutoCommentTick(generation), delayMs);
}

async function startAutoComment(techhubId, restoredState = null, targetCount = null) {
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

  autoCommentGeneration++;
  if (autoCommentTimerId) clearTimeout(autoCommentTimerId);
  if (autoCommentAbortController) autoCommentAbortController.abort();
  autoCommentTimerId = null;
  autoCommentAbortController = null;
  autoCommentTickRunning = false;
  autoCommentState = {
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
  };
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
  autoCommentGeneration++;
  if (autoCommentTimerId) clearTimeout(autoCommentTimerId);
  if (autoCommentAbortController) autoCommentAbortController.abort();
  autoCommentTimerId = null;
  autoCommentAbortController = null;
  autoCommentState.active = false;
  autoCommentState.lastError = type === "error" ? reason : null;
  saveAutoCommentState();
  broadcastAutoCommentProgress(reason, type);
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

    autoCommentState.username = username;
    autoCommentState.commentCount += 1;
    autoCommentState.lastCommentAt = new Date().toISOString();
    autoCommentState.lastError = null;
    await saveAutoCommentState();
    await supabase.recordInteraction(
      username,
      autoCommentState.techhubId,
      "comment"
    );

    const reached =
      autoCommentState.targetCount > 0 &&
      autoCommentState.commentCount >= autoCommentState.targetCount;

    broadcastAutoCommentProgress(
      reached
        ? `Đủ ${autoCommentState.commentCount}/${autoCommentState.targetCount} comment vào bài #${autoCommentState.techhubId}. Dừng.`
        : `Đã comment ${autoCommentState.commentCount}/${autoCommentState.targetCount || "?"} vào bài #${autoCommentState.techhubId}.`,
      "success"
    );

    if (reached) {
      stopAutoComment(
        `Hoàn tất: đủ ${autoCommentState.commentCount}/${autoCommentState.targetCount} comment.`,
        "success"
      );
      return;
    }
  } catch (error) {
    if (error.name === "AbortError") return;
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

async function restoreAutoComment() {
  try {
    const result = await chrome.storage.local.get("autoCommentState");
    if (result.autoCommentState?.active) {
      await startAutoComment(
        result.autoCommentState.techhubId,
        result.autoCommentState,
        result.autoCommentState.targetCount
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

  await supabase.syncUser(userProfile);
  const result = await supabase.syncPosts(userProfile.username, (msg) => {
    broadcastAutoReplyProgress(msg, "muted");
  });
  const posts = await supabase.getOwnPosts(userProfile.username, { limit: 100 });
  return { ...result, posts, username: userProfile.username };
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

  const stored = await chrome.storage.local.get(["techhubCredentials", "userProfile"]);
  if (!stored.techhubCredentials?.csrfToken) {
    throw new Error("Thiếu phiên TechHub. Mở TechHub và đăng nhập lại.");
  }

  let items = await loadScheduledDeleteList();
  items = items.filter((i) => Number(i.techhubId) !== parsedId);
  const entry = {
    techhubId: parsedId,
    techhubUuid: post.techhub_uuid,
    title: post.title || "",
    username: post.username || stored.userProfile?.username || null,
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
  const stored = await chrome.storage.local.get("techhubCredentials");
  const credentials = stored.techhubCredentials;
  if (!credentials?.csrfToken) {
    throw new Error("Thiếu phiên TechHub khi đến giờ xóa.");
  }
  const freshCsrf = await refreshCSRFToken();
  if (freshCsrf) {
    credentials.csrfToken = freshCsrf;
    await chrome.storage.local.set({ techhubCredentials: credentials });
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
    const stored = await chrome.storage.local.get(["techhubCredentials", "userProfile"]);
    const credentials = stored.techhubCredentials;
    const username = stored.userProfile?.username;
    if (!credentials?.csrfToken || !username) {
      throw new Error("Thiếu phiên đăng nhập hoặc profile TechHub.");
    }

    const useAi = true;
    const cfg = getNvidiaConfig();
    if (!cfg.apiKey || cfg.apiKey === "YOUR_NVIDIA_API_KEY") {
      throw new Error("Chưa cấu hình NVIDIA_CONFIG.apiKey trong config.js");
    }

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
    await supabase.recordInteraction(
      username,
      post.techhub_id,
      "reply",
      draft.parent_comment_id
    );
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
    const stored = await chrome.storage.local.get(["techhubCredentials", "userProfile"]);
    const credentials = stored.techhubCredentials;
    const username = stored.userProfile?.username;
    if (!credentials?.csrfToken || !username) {
      throw new Error("Thiếu phiên đăng nhập hoặc profile TechHub.");
    }
    const cfg = getNvidiaConfig();
    if (!cfg.apiKey || cfg.apiKey === "YOUR_NVIDIA_API_KEY") {
      throw new Error("Chưa cấu hình NVIDIA_CONFIG.apiKey trong config.js");
    }

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
    await supabase.recordInteraction(
      username,
      post.techhub_id,
      "self_discussion"
    );
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
    const stored = await chrome.storage.local.get("techhubCredentials");
    const credentials = stored.techhubCredentials;
    const cfg = getNvidiaConfig();
    if (!cfg.apiKey || cfg.apiKey === "YOUR_NVIDIA_API_KEY") {
      throw new Error("Chưa cấu hình NVIDIA_CONFIG.apiKey trong config.js");
    }
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
    await supabase.recordInteraction(
      actorUsername,
      post.techhub_id,
      "external_discussion"
    );
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

async function runCrossInteraction(isManual = false) {
  if (autoCommentState.active) {
    console.log("[Background] Skipping cross interaction while auto comment is active");
    broadcastProgress("Bỏ qua tương tác chéo vì auto comment đang chạy.", "info");
    return;
  }
  if (autoReplyRunning || autoReplyState.enabled) {
    // Không chặn hoàn toàn khi enabled nhưng đang idle; chỉ skip nếu đang reply
    if (autoReplyRunning) {
      broadcastProgress("Bỏ qua tương tác chéo vì auto-reply đang chạy.", "info");
      return;
    }
  }

  console.log("[Background] Running cross interaction...");
  
  // Cập nhật lại thời gian lastAutoInteractionTime
  const now = Date.now();
  lastMemoryInteractionTime = now;
  chrome.storage.local.set({ lastAutoInteractionTime: now });
  
  broadcastProgress("Bắt đầu tiến trình tương tác...", "info");
  
  const result = await chrome.storage.local.get(['techhubCredentials', 'userProfile']);
  
  if (!result.techhubCredentials || !result.userProfile) {
    console.log("[Background] Missing credentials/profile");
    broadcastProgress("Lỗi: Thiếu thông tin profile hoặc credentials.", "error");
    if (!isManual) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/coin.png",
        title: "Lỗi TechHub Sync",
        message: "Thiếu thông tin. Vui lòng mở tab TechHub để đồng bộ lại."
      });
    }
    return;
  }

  const { techhubCredentials: creds, userProfile } = result;
  const username = userProfile.username;

  // Refresh CSRF Token before interacting
  const freshCsrf = await refreshCSRFToken();
  if (freshCsrf) {
    console.log("[Background] Obtained fresh CSRF token",freshCsrf);
    creds.csrfToken = freshCsrf;
    chrome.storage.local.set({ techhubCredentials: creds });
  } else {
    console.log("[Background] Could not refresh CSRF token, using old one");
  }

  try {
    // 1. Get comment templates
    const templates = await supabase.getCommentTemplates({ kind: "comment" });
    if (!templates || templates.length === 0) {
      console.log("[Background] No comment templates found");
      broadcastProgress("Lỗi: Không tìm thấy mẫu bình luận.", "error");
      return;
    }

    // 2. Get uninteracted posts
    const limit = 5; // Cập nhật: Lấy tối đa 5 bài cho cả tương tác tự động và thủ công
    const posts = await supabase.getUninteractedPosts(username, limit);
    if (!posts || posts.length === 0) {
      console.log("[Background] No uninteracted posts found");
      broadcastProgress("Không có bài viết mới nào cần tương tác.", "info");
      return;
    }

    broadcastProgress(`Tìm thấy ${posts.length} bài viết cần tương tác.`, "info");

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      
      if (i > 0) {
        broadcastProgress("Đang chờ 5s trước khi tương tác bài tiếp theo...", "info");
        await delay(5000);
      }

      if (!post.techhub_uuid) {
        console.log(`[Background] Post ${post.techhub_id} is missing techhub_uuid. Skipping.`);
        continue;
      }

      broadcastProgress(`Đang xử lý: ${post.title}`, "info");
      
      const template = templates[Math.floor(Math.random() * templates.length)];
      
      // 3. Comment on post
      const commentRes = await interactWithTechHub(post, 'comment', template.content, creds);
      if (commentRes && commentRes.ok) {
        console.log("[Background] Comment successful");
        await supabase.recordInteraction(username, post.techhub_id, 'comment');
        broadcastProgress(`- Đã bình luận: ${post.title}`, "success");
      } else {
        const status = commentRes ? commentRes.status : 'Unknown';
        console.error(`[Background] Comment failed with status ${status}`);
        broadcastProgress(`- Lỗi bình luận: ${post.title}`, "error");
        
        if (status === 401 || status === 403) {
          broadcastProgress("Token hết hạn. Đang tự động nạp lại (mở tab ẩn trong 3s)...", "warn");
          
          chrome.tabs.create({ url: "https://techhub.fpt.net/", active: false }, (tab) => {
            setTimeout(() => {
              chrome.tabs.remove(tab.id);
            }, 3000);
          });
          
          chrome.notifications.create({
            type: "basic",
            iconUrl: "icons/coin.png",
            title: "TechHub - Đang lấy lại Token",
            message: "Phát hiện Token hết hạn. Đang tự động mở tab ẩn để lấy lại Token!"
          });
          break; // Stop loop if unauthorized
        }
      }
      
      // 4. Like post
      let likeRes = await interactWithTechHub(post, 'like', null, creds);
      if (likeRes && likeRes.ok) {
        const likeData = await likeRes.json();
        if (likeData.result === "destroy") {
          console.log("[Background] Toggled to unlike. Calling again to re-like...");
          likeRes = await interactWithTechHub(post, 'like', null, creds);
        }
        
        if (likeRes && likeRes.ok) {
          console.log("[Background] Like successful");
          await supabase.recordInteraction(username, post.techhub_id, 'like');
          broadcastProgress(`- Đã thích: ${post.title}`, "success");
        } else {
          broadcastProgress(`- Lỗi thích bài: ${post.title}`, "error");
        }
      } else {
        broadcastProgress(`- Lỗi thích bài: ${post.title}`, "error");
      }
    }
    
    broadcastProgress("Hoàn tất tương tác chéo.", "success");
    
    // Show system notification when done
    if (!isManual) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/coin.png",
        title: "TechHub Profile Sync",
        message: `Đã tự động tương tác ${posts.length} bài viết!`
      });
    }
    
  } catch (err) {
    console.error("[Background] Error in cross interaction:", err);
    broadcastProgress("Lỗi hệ thống: " + err.message, "error");
    if (!isManual) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/coin.png",
        title: "Lỗi TechHub Sync",
        message: `Có lỗi xảy ra: ${err.message}`
      });
    }
  }
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
