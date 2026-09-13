// engagement-client.js — Gọi Edge Function engagement-api + quản lý device token.
//
// Dùng trong background service worker (importScripts). Popup không gọi trực
// tiếp mà nhắn qua background để token chỉ nằm một chỗ.

(function (global) {
  "use strict";

  const ENGAGEMENT_DEVICE_KEY = "engagementDevice";

  const ENGAGEMENT_DEFAULTS = {
    intervalMinutes: 15,
    tasksPerWake: 1,
    leaseSeconds: 300,
    dailyCap: 3,
    cooldownMinutes: 45,
    offlineAfterMinutes: 30,
  };

  function getEngagementApiConfig() {
    const cfg =
      typeof ENGAGEMENT_API_CONFIG !== "undefined" ? ENGAGEMENT_API_CONFIG : {};
    const url = String(cfg.url || "").trim().replace(/\/+$/, "");
    const adminToken = String(cfg.adminToken || "").trim();
    return {
      url: url && !url.includes("xxxxx") ? url : "",
      adminToken:
        adminToken && adminToken !== "your-admin-token" ? adminToken : "",
    };
  }

  function isEngagementQueueConfigured() {
    return !!getEngagementApiConfig().url;
  }

  function randomToken(bytes = 24) {
    const buffer = new Uint8Array(bytes);
    if (
      global.crypto &&
      typeof global.crypto.getRandomValues === "function"
    ) {
      global.crypto.getRandomValues(buffer);
    } else {
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] = Math.floor(Math.random() * 256);
      }
    }
    return [...buffer].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function newDeviceId() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID();
    }
    return `dev-${Date.now().toString(36)}-${randomToken(8)}`;
  }

  /**
   * Lấy hoặc tạo device token của máy này. Token KHÔNG bao giờ được log hay
   * gửi đi đâu ngoài engagement-api.
   */
  async function ensureEngagementDevice(username) {
    const stored = await chrome.storage.local.get(ENGAGEMENT_DEVICE_KEY);
    let device = stored[ENGAGEMENT_DEVICE_KEY];
    if (!device || typeof device !== "object") {
      device = null;
    }
    if (!device?.deviceId || !device?.token) {
      device = {
        deviceId: newDeviceId(),
        token: randomToken(24),
        username: username || null,
        label: null,
        createdAt: new Date().toISOString(),
      };
    }
    if (username && device.username !== username) {
      device = { ...device, username, switchedAt: new Date().toISOString() };
    }
    if (!device.label) {
      try {
        const info = await chrome.runtime.getPlatformInfo?.();
        device.label = info
          ? `Chrome/${info.os}-${info.arch}`
          : "Chrome extension";
      } catch (_) {
        device.label = "Chrome extension";
      }
    }
    await chrome.storage.local.set({ [ENGAGEMENT_DEVICE_KEY]: device });
    return device;
  }

  async function getEngagementDevice() {
    const stored = await chrome.storage.local.get(ENGAGEMENT_DEVICE_KEY);
    return stored[ENGAGEMENT_DEVICE_KEY] || null;
  }

  async function callEngagementApi(action, payload = {}, options = {}) {
    const { url, adminToken } = getEngagementApiConfig();
    if (!url) {
      throw new Error(
        "Chưa cấu hình ENGAGEMENT_API_CONFIG.url trong config.js"
      );
    }
    let token = "";
    if (options.useAdmin) {
      if (!adminToken) {
        throw new Error(
          "Thiếu ENGAGEMENT_API_CONFIG.adminToken trên máy admin."
        );
      }
      token = adminToken;
    } else {
      const device = await getEngagementDevice();
      if (!device?.token) {
        throw new Error("Thiếu device token. Hãy heartbeat trước.");
      }
      token = device.token;
    }
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error) {
      const error = new Error(data?.error || `Engagement API HTTP ${response.status}`);
      error.httpStatus = response.status;
      throw error;
    }
    return data;
  }

  // ---- Actor API (device token) ----

  async function engagementHeartbeat(username) {
    const device = await ensureEngagementDevice(username);
    const { url } = getEngagementApiConfig();
    if (!url) {
      throw new Error(
        "Chưa cấu hình ENGAGEMENT_API_CONFIG.url trong config.js"
      );
    }
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${device.token}`,
      },
      body: JSON.stringify({
        action: "heartbeat",
        username,
        deviceId: device.deviceId,
        label: device.label,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error) {
      const error = new Error(data?.error || `Engagement API HTTP ${response.status}`);
      error.httpStatus = response.status;
      throw error;
    }
    return data;
  }

  function engagementClaimTask() {
    return callEngagementApi("claimTask", {});
  }

  function engagementCompleteTask(taskId, result = {}) {
    return callEngagementApi("completeTask", { taskId, ...result });
  }

  function engagementFailTask(taskId, failure = {}) {
    return callEngagementApi("failTask", { taskId, ...failure });
  }

  function engagementReleaseMyClaims() {
    return callEngagementApi("releaseMyClaims", {});
  }

  function engagementClearSessionRequired() {
    return callEngagementApi("clearSessionRequired", {});
  }

  function engagementGetStatus() {
    return callEngagementApi("getStatus", {});
  }

  function engagementRedeemUltra(techhubId) {
    return callEngagementApi("redeemUltra", { techhubId });
  }

  function engagementSubmitOwnThreads(techhubId, threads) {
    return callEngagementApi("submitOwnThreads", { techhubId, threads });
  }

  // ---- Admin API (ADMIN_TOKEN, chỉ máy admin) ----

  function engagementAdmin(action, payload = {}) {
    return callEngagementApi(action, payload, { useAdmin: true });
  }

  global.EngagementClient = {
    ENGAGEMENT_DEFAULTS,
    ENGAGEMENT_DEVICE_KEY,
    getEngagementApiConfig,
    isEngagementQueueConfigured,
    ensureEngagementDevice,
    getEngagementDevice,
    callEngagementApi,
    engagementHeartbeat,
    engagementClaimTask,
    engagementCompleteTask,
    engagementFailTask,
    engagementReleaseMyClaims,
    engagementClearSessionRequired,
    engagementGetStatus,
    engagementRedeemUltra,
    engagementSubmitOwnThreads,
    engagementAdmin,
  };
})(typeof window !== "undefined" ? window : globalThis);
