// publishing-client.js — Gọi Edge Function publishing-api (kho bài + lịch đăng).
//
// Dùng trong background service worker (importScripts). Popup không gọi trực
// tiếp mà nhắn qua background để token chỉ nằm một chỗ.
//
// Device token dùng CHUNG cache với engagement-client (khóa storage
// `engagementDevice`): một thiết bị đã enrollment qua engagement-api được
// publishing-api xác thực bằng đúng hash token đó — đúng model R1, không
// đăng ký thiết bị riêng cho publishing.

(function (global) {
  "use strict";

  const PUBLISHING_DEVICE_KEY = "engagementDevice";
  let deviceCache = null;
  let deviceLoadPromise = null;

  function getPublishingApiConfig() {
    const cfg =
      typeof PUBLISHING_API_CONFIG !== "undefined" ? PUBLISHING_API_CONFIG : {};
    const url = String(cfg.url || "").trim().replace(/\/+$/, "");
    const adminToken = String(cfg.adminToken || "").trim();
    return {
      url: url && !url.includes("xxxxx") ? url : "",
      adminToken:
        adminToken && adminToken !== "your-admin-token" ? adminToken : "",
    };
  }

  function isPublishingConfigured() {
    return !!getPublishingApiConfig().url;
  }

  function normalizeStoredDevice(value) {
    return value && typeof value === "object" ? value : null;
  }

  async function getPublishingDevice() {
    if (deviceCache) return deviceCache;
    if (deviceLoadPromise) return deviceLoadPromise;
    deviceLoadPromise = (async () => {
      try {
        const stored = await global.chrome.storage.local.get([PUBLISHING_DEVICE_KEY]);
        const device = normalizeStoredDevice(stored?.[PUBLISHING_DEVICE_KEY]);
        if (device) deviceCache = device;
        return device;
      } catch {
        return null;
      } finally {
        deviceLoadPromise = null;
      }
    })();
    return deviceLoadPromise;
  }

  /**
   * Gọi publishing-api.
   * - useAdmin: true → Bearer ADMIN_TOKEN (chỉ máy admin).
   * - Mặc định: Bearer device token của thiết bị hiện tại.
   */
  async function callPublishingApi(action, payload = {}, options = {}) {
    const { url, adminToken } = getPublishingApiConfig();
    if (!url) {
      throw new Error("Chưa cấu hình PUBLISHING_API_CONFIG.url trong config.js");
    }
    const headers = { "Content-Type": "application/json" };
    if (options.useAdmin) {
      if (!adminToken) {
        throw new Error("Thiếu PUBLISHING_API_CONFIG.adminToken trên máy admin.");
      }
      headers.Authorization = `Bearer ${adminToken}`;
    } else {
      const device = await getPublishingDevice();
      if (!device?.token) {
        const error = new Error(
          "Thiết bị chưa đăng ký. Hãy enroll thiết bị ở mục Quyền tham gia trước."
        );
        error.code = "DEVICE_ENROLLMENT_REQUIRED";
        throw error;
      }
      headers.Authorization = `Bearer ${device.token}`;
    }
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ action, ...(payload || {}) }),
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const error = new Error(
        data?.error || `publishing-api HTTP ${response.status}`
      );
      error.code = data?.code || "PUBLISHING_REQUEST_FAILED";
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function publishingAdmin(action, payload = {}) {
    return callPublishingApi(action, payload, { useAdmin: true });
  }

  function publishingUser(action, payload = {}) {
    return callPublishingApi(action, payload, { useAdmin: false });
  }

  global.PublishingClient = {
    PUBLISHING_DEVICE_KEY,
    getPublishingApiConfig,
    isPublishingConfigured,
    getPublishingDevice,
    callPublishingApi,
    publishingAdmin,
    publishingUser,
  };
})(typeof window !== "undefined" ? window : globalThis);
