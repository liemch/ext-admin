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
const AUTO_REPLY_PERIOD_MINUTES = 5;
const AUTO_DISCUSSION_ALARM = "autoDiscussionAlarm";
const AUTO_DISCUSSION_MIN_INTERVAL_MINUTES = 1;
const AUTO_DISCUSSION_MAX_INTERVAL_MINUTES = 5;
let autoReplyRunning = false;
let autoReplyState = {
  enabled: false,
  useAi: true,
  username: null,
  targetTechhubId: null,
  maxConsecutiveSelfReplies: 1,
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
  nextRunAt: null,
  lastRunAt: null,
  lastDiscussionCount: 0,
  lastPostDiscussionCount: 0,
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
  if (post.username && post.username !== username) {
    throw new Error(`Bài #${targetId} không thuộc @${username}.`);
  }
  return [post];
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
      request.maxConsecutiveSelfReplies
    )
      .then((state) => sendResponse({ success: true, state }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "runAutoReplyOnce") {
    runAutoReply({
      manual: true,
      techhubId: request.techhubId,
      maxConsecutiveSelfReplies: request.maxConsecutiveSelfReplies,
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

  if (request.action === "setAutoDiscussionEnabled") {
    setAutoDiscussionEnabled(
      !!request.enabled,
      request.techhubId,
      request.targetCount
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

  if (request.action === "getAutoDiscussionStatus") {
    autoDiscussionRestorePromise
      .then(() => sendResponse({ success: true, state: getAutoDiscussionStatus() }))
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
    if (!alarm) {
      console.log(`[Background] Creating ${AUTO_REPLY_ALARM} (${AUTO_REPLY_PERIOD_MINUTES}m)`);
      chrome.alarms.create(AUTO_REPLY_ALARM, { periodInMinutes: AUTO_REPLY_PERIOD_MINUTES });
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
  chrome.alarms.get("scheduledDeleteSweep", (alarm) => {
    if (!alarm) {
      chrome.alarms.create("scheduledDeleteSweep", { periodInMinutes: 1 });
    }
  });
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
restoreScheduledDeletes().catch((err) => {
  console.error("[Background] Failed to restore scheduled deletes:", err);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "crossInteractAlarm") {
    runCrossInteraction();
  } else if (alarm.name === "keepAliveAlarm") {
    pingTechHubToKeepAlive();
  } else if (alarm.name === AUTO_REPLY_ALARM) {
    runAutoJobsFromAlarm().catch((err) => {
      console.error("[Background] Auto AI jobs failed:", err);
    });
  } else if (alarm.name === AUTO_COMMENT_START_ALARM) {
    autoCommentRestorePromise
      .then(() => runScheduledAutoCommentStart())
      .catch((err) => {
        console.error("[Background] Scheduled auto comment failed:", err);
      });
  } else if (alarm.name === AUTO_DISCUSSION_ALARM) {
    runAutoDiscussion({ manual: false }).catch((err) => {
      console.error("[Background] Auto discussion alarm failed:", err);
    });
  } else if (alarm.name === "scheduledDeleteSweep" || alarm.name.startsWith("deletePost-")) {
    processDueScheduledDeletes().catch((err) => {
      console.error("[Background] Scheduled delete failed:", err);
    });
  }
});

async function runAutoJobsFromAlarm() {
  if (autoReplyState.enabled) {
    try {
      await runAutoReply({ manual: false });
    } catch (error) {
      console.error("[Background] Auto reply alarm failed:", error);
    }
  }
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
  if (autoReplyRunning || autoDiscussionRunning) {
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
  return { ...autoReplyState, periodMinutes: AUTO_REPLY_PERIOD_MINUTES };
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
    await supabase.saveReplyDraft({
      username,
      techhubId: post.techhub_id,
      parentCommentId: comment.id,
      commentAuthor,
      // Lưu cả chuỗi hội thoại hiện tại để audit khi cấu trúc cmt đổi
      commentBody: threadSnapshot,
      replyBody,
      source: "nvidia",
      model: cfg.model,
      status: "used",
    });
    return { body: replyBody, source: "nvidia" };
  }

  if (isSelfComment) {
    throw new Error("Nối lượt của chính mình cần bật NVIDIA AI (template không phù hợp).");
  }
  if (!fallbackTemplate?.content) {
    throw new Error("Không có template reply để dùng.");
  }
  return { body: fallbackTemplate.content, source: "template" };
}

async function setAutoReplyEnabled(enabled, useAi, techhubId, maxConsecutiveSelfReplies) {
  if (enabled && autoCommentState.active) {
    throw new Error("Đang chạy auto-comment 1 bài. Hãy dừng trước khi bật auto-reply.");
  }

  const liveUserProfile = await readCurrentUserProfileFromTechHub();
  const stored = await chrome.storage.local.get(["userProfile", "techhubCredentials"]);
  const userProfile = liveUserProfile || stored.userProfile;
  if (enabled && (!stored.techhubCredentials?.csrfToken || !userProfile?.username)) {
    throw new Error("Thiếu phiên đăng nhập hoặc profile TechHub.");
  }

  autoReplyState.enabled = enabled;
  if (typeof useAi === "boolean") {
    autoReplyState.useAi = useAi;
  }
  autoReplyState.username = userProfile?.username || autoReplyState.username;
  autoReplyState.targetTechhubId = normalizeTechhubId(techhubId);
  const parsedSelfReplies = Number(maxConsecutiveSelfReplies);
  if (Number.isInteger(parsedSelfReplies) && parsedSelfReplies >= 1 && parsedSelfReplies <= 3) {
    autoReplyState.maxConsecutiveSelfReplies = parsedSelfReplies;
  }
  autoReplyState.lastError = null;
  const scopeLabel = autoReplyState.targetTechhubId
    ? `bài #${autoReplyState.targetTechhubId}`
    : "tất cả bài";
  autoReplyState.lastMessage = enabled
    ? `Đã bật auto-reply (${autoReplyState.useAi ? "NVIDIA AI" : "template"}) · ${scopeLabel}.`
    : "Đã tắt tự trả lời comment.";
  await saveAutoReplyState();

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
  if (enabled) {
    runAutoReply({
      manual: true,
      techhubId: autoReplyState.targetTechhubId,
      maxConsecutiveSelfReplies: autoReplyState.maxConsecutiveSelfReplies,
    }).catch((err) => {
      console.error("[Background] Immediate auto-reply failed:", err);
    });
  }
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
      await saveAutoReplyState();
    } catch (error) {
      console.warn("[Background] Could not load auto-reply settings:", error);
    }
  } catch (error) {
    console.error("[Background] Failed to restore auto reply:", error);
  }
}

async function runAutoReply({
  manual = false,
  techhubId = null,
  maxConsecutiveSelfReplies = null,
} = {}) {
  if (autoReplyRunning) {
    return { replied: 0, skipped: true, message: "Auto-reply đang chạy." };
  }
  if (!manual && !autoReplyState.enabled) {
    return { replied: 0, skipped: true, message: "Auto-reply đang tắt." };
  }
  if (autoCommentState.active) {
    const message = "Bỏ qua auto-reply vì auto-comment 1 bài đang chạy.";
    broadcastAutoReplyProgress(message, "info");
    return { replied: 0, skipped: true, message };
  }
  if (autoDiscussionRunning) {
    return {
      replied: 0,
      skipped: true,
      message: "Bỏ qua auto-reply vì AI thảo luận đang chạy.",
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

    const settings = await supabase.getSettings([
      "enable_auto_reply",
      "auto_reply_max_per_run",
      "enable_ai_reply",
      "ai_reply_fallback_template",
    ]);
    if (!manual) {
      const enabledInDb = await parseSettingBool(settings, "enable_auto_reply", autoReplyState.enabled);
      if (!enabledInDb && !autoReplyState.enabled) {
        return { replied: 0, skipped: true, message: "Auto-reply đang tắt." };
      }
    }

    const maxPerRun = await parseSettingNumber(settings, "auto_reply_max_per_run", 5);
    const useAi = await parseSettingBool(settings, "enable_ai_reply", autoReplyState.useAi !== false);
    const fallbackTemplate = await parseSettingBool(
      settings,
      "ai_reply_fallback_template",
      true
    );
    autoReplyState.useAi = useAi;

    const templates = await supabase.getCommentTemplates({ kind: "reply" });
    if (!useAi && !templates.length) {
      throw new Error("Không có template kind=reply. Hãy chạy migration/seed.");
    }
    if (useAi) {
      const cfg = getNvidiaConfig();
      if (!cfg.apiKey || cfg.apiKey === "YOUR_NVIDIA_API_KEY") {
        throw new Error("Bật AI reply nhưng chưa cấu hình NVIDIA_CONFIG.apiKey trong config.js");
      }
    }

    const scopeTechhubId = manual
      ? normalizeTechhubId(techhubId)
      : autoReplyState.targetTechhubId;
    const requestedSelfReplies = Number(maxConsecutiveSelfReplies);
    const selfReplyLimit =
      manual &&
      Number.isInteger(requestedSelfReplies) &&
      requestedSelfReplies >= 1 &&
      requestedSelfReplies <= 3
        ? requestedSelfReplies
        : autoReplyState.maxConsecutiveSelfReplies || 1;
    const posts = await getPostsForAiJob(username, scopeTechhubId);
    if (!posts.length) {
      const message = "Chưa có bài của bạn trong DB. Hãy bấm Quét bài trước.";
      autoReplyState.lastMessage = message;
      autoReplyState.lastRunAt = new Date().toISOString();
      autoReplyState.lastReplyCount = 0;
      await saveAutoReplyState();
      broadcastAutoReplyProgress(message, "muted");
      return { replied: 0, message, posts: [] };
    }

    broadcastAutoReplyProgress(
      `Đang quét comment trên ${
        scopeTechhubId ? `bài #${scopeTechhubId}` : `${posts.length} bài`
      } · mode=${useAi ? "NVIDIA AI" : "template"}...`,
      "info"
    );
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    for (const post of posts) {
      if (replied >= maxPerRun) break;
      if (!post.techhub_uuid || !post.techhub_id) continue;

      let pageData;
      let articleDetail;
      try {
        [pageData, articleDetail] = await Promise.all([
          fetchArticleComments(post.techhub_uuid, credentials, {
            sort: "new",
            page: 1,
          }),
          fetchArticleDetail(post.techhub_uuid, credentials),
        ]);
      } catch (error) {
        console.warn(`[Background] Fetch article context failed for #${post.techhub_id}:`, error);
        continue;
      }

      const allComments = flattenComments(pageData.comments || []);
      const leafIds = new Set(
        findThreadLeafComments(allComments).map((c) => Number(c.id))
      );
      const candidates = allComments.filter((c) => {
        const author = getCommentAuthorUsername(c);
        if (!c?.id || !author) return false;
        if (author !== username) return true;
        // Comment của chính mình: chỉ nối tiếp khi ở cuối chuỗi và chưa đủ số lượt
        if (selfReplyLimit < 2 || !useAi) return false;
        if (!leafIds.has(Number(c.id))) return false;
        return countTrailingSelfComments(c, allComments, username) < selfReplyLimit;
      });
      if (!candidates.length) continue;

      const already = await supabase.getRepliedParentCommentIds(
        username,
        candidates.map((c) => c.id)
      );

      for (const comment of candidates) {
        if (replied >= maxPerRun) break;
        if (already.has(Number(comment.id))) continue;

        let replyPayload;
        try {
          const template =
            templates.length > 0
              ? templates[Math.floor(Math.random() * templates.length)]
              : null;
          const threadText = buildCommentThreadText(comment, allComments, username);
          replyPayload = await composeAutoReplyBody({
            useAi,
            fallbackTemplate: template,
            comment,
            post,
            articleBody: articleDetail.body,
            threadText,
            username,
          });
        } catch (error) {
          console.warn(`[Background] Compose reply failed for comment ${comment.id}:`, error);
          if (useAi && fallbackTemplate && templates.length) {
            const template = templates[Math.floor(Math.random() * templates.length)];
            replyPayload = { body: template.content, source: "template-fallback" };
            broadcastAutoReplyProgress(
              `AI lỗi, fallback template cho #${comment.id}: ${error.message}`,
              "warn"
            );
          } else {
            continue;
          }
        }

        const response = await interactWithTechHub(
          { techhub_id: post.techhub_id },
          "reply",
          replyPayload.body,
          credentials,
          undefined,
          { parentCommentId: comment.id }
        );

        if (!response?.ok) {
          const status = response?.status || "unknown";
          if (status === 401 || status === 403 || status === 429) {
            throw new Error(`TechHub HTTP ${status} khi reply. Dừng job.`);
          }
          console.error(`[Background] Reply failed on comment ${comment.id}: HTTP ${status}`);
          continue;
        }

        await supabase.recordInteraction(username, post.techhub_id, "reply", comment.id);
        replied += 1;
        const selfChainNote =
          getCommentAuthorUsername(comment) === username
            ? ` · nối lượt của bạn ${
                countTrailingSelfComments(comment, allComments, username) + 1
              }/${selfReplyLimit}`
            : "";
        broadcastAutoReplyProgress(
          `Đã reply #${comment.id} trên bài #${post.techhub_id} (${replyPayload.source})${selfChainNote} · ${replied}/${maxPerRun}.`,
          "success"
        );
        await delay(getRandomAutoCommentDelay());
      }
    }

    const message =
      replied > 0
        ? `Hoàn tất: đã reply ${replied} comment (${useAi ? "AI" : "template"}).`
        : "Không có comment mới cần trả lời.";
    autoReplyState.username = username;
    autoReplyState.maxConsecutiveSelfReplies = selfReplyLimit;
    autoReplyState.lastRunAt = new Date().toISOString();
    autoReplyState.lastReplyCount = replied;
    autoReplyState.lastError = null;
    autoReplyState.lastMessage = message;
    await saveAutoReplyState();
    broadcastAutoReplyProgress(message, replied > 0 ? "success" : "muted");
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
  }
}

function getAutoDiscussionStatus() {
  return {
    ...autoDiscussionState,
    minIntervalMinutes: AUTO_DISCUSSION_MIN_INTERVAL_MINUTES,
    maxIntervalMinutes: AUTO_DISCUSSION_MAX_INTERVAL_MINUTES,
  };
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
  return (
    AUTO_DISCUSSION_MIN_INTERVAL_MINUTES +
    Math.random() *
      (AUTO_DISCUSSION_MAX_INTERVAL_MINUTES - AUTO_DISCUSSION_MIN_INTERVAL_MINUTES)
  );
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
  targetCount
) {
  if (enabled && autoCommentState.active) {
    throw new Error("Hãy dừng auto-comment trước khi bật tự thảo luận.");
  }
  const stored = await chrome.storage.local.get(["userProfile", "techhubCredentials"]);
  if (enabled && (!stored.userProfile?.username || !stored.techhubCredentials?.csrfToken)) {
    throw new Error("Thiếu phiên đăng nhập hoặc profile TechHub.");
  }

  const cfg = getNvidiaConfig();
  if (enabled && (!cfg.apiKey || cfg.apiKey === "YOUR_NVIDIA_API_KEY")) {
    throw new Error("Chưa cấu hình NVIDIA_CONFIG.apiKey trong config.js");
  }

  autoDiscussionState.enabled = enabled;
  autoDiscussionState.username =
    stored.userProfile?.username || autoDiscussionState.username;
  autoDiscussionState.targetTechhubId = normalizeTechhubId(techhubId);
  const parsedTargetCount = Number(targetCount);
  if (Number.isInteger(parsedTargetCount) && parsedTargetCount >= 1 && parsedTargetCount <= 100) {
    autoDiscussionState.targetCount = parsedTargetCount;
  }
  autoDiscussionState.lastError = null;
  autoDiscussionState.lastMessage = enabled
    ? `Đã bật AI tự thảo luận · ${
        autoDiscussionState.targetTechhubId
          ? `bài #${autoDiscussionState.targetTechhubId}`
          : "tất cả bài"
      } · mục tiêu ${autoDiscussionState.targetCount} comment gốc/bài · cách nhau ngẫu nhiên 1–5 phút.`
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

async function runAutoDiscussion({
  manual = false,
  techhubId = null,
  targetCount = null,
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
  if (autoCommentState.active || autoReplyRunning) {
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

    const cfg = getNvidiaConfig();
    if (!cfg.apiKey || cfg.apiKey === "YOUR_NVIDIA_API_KEY") {
      throw new Error("Chưa cấu hình NVIDIA_CONFIG.apiKey trong config.js");
    }

    const requestedTarget = Number(targetCount);
    const discussionTarget =
      manual &&
      Number.isInteger(requestedTarget) &&
      requestedTarget >= 1 &&
      requestedTarget <= 100
        ? requestedTarget
        : autoDiscussionState.targetCount || 5;
    const scopeTechhubId = manual
      ? normalizeTechhubId(techhubId)
      : autoDiscussionState.targetTechhubId;
    const posts = await getPostsForAiJob(username, scopeTechhubId);
    if (!posts.length) {
      const message = "Chưa có bài của bạn trong DB. Hãy bấm Quét bài trước.";
      autoDiscussionState.lastMessage = message;
      autoDiscussionState.lastRunAt = new Date().toISOString();
      autoDiscussionState.lastDiscussionCount = 0;
      await saveAutoDiscussionState();
      broadcastAutoDiscussionProgress(message, "muted");
      return { discussed: 0, message };
    }

    const postIds = posts
      .map((post) => Number(post.techhub_id))
      .filter((id) => Number.isInteger(id));
    const counts = await supabase.getInteractionCountsByPost(
      username,
      "self_discussion",
      postIds
    );
    const eligiblePosts = posts.filter(
      (post) => (counts.get(Number(post.techhub_id)) || 0) < discussionTarget
    );

    if (!eligiblePosts.length) {
      if (!manual) {
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
      const message = `Đã đủ mục tiêu ${discussionTarget} comment tự thảo luận trên ${
        scopeTechhubId ? `bài #${scopeTechhubId}` : "tất cả bài"
      }.${manual ? "" : " Đã tự dừng."}`;
      autoDiscussionState.lastMessage = message;
      autoDiscussionState.lastRunAt = new Date().toISOString();
      autoDiscussionState.lastDiscussionCount = 0;
      await saveAutoDiscussionState();
      broadcastAutoDiscussionProgress(message, "success");
      return { discussed: 0, message };
    }

    // Mỗi alarm chỉ đăng đúng một comment gốc; ưu tiên bài có ít lượt nhất.
    eligiblePosts.sort(
      (a, b) =>
        (counts.get(Number(a.techhub_id)) || 0) -
        (counts.get(Number(b.techhub_id)) || 0)
    );
    const post = eligiblePosts[0];
    if (!post.techhub_uuid || !post.techhub_id) {
      throw new Error(`Bài #${post.techhub_id || "?"} thiếu TechHub UUID.`);
    }
    const currentCount = counts.get(Number(post.techhub_id)) || 0;
    broadcastAutoDiscussionProgress(
      `Đang sinh comment gốc cho bài #${post.techhub_id} · ${
        currentCount + 1
      }/${discussionTarget}...`,
      "info"
    );

    const [pageData, articleDetail] = await Promise.all([
      fetchArticleComments(post.techhub_uuid, credentials, {
        sort: "new",
        page: 1,
      }),
      fetchArticleDetail(post.techhub_uuid, credentials),
    ]);
    const ownRootComments = flattenComments(pageData.comments || [])
      .filter(
        (comment) =>
          !getCommentParentId(comment) &&
          getCommentAuthorUsername(comment) === username &&
          getCommentBody(comment)
      )
      .slice(0, 10)
      .map((comment) => getCommentBody(comment));
    const discussionBody = await nvidiaGenerateDiscussion({
      postTitle: post.title,
      articleBody: articleDetail.body,
      previousDiscussionText: ownRootComments.join("\n"),
      discussionNumber: currentCount + 1,
      discussionTarget,
      username,
      isOwnPost: true,
    });

    const response = await interactWithTechHub(
      { techhub_id: post.techhub_id },
      "comment",
      discussionBody,
      credentials
    );
    if (!response?.ok) {
      const status = response?.status || "unknown";
      throw new Error(`TechHub HTTP ${status} khi đăng comment thảo luận.`);
    }

    await supabase.saveDiscussionDraft({
      username,
      techhubId: post.techhub_id,
      sourceCommentId: null,
      sourceCommentBody: ownRootComments.join("\n") || null,
      discussionBody,
      model: cfg.model,
      status: "used",
    });
    await supabase.recordInteraction(
      username,
      post.techhub_id,
      "self_discussion"
    );
    discussed = 1;
    const newCount = currentCount + 1;
    autoDiscussionState.lastPostDiscussionCount = newCount;
    broadcastAutoDiscussionProgress(
      `Đã đăng comment gốc vào bài #${post.techhub_id} · ${newCount}/${discussionTarget}.`,
      "success"
    );

    const message =
      `Hoàn tất 1 lượt tự thảo luận trên bài #${post.techhub_id} ` +
      `(${autoDiscussionState.lastPostDiscussionCount}/${discussionTarget}).`;
    autoDiscussionState.username = username;
    autoDiscussionState.targetCount = discussionTarget;
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
