importScripts('config.js', 'supabase-client.js');

// Background Service Worker - Lắng nghe và bắt headers từ TechHub API

// Biến lưu trữ Cookie và CSRF Token
let capturedCredentials = {};
let lastMemoryInteractionTime = 0;

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
}

// Bắt đầu setup Alarm cho Cross Interaction và Keep Alive
chrome.runtime.onInstalled.addListener(setupAlarms);
chrome.runtime.onStartup.addListener(setupAlarms);
// Chạy setup 1 lần khi Service Worker được load để đảm bảo alarm luôn tồn tại
setupAlarms();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "crossInteractAlarm") {
    runCrossInteraction();
  } else if (alarm.name === "keepAliveAlarm") {
    pingTechHubToKeepAlive();
  }
});

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

async function interactWithTechHub(post, type, content, credentials) {
  const headers = {
    'Content-Type': 'application/json',
    'X-CSRFToken': credentials.csrfToken
  };
  
  if (type === 'comment') {
    const url = `https://techhub.fpt.net/api/v1/comments/`;
    return fetch(url, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ article: post.techhub_id, body: content })
    });
  } else if (type === 'like') {
    const url = `https://techhub.fpt.net/api/v1/reactions/toggle/`;
    return fetch(url, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        reactable_type: "Article",
        reactable_id: post.techhub_id,
        category: "upvote"
      })
    });
  }
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

async function runCrossInteraction(isManual = false) {
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
    const templates = await supabase.getCommentTemplates();
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
        console.error("[Background] Comment failed", await commentRes.text());
        broadcastProgress(`- Lỗi bình luận: ${post.title}`, "error");
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
