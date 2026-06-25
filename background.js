importScripts('config.js', 'supabase-client.js');

// Background Service Worker - Lắng nghe và bắt headers từ TechHub API

// Biến lưu trữ Cookie và CSRF Token
let capturedCredentials = {
  cookie: null,
  csrfToken: null,
  capturedAt: null,
};

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

      // Lưu credentials vào storage
      capturedCredentials = {
        cookie: cookie,
        csrfToken: csrf,
        capturedAt: new Date().toISOString(),
      };

      // Lưu vào chrome.storage.local
      chrome.storage.local.set(
        {
          techhubCredentials: capturedCredentials,
        },
        () => {
          console.log("Credentials saved to storage");
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
    // Lấy userProfile từ localStorage của tab TechHub
    console.log("[Background] Getting user profile...");
    chrome.tabs.query({ url: "https://techhub.fpt.net/*" }, async (tabs) => {
      console.log("[Background] Tabs found:", tabs.length);
      if (tabs.length > 0) {
        try {
          console.log("[Background] Executing script on tab:", tabs[0].id);
          const results = await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: () => {
              const userProfile = localStorage.getItem("userProfile");
              return userProfile ? JSON.parse(userProfile) : null;
            },
          });
          console.log("[Background] Script results:", results);
          if (results && results[0] && results[0].result) {
            sendResponse({ success: true, userProfile: results[0].result });
          } else {
            sendResponse({ success: false, error: "Không tìm thấy userProfile trong localStorage" });
          }
        } catch (error) {
          console.error("[Background] Error executing script:", error);
          sendResponse({ success: false, error: "Lỗi khi đọc userProfile: " + error.message });
        }
      } else {
        console.log("[Background] No TechHub tabs found");
        sendResponse({ success: false, error: "Không tìm thấy tab TechHub. Vui lòng mở https://techhub.fpt.net" });
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

// Bắt đầu setup Alarm cho Cross Interaction
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.get("crossInteractAlarm", (alarm) => {
    if (!alarm) {
      chrome.alarms.create("crossInteractAlarm", { periodInMinutes: 30 });
    }
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "crossInteractAlarm") {
    runCrossInteraction();
  }
});

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

async function runCrossInteraction(isManual = false) {
  console.log("[Background] Running cross interaction...");
  broadcastProgress("Bắt đầu tiến trình tương tác...", "info");
  
  const result = await chrome.storage.local.get(['techhubCredentials', 'userProfile']);
  
  if (!result.techhubCredentials || !result.userProfile) {
    console.log("[Background] Missing credentials/profile");
    broadcastProgress("Lỗi: Thiếu thông tin profile hoặc credentials.", "error");
    return;
  }

  const { techhubCredentials: creds, userProfile } = result;
  const username = userProfile.username;

  try {
    // 1. Get comment templates
    const templates = await supabase.getCommentTemplates();
    if (!templates || templates.length === 0) {
      console.log("[Background] No comment templates found");
      broadcastProgress("Lỗi: Không tìm thấy mẫu bình luận.", "error");
      return;
    }

    // 2. Get uninteracted posts
    const limit = isManual ? 5 : 1;
    const posts = await supabase.getUninteractedPosts(username, limit);
    if (!posts || posts.length === 0) {
      console.log("[Background] No uninteracted posts found");
      broadcastProgress("Không có bài viết mới nào cần tương tác.", "info");
      return;
    }

    broadcastProgress(`Tìm thấy ${posts.length} bài viết cần tương tác.`, "info");

    for (const post of posts) {
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
    
  } catch (err) {
    console.error("[Background] Error in cross interaction:", err);
    broadcastProgress("Lỗi hệ thống: " + err.message, "error");
  }
}
