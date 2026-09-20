// post-sync-client.js — Gọi Edge Function post-sync-api.
//
// Dùng trong background service worker (importScripts). Token device dùng chung
// với engagement-client để vận hành đơn giản (cùng một máy, cùng một người).

(function (global) {
  "use strict";

  function getPostSyncApiConfig() {
    const cfg = typeof POST_SYNC_API_CONFIG !== "undefined" ? POST_SYNC_API_CONFIG : {};
    const url = String(cfg.url || "").trim().replace(/\/+$/, "");
    const adminToken = String(cfg.adminToken || "").trim();
    return {
      url: url && !url.includes("xxxxx") ? url : "",
      adminToken: adminToken && adminToken !== "your-admin-token" ? adminToken : "",
    };
  }

  function isPostSyncConfigured() {
    return !!getPostSyncApiConfig().url;
  }

  function isPostSyncLeader() {
    const { url, adminToken } = getPostSyncApiConfig();
    return !!(url && adminToken);
  }

  async function getSharedEngagementDevice() {
    if (global.EngagementClient?.getEngagementDevice) {
      return global.EngagementClient.getEngagementDevice();
    }
    const stored = await chrome.storage.local.get("engagementDevice");
    return stored.engagementDevice || null;
  }

  async function callPostSyncApi(action, payload = {}, options = {}) {
    const { url, adminToken } = getPostSyncApiConfig();
    if (!url) throw new Error("Chưa cấu hình POST_SYNC_API_CONFIG.url trong config.js");
    let token = "";
    if (options.useAdmin) {
      if (!adminToken) throw new Error("Thiếu POST_SYNC_API_CONFIG.adminToken trên máy admin.");
      token = adminToken;
    } else {
      // Device token dùng chung với engagement.
      const device = await getSharedEngagementDevice();
      if (!device?.token) throw new Error("Thiếu device token. Hãy heartbeat engagement trước.");
      token = device.token;
    }
    let requestPayload = payload;
    if (options.useLeaderDevice) {
      const device = await getSharedEngagementDevice();
      if (!device?.deviceId || !device?.token) {
        throw new Error("Máy leader chưa đăng ký device engagement.");
      }
      requestPayload = {
        ...payload,
        deviceId: device.deviceId,
        leaderDeviceToken: device.token,
      };
    }
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action, ...requestPayload }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error) {
      const error = new Error(data?.error || `Post Sync API HTTP ${response.status}`);
      error.httpStatus = response.status;
      throw error;
    }
    return data;
  }

  // ---- Device actions ----
  function submitPostHint(identifier, source, metadata = {}, observedAt) {
    return callPostSyncApi("submitPostHint", {
      identifier,
      source,
      observedAt: observedAt || new Date().toISOString(),
      metadata,
    });
  }

  // ---- Admin/Leader actions ----
  function postSyncAdmin(action, payload = {}, options = {}) {
    return callPostSyncApi(action, payload, {
      useAdmin: true,
      useLeaderDevice: options.useLeaderDevice === true,
    });
  }

  function requestPostSync(scope, extra = {}) {
    return postSyncAdmin("requestPostSync", { scope, ...extra });
  }
  async function saveScannedPosts(username, articles) {
    const rows = Array.isArray(articles) ? articles : [];
    let saved = 0;
    let skipped = 0;
    const CHUNK_SIZE = 200;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const result = await postSyncAdmin("saveScannedPosts", {
        username,
        articles: rows.slice(i, i + CHUNK_SIZE),
      });
      saved += Number(result?.saved) || 0;
      skipped += Number(result?.skipped) || 0;
    }
    return { ok: true, saved, skipped };
  }
  async function saveCommunityScannedPosts(articles) {
    const rows = Array.isArray(articles) ? articles : [];
    let saved = 0;
    let skipped = 0;
    const CHUNK_SIZE = 200;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const result = await postSyncAdmin("saveScannedPosts", {
        articles: rows.slice(i, i + CHUNK_SIZE),
      });
      saved += Number(result?.saved) || 0;
      skipped += Number(result?.skipped) || 0;
    }
    return { ok: true, saved, skipped };
  }
  async function saveMyScannedPosts(articles) {
    const rows = Array.isArray(articles) ? articles : [];
    let saved = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const CHUNK_SIZE = 200;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const result = await callPostSyncApi("saveMyScannedPosts", {
        articles: rows.slice(i, i + CHUNK_SIZE),
      });
      saved += Number(result?.saved) || 0;
      created += Number(result?.created) || 0;
      updated += Number(result?.updated) || 0;
      skipped += Number(result?.skipped) || 0;
    }
    return { ok: true, saved, created, updated, skipped };
  }
  function reconcileMyScannedPosts(liveTechhubIds) {
    return callPostSyncApi("reconcileMyScannedPosts", {
      liveTechhubIds: Array.isArray(liveTechhubIds) ? liveTechhubIds : [],
    });
  }
  function claimPostSyncJob(deviceId, leaseSeconds) {
    return postSyncAdmin("claimPostSyncJob", { deviceId, leaseSeconds }, { useLeaderDevice: true });
  }
  function startPostSyncRun(jobId, sourceId, deviceId) {
    return postSyncAdmin("startPostSyncRun", { jobId, sourceId, deviceId }, { useLeaderDevice: true });
  }
  function extendPostSyncLease(jobId, deviceId, leaseSeconds) {
    return postSyncAdmin("extendPostSyncLease", { jobId, deviceId, leaseSeconds }, { useLeaderDevice: true });
  }
  function completePostSyncJob(result) {
    return postSyncAdmin("completePostSyncJob", result, { useLeaderDevice: true });
  }
  function failPostSyncJob(result) {
    return postSyncAdmin("failPostSyncJob", result, { useLeaderDevice: true });
  }
  function getPostSyncStatus() {
    return postSyncAdmin("getPostSyncStatus", {});
  }
  function listPostSyncRuns(limit = 50, sourceId = null, outcome = null) {
    return postSyncAdmin("listPostSyncRuns", { limit, sourceId, outcome });
  }
  function listPostHints(limit = 50, status = null, username = null) {
    return postSyncAdmin("listPostHints", { limit, status, username });
  }
  function listNewPosts(days = 7, limit = 100, username = null, discoveredBy = null) {
    return postSyncAdmin("listNewPosts", { days, limit, username, discoveredBy });
  }
  function listJobs({ status = null, limit = 50, offset = 0 } = {}) {
    return postSyncAdmin("listJobs", { status, limit, offset });
  }
  function listRuns({ jobId = null, limit = 50, offset = 0 } = {}) {
    return postSyncAdmin("listRuns", { jobId, limit, offset });
  }
  function resubmitHint(hintId) {
    return postSyncAdmin("resubmitHint", { hintId });
  }
  function retryJob(jobId) {
    return postSyncAdmin("retryJob", { jobId });
  }
  function cancelJob(jobId) {
    return postSyncAdmin("cancelJob", { jobId });
  }
  function getStatus() {
    return postSyncAdmin("getStatus", {});
  }
  function enqueueJobs(options = {}) {
    return postSyncAdmin("enqueueJobs", options);
  }
  function getUserSyncStatus(username) {
    return postSyncAdmin("getUserSyncStatus", { username });
  }
  function listActiveUsernames() {
    return postSyncAdmin("listActiveUsernames", {});
  }

  // User action: danh sách bài đã verify (có lọc theo username nếu có).
  function getMySyncedPosts({ limit = 50, offset = 0, username = null, days = 30 } = {}) {
    return callPostSyncApi("listNewPosts", { limit, offset, username, days });
  }

  global.PostSyncClient = {
    getPostSyncApiConfig,
    isPostSyncConfigured,
    isPostSyncLeader,
    callPostSyncApi,
    submitPostHint,
    postSyncAdmin,
    requestPostSync,
    saveScannedPosts,
    saveCommunityScannedPosts,
    saveMyScannedPosts,
    reconcileMyScannedPosts,
    claimPostSyncJob,
    startPostSyncRun,
    extendPostSyncLease,
    completePostSyncJob,
    failPostSyncJob,
    getPostSyncStatus,
    listPostSyncRuns,
    listPostHints,
    listNewPosts,
    getUserSyncStatus,
    listActiveUsernames,
    getMySyncedPosts,
    listJobs,
    listRuns,
    resubmitHint,
    retryJob,
    cancelJob,
    getStatus,
    enqueueJobs,
  };
})(typeof window !== "undefined" ? window : globalThis);
