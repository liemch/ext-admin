// post-sync-worker.js — Leader worker thực thi sync job.
//
// Chỉ chạy trên máy admin (có POST_SYNC_API_CONFIG.adminToken). Mỗi lần thức
// dậy xử lý TỐI ĐA 1 job để phù hợp MV3 (service worker giới hạn thời gian).
// Không notification, không tự mở tab khi hết phiên — chỉ gắn cờ
// sessionRequired và đợi admin mở panel để đăng nhập lại.

(function (global) {
  "use strict";

  const POST_SYNC_STATUS_KEY = "postSyncStatus";
  const POST_SYNC_LOCK_KEY = "postSyncLock";
  const POST_SYNC_LEADER_KEY = "postSyncLeader";
  const HINT_DEBOUNCE_KEY = "postSyncHintDebounce";
  const HINT_DEBOUNCE_MS = 30 * 60 * 1000;

  const LOCK_TTL_MS = 15 * 60 * 1000;
  const LEADER_WAKE_ALARM = "postSyncLeaderWake";
  const FEED_SCHEDULE_ALARM = "postSyncFeedSchedule";
  const RECONCILE_SCHEDULE_ALARM = "postSyncReconcileSchedule";

  const HARD_LIMITS = {
    maxRequestsPerRun: 50,
    maxPagesPerSource: 5,
    maxConcurrency: 3,
    requestDelayMs: 1500,
    manualUserScanCooldownMinutes: 10,
  };

  let workerRunning = false;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function defaultStatus() {
    return {
      lastRunAt: null,
      lastOutcome: "idle",
      lastMessage: null,
      lastError: null,
      lastHttpStatus: null,
      sessionRequired: false,
      leaderDeviceId: null,
      leaderActive: false,
      leaseExpiry: null,
      lastFeedAt: null,
      lastReconcileAt: null,
      requestCount24h: 0,
      newPosts24h: 0,
    };
  }

  async function getPostSyncStatus() {
    const stored = await chrome.storage.local.get(POST_SYNC_STATUS_KEY);
    return { ...defaultStatus(), ...(stored[POST_SYNC_STATUS_KEY] || {}) };
  }

  async function savePostSyncStatus(patch = {}) {
    const cur = await getPostSyncStatus();
    const next = { ...cur, ...patch };
    await chrome.storage.local.set({ [POST_SYNC_STATUS_KEY]: next });
    broadcastPostSyncStatus(next);
    return next;
  }

  async function acquirePostSyncLock(owner) {
    const stored = await chrome.storage.local.get(POST_SYNC_LOCK_KEY);
    const lock = stored[POST_SYNC_LOCK_KEY];
    const now = Date.now();
    if (workerRunning) return false;
    if (lock?.lockedAt && now - lock.lockedAt < LOCK_TTL_MS) return false;
    await chrome.storage.local.set({
      [POST_SYNC_LOCK_KEY]: { lockedAt: now, owner: owner || "leader" },
    });
    workerRunning = true;
    return true;
  }

  async function releasePostSyncLock() {
    workerRunning = false;
    await chrome.storage.local.remove(POST_SYNC_LOCK_KEY).catch(() => {});
  }

  function broadcastPostSyncStatus(status) {
    chrome.runtime
      .sendMessage({ action: "postSyncStatus", status })
      .catch(() => {});
  }

  function broadcast(message, type = "info") {
    chrome.runtime
      .sendMessage({ action: "postSyncProgress", message, type })
      .catch(() => {});
  }

  // ---------- leader device id ----------

  async function getLeaderDeviceId() {
    const stored = await chrome.storage.local.get(["engagementDevice", POST_SYNC_LEADER_KEY]);
    const engagementDeviceId = stored.engagementDevice?.deviceId;
    if (!engagementDeviceId || !stored.engagementDevice?.token) {
      throw new Error("Máy admin chưa đăng ký engagement device để làm post-sync leader.");
    }
    const previous = stored[POST_SYNC_LEADER_KEY]?.deviceId;
    if (previous !== engagementDeviceId) {
      await chrome.storage.local.set({
        [POST_SYNC_LEADER_KEY]: { deviceId: engagementDeviceId, updatedAt: new Date().toISOString() },
      });
    }
    return engagementDeviceId;
  }

  // ---------- TechHub fetching helpers ----------
  // Các hàm này gọi từ background.js / supabase-client.js đã có sẵn; worker
  // gọi lại thông qua biến toàn cục để tránh viết trùng.

  function hasTechHubCredentials() {
    // Engagement worker đã kiểm tra — dùng lại.
    if (typeof EngagementWorker !== "undefined" && EngagementWorker.checkTechHubSession) {
      return true;
    }
    return false;
  }

  async function fetchArticleDetailSafe(uuid) {
    // fetchArticleDetail định nghĩa ở background.js, trả về JSON detail.
    if (typeof fetchArticleDetail !== "function") throw new Error("fetchArticleDetail chưa sẵn sàng");
    const stored = await chrome.storage.local.get("techhubCredentials");
    const credentials = stored.techhubCredentials;
    if (!credentials?.csrfToken) {
      const error = new Error("Phiên TechHub không có CSRF token.");
      error.httpStatus = 401;
      throw error;
    }
    const data = await fetchArticleDetail(uuid, credentials);
    return data;
  }

  async function fetchUserArticlesPage(username, page = 1) {
    if (typeof supabase === "undefined") throw new Error("supabase client chưa sẵn sàng");
    return await supabase.fetchTechHubArticles(username, page);
  }

  async function fetchCommunityArticlesPage(communitySlug, cursor = null) {
    if (typeof supabase === "undefined") throw new Error("supabase client chưa sẵn sàng");
    // feed discovery trong plan dùng cửa sổ 7 ngày thay vì month range.
    const slug = String(communitySlug || "").trim().toLowerCase();
    if (!slug) throw new Error("communitySlug rỗng");
    const page = cursor?.page || 1;
    // buildUrl giống fetchTechHubCommunityArticles nhưng rút gọn cho cửa sổ 7 ngày.
    const url = `https://techhub.fpt.net/api/v1/articles/?community__slug=${encodeURIComponent(slug)}&sort=new&date_range=week&page=${page}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    if (!response.ok) {
      const txt = await response.text().catch(() => "");
      const err = new Error(`Feed HTTP ${response.status}: ${txt.slice(0, 160)}`);
      err.httpStatus = response.status;
      throw err;
    }
    return await response.json();
  }

  function extractArticleRows(data) {
    if (Array.isArray(data?.results)) return data.results;
    if (Array.isArray(data?.results?.data)) return data.results.data;
    if (Array.isArray(data)) return data;
    return [];
  }

  function articleTime(a) {
    const t = a?.published_at || a?.created_at || null;
    if (!t) return null;
    const d = new Date(t);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  function articleAuthorUsername(a) {
    return String(
      a?.username || a?.author?.username || a?.user?.username || a?.created_by?.username || a?.owner?.username || ""
    ).trim() || null;
  }

  // ---------- Hint debounce ----------

  async function shouldSubmitHint(identifierKey) {
    const now = Date.now();
    const stored = await chrome.storage.local.get(HINT_DEBOUNCE_KEY);
    const deb = stored[HINT_DEBOUNCE_KEY] || {};
    const last = deb[identifierKey];
    for (const k of Object.keys(deb)) {
      if (now - deb[k] > HINT_DEBOUNCE_MS) delete deb[k];
    }
    if (last && now - last < HINT_DEBOUNCE_MS) return false;
    deb[identifierKey] = now;
    await chrome.storage.local.set({ [HINT_DEBOUNCE_KEY]: deb });
    return true;
  }

  function extractArticleIdentifierFromUrl(urlString) {
    try {
      const url = new URL(String(urlString).trim());
      if (!/(^|\.)techhub\.fpt\.net$/i.test(url.hostname)) return null;
      const path = url.pathname.replace(/\/+/g, "/");
      // /p/<username>/<uuid>/<slug> hoặc /c/<community>/<uuid>/<slug>
      const profileMatch = path.match(/\/p\/([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i);
      const communityMatch = path.match(/\/c\/[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i);
      if (!profileMatch && !communityMatch) return null;
      const uuid = (profileMatch?.[2] || communityMatch?.[1]).toLowerCase();
      // Tìm id ở query ?id=123 (ít gặp) hoặc từ path cuối.
      const idMatch = url.searchParams.get("id");
      const techhubId = idMatch ? Number(idMatch) : null;
      return {
        techhubUuid: uuid,
        techhubId: Number.isInteger(techhubId) ? techhubId : null,
        url: url.toString(),
        authorUsername: profileMatch ? decodeURIComponent(profileMatch[1]) : null,
      };
    } catch {
      return null;
    }
  }

  async function maybeSubmitHintFromUrl(tabUrl, source = "article_page", extra = {}) {
    if (!PostSyncClient.isPostSyncConfigured()) return null;
    const identifier = extractArticleIdentifierFromUrl(tabUrl);
    if (!identifier) return null;
    const stored = await chrome.storage.local.get(["userProfile", "engagementDevice"]);
    const currentUsername = String(
      stored.userProfile?.username || stored.engagementDevice?.username || ""
    ).trim().toLowerCase();
    const observedAuthor = String(identifier.authorUsername || extra.authorUsername || "")
      .trim().toLowerCase();
    // Một URL community không cho biết tác giả; không gán mù bài người khác cho
    // device hiện tại. Những bài đó được feed discovery xử lý.
    if (!currentUsername || !observedAuthor || currentUsername !== observedAuthor) return null;
    const key = identifier.techhubUuid ? `uuid:${identifier.techhubUuid}` : identifier.url;
    if (!(await shouldSubmitHint(key))) return null;
    // Không gửi hint nếu không tìm ra username (không đọc profile qua API ở đây).
    // Leader sẽ verify sau.
    try {
      return await PostSyncClient.submitPostHint(identifier, source, extra);
    } catch (error) {
      console.warn("[PostSync] submit hint failed:", error.message);
      return null;
    }
  }

  // ---------- Job executors ----------

  async function executeVerifyHint(job, runContext) {
    const payload = job.payload || {};
    const techhubUuid = payload.techhubUuid || null;
    const techhubId = payload.techhubId ? Number(payload.techhubId) : null;
    const url = payload.url || null;
    if (!techhubUuid && !techhubId) {
      return { ok: false, error: "hint thiếu techhubUuid/techhubId", permanent: true, rejected: true, reason: "missing_identifier" };
    }
    runContext.requestCount += 1;
    let detail;
    try {
      detail = techhubUuid
        ? await fetchArticleDetailSafe(techhubUuid)
        : await supabase.fetchTechHubArticleById(techhubId);
    } catch (error) {
      return {
        ok: false,
        error: error.message,
        httpStatus: error.httpStatus || 0,
        retryAfterSeconds: error.retryAfterSeconds || null,
      };
    }
    if (!detail) {
      return { ok: false, error: "không tìm thấy bài", httpStatus: 404, permanent: true, rejected: true, reason: "not_found" };
    }
    const realAuthor = articleAuthorUsername(detail);
    const expectedAuthor = job.username || payload.username || null;
    if (expectedAuthor && realAuthor && realAuthor !== expectedAuthor) {
      return {
        ok: false,
        error: `tác giả không khớp (hint=${expectedAuthor}, actual=${realAuthor})`,
        httpStatus: 422,
        permanent: true,
        rejected: true,
        reason: "author_mismatch",
      };
    }
    const articlePayload = typeof supabase !== "undefined" && supabase.buildTechHubPostPayload
      ? supabase.buildTechHubPostPayload(detail)
      : null;
    const finalPayload = articlePayload || {
      techhub_id: Number(detail.id || techhubId),
      techhub_uuid: techhubUuid || detail.uuid,
      username: realAuthor,
      title: detail.title || null,
      status: detail.status || "open",
      url: url || detail.url || null,
      votes_score: Number(detail.votes_score || 0),
      comments_count: Number(detail.comments_count || 0),
      medals_count: typeof extractMedalsCount === "function" ? extractMedalsCount(detail) : Number(detail.medals_count || 0),
      feed_score: Number(detail.feed_score || 0),
      published_at: detail.published_at || null,
      community_slug: detail?.community?.slug || detail.community_slug || null,
      community_name: detail?.community?.name || null,
    };
    return {
      ok: true,
      articles: [finalPayload],
      newCount: 0,
      updatedCount: 1,
      requestCount: runContext.requestCount,
      pageCount: 1,
    };
  }

  async function executeFeedDiscovery(job, runContext) {
    const payload = job.payload || {};
    const communitySlug = String(payload.communitySlug || "cai-tien-moi-ngay");
    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const articles = [];
    const seenIds = new Set();
    let page = payload.cursor?.page || 1;
    let requestCount = runContext.requestCount;
    let reachedEnd = false;
    let lastCursor = null;

    const knownUsernames = new Set(
      await (async () => {
        try {
          const users = await supabase.getAllUsers();
          return (users || [])
            .filter((u) => u.is_locked !== true)
            .map((u) => String(u.username || "").toLowerCase())
            .filter(Boolean);
        } catch {
          return [];
        }
      })()
    );
    let pagesFetched = 0;
    while (pagesFetched < HARD_LIMITS.maxPagesPerSource && requestCount < HARD_LIMITS.maxRequestsPerRun) {
      runContext.requestCount += 1;
      requestCount += 1;
      let data;
      try {
        data = await fetchCommunityArticlesPage(communitySlug, { page });
        pagesFetched += 1;
        await runContext.extendLease?.();
        await delay(HARD_LIMITS.requestDelayMs + Math.random() * 500);
      } catch (error) {
        return {
          ok: false,
          error: error.message,
          httpStatus: error.httpStatus || 0,
          retryAfterSeconds: error.retryAfterSeconds || null,
          requestCount,
        };
      }
      const rows = extractArticleRows(data);
      let sawOld = false;
      for (const a of rows) {
        const id = Number(a?.id);
        if (!Number.isInteger(id) || seenIds.has(id)) continue;
        const t = articleTime(a);
        if (t && t < cutoff) {
          sawOld = true;
          continue;
        }
        const author = articleAuthorUsername(a);
        if (!author) continue;
        if (!knownUsernames.has(author.toLowerCase())) continue;
        seenIds.add(id);
        const p = supabase.buildTechHubPostPayload(a);
        if (p) articles.push(p);
      }
      const hasMore = !!data?.next && rows.length > 0 && !sawOld;
      if (!hasMore) {
        reachedEnd = true;
        break;
      }
      page += 1;
      lastCursor = { page };
    }

    return {
      ok: true,
      articles,
      newCount: 0,
      updatedCount: articles.length,
      unchangedCount: 0,
      requestCount,
      pageCount: pagesFetched,
      cursor: !reachedEnd && lastCursor ? lastCursor : null,
      budgetExhausted: !reachedEnd && !!lastCursor,
    };
  }

  async function executeUserReconcile(job, runContext) {
    const username = String(job.username || job.payload?.username || "");
    if (!username) return { ok: false, error: "thiếu username", permanent: true };
    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const articles = [];
    const seenIds = new Set();
    let page = job.payload?.cursor?.page || 1;
    let requestCount = runContext.requestCount;
    let reachedEnd = false;
    let lastCursor = null;

    let pagesFetched = 0;
    while (pagesFetched < HARD_LIMITS.maxPagesPerSource && requestCount < HARD_LIMITS.maxRequestsPerRun) {
      runContext.requestCount += 1;
      requestCount += 1;
      let data;
      try {
        data = await fetchUserArticlesPage(username, page);
        pagesFetched += 1;
        await runContext.extendLease?.();
        await delay(HARD_LIMITS.requestDelayMs + Math.random() * 500);
      } catch (error) {
        return {
          ok: false,
          error: error.message,
          httpStatus: error.httpStatus || 0,
          retryAfterSeconds: error.retryAfterSeconds || null,
          requestCount,
        };
      }
      const rows = extractArticleRows(data);
      let sawOld = false;
      for (const a of rows) {
        const id = Number(a?.id);
        if (!Number.isInteger(id) || seenIds.has(id)) continue;
        const author = articleAuthorUsername(a);
        if (author && author !== username) continue;
        const t = articleTime(a);
        if (t && t < cutoff) {
          sawOld = true;
          continue;
        }
        seenIds.add(id);
        const p = supabase.buildTechHubPostPayload(a);
        if (p) {
          p.username = username; // đảm bảo đúng user reconcile
          articles.push(p);
        }
      }
      const hasMore = !!data?.next && rows.length > 0 && !sawOld;
      if (!hasMore) {
        reachedEnd = true;
        break;
      }
      page += 1;
      lastCursor = { page };
    }

    return {
      ok: true,
      articles,
      newCount: 0,
      updatedCount: articles.length,
      unchangedCount: 0,
      requestCount,
      pageCount: pagesFetched,
      cursor: !reachedEnd && lastCursor ? lastCursor : null,
      budgetExhausted: !reachedEnd && !!lastCursor,
    };
  }

  // ---------- Leader cycle ----------

  async function runLeaderCycle(options = {}) {
    const manual = options.manual === true;
    if (!PostSyncClient.isPostSyncLeader()) {
      return { ran: false, reason: "not_leader" };
    }
    const status = await getPostSyncStatus();
    if (!manual && status.sessionRequired) {
      return { ran: false, reason: "session_required" };
    }
    const locked = await acquirePostSyncLock(manual ? "manual" : "alarm");
    if (!locked) return { ran: false, reason: "locked" };

    const startedAt = new Date().toISOString();
    try {
      const deviceId = await getLeaderDeviceId();
      // Enqueue due feeds / due_users mỗi 5 phút wake (dù claim đã có sẵn).
      try {
        await PostSyncClient.requestPostSync("due_users").catch(() => null);
      } catch (_) {}

      let claim;
      try {
        claim = await PostSyncClient.claimPostSyncJob(deviceId, 600);
      } catch (error) {
        await savePostSyncStatus({
          lastRunAt: startedAt,
          lastOutcome: "error",
          lastMessage: `Claim job thất bại: ${error.message}`,
          lastError: error.message,
          lastHttpStatus: error.httpStatus || null,
        });
        return { ran: false, error: error.message };
      }

      if (!claim?.job) {
        await savePostSyncStatus({
          lastRunAt: startedAt,
          lastOutcome: "idle",
          lastMessage: claim?.isLeader === false
            ? "Máy admin khác đang giữ leader lease."
            : "Không có job sync nào tới hạn.",
          leaderDeviceId: deviceId,
          leaderActive: claim?.isLeader !== false,
          leaseExpiry: claim?.leader?.lease_until || null,
          lastError: null,
        });
        return { ran: true, handled: 0 };
      }

      const job = claim.job;
      broadcast(`Đang xử lý ${job.type}${job.username ? ` @${job.username}` : ""} (#${job.id})…`, "info");

      // Tạo run.
      let runId = null;
      try {
        const runRes = await PostSyncClient.startPostSyncRun(job.id, job.source_id || null, deviceId);
        runId = runRes.runId || null;
      } catch (error) {
        broadcast(`startPostSyncRun lỗi: ${error.message}`, "error");
        await savePostSyncStatus({
          lastRunAt: startedAt,
          lastOutcome: "error",
          lastError: error.message,
          lastMessage: `Không thể bắt đầu run #${job.id}: ${error.message}`,
        });
        return { ran: false, error: error.message };
      }

      // Gia hạn lease giữa chừng (setTimeout không ổn định trong MV3; chỉ extend
      // sau mỗi trang để đủ đơn giản).
      let lastExtend = Date.now();
      const maybeExtend = async () => {
        if (Date.now() - lastExtend < 4 * 60 * 1000) return;
        try {
          await PostSyncClient.extendPostSyncLease(job.id, deviceId, 600);
          lastExtend = Date.now();
        } catch (_) {}
      };

      const runContext = { requestCount: 0, pageCount: 0, extendLease: maybeExtend };
      let result;
      try {
        if (job.type === "verify_hint") result = await executeVerifyHint(job, runContext);
        else if (job.type === "feed_discovery") result = await executeFeedDiscovery(job, runContext);
        else if (job.type === "user_reconcile") result = await executeUserReconcile(job, runContext);
        else result = { ok: false, error: `job type lạ: ${job.type}`, permanent: true };
        await maybeExtend();
      } catch (error) {
        result = { ok: false, error: error.message, httpStatus: error.httpStatus || 0 };
      }

      if (!result?.ok) {
        const isAuth = result.httpStatus === 401 || result.httpStatus === 403;
        try {
          await PostSyncClient.failPostSyncJob({
            jobId: job.id,
            runId,
            deviceId,
            error: result.error || "unknown_error",
            httpStatus: result.httpStatus || null,
            permanent: !!result.permanent || !!result.rejected,
            retryAfterSeconds: result.retryAfterSeconds || null,
          });
        } catch (e) {
          broadcast(`failPostSyncJob lỗi: ${e.message}`, "error");
        }
        await savePostSyncStatus({
          lastRunAt: startedAt,
          lastOutcome: isAuth ? "session_required" : "error",
          lastMessage: isAuth
            ? "Phiên TechHub hết hạn — mở panel để đăng nhập lại."
            : `${job.type} lỗi: ${result.error}`,
          lastError: result.error,
          lastHttpStatus: result.httpStatus || null,
          sessionRequired: isAuth,
          leaderDeviceId: deviceId,
          leaderActive: !isAuth,
          leaseExpiry: null,
        });
        if (isAuth) broadcast("Phiên TechHub hết hạn — dừng leader đến khi đăng nhập lại.", "error");
        return { ran: true, outcome: "fail", sessionRequired: isAuth };
      }

      // Thành công: complete.
      try {
        await PostSyncClient.completePostSyncJob({
          jobId: job.id,
          runId,
          deviceId,
          requestCount: result.requestCount || runContext.requestCount,
          pageCount: result.pageCount || runContext.pageCount,
          newCount: result.newCount || 0,
          updatedCount: result.updatedCount || (result.articles?.length || 0),
          unchangedCount: result.unchangedCount || 0,
          rejectedCount: 0,
          cursor: result.cursor || null,
          budgetExhausted: !!result.budgetExhausted,
          httpStatus: 200,
          errorSummary: null,
          articles: result.articles || [],
        });
      } catch (error) {
        broadcast(`completePostSyncJob lỗi: ${error.message}`, "error");
        await savePostSyncStatus({
          lastRunAt: startedAt,
          lastOutcome: "error",
          lastMessage: `Không lưu được kết quả job #${job.id}: ${error.message}`,
          lastError: error.message,
          lastHttpStatus: error.httpStatus || null,
          leaderDeviceId: deviceId,
          leaderActive: true,
          leaseExpiry: null,
        });
        return {
          ran: true,
          outcome: "fail",
          jobType: job.type,
          username: job.username || null,
          error: error.message,
        };
      }

      await savePostSyncStatus({
        lastRunAt: startedAt,
        lastOutcome: result.budgetExhausted ? "partial" : "success",
        lastMessage: `${job.type} xong: +${result.newCount || 0} mới, cập nhật ${result.updatedCount || (result.articles?.length || 0)}${result.budgetExhausted ? " (chạm budget, tiếp tục sau)" : ""}`,
        lastError: null,
        lastHttpStatus: 200,
        sessionRequired: false,
        leaderDeviceId: deviceId,
        leaderActive: true,
        leaseExpiry: null,
        lastFeedAt: job.type === "feed_discovery" ? startedAt : status.lastFeedAt,
        lastReconcileAt: job.type === "user_reconcile" ? startedAt : status.lastReconcileAt,
      });
      broadcast(`✔ ${job.type} thành công.`, "success");
      return {
        ran: true,
        outcome: "success",
        jobType: job.type,
        username: job.username || null,
      };
    } finally {
      await releasePostSyncLock();
    }
  }

  function scheduleAlarms() {
    if (!PostSyncClient.isPostSyncLeader()) return;
    // Thức dậy mỗi 5 phút để enqueue + claim một job.
    chrome.alarms.create(LEADER_WAKE_ALARM, { periodInMinutes: 5, delayInMinutes: 1 });
  }

  function clearAlarms() {
    chrome.alarms.clear(LEADER_WAKE_ALARM).catch(() => {});
    chrome.alarms.clear(FEED_SCHEDULE_ALARM).catch(() => {});
    chrome.alarms.clear(RECONCILE_SCHEDULE_ALARM).catch(() => {});
  }

  async function checkSessionQuiet() {
    // Chỉ gọi khi admin mở panel — background job dùng HTTP 401/403 để phát hiện.
    try {
      const res = await fetch("https://techhub.fpt.net/api/v1/accounts/profile", {
        method: "GET",
        credentials: "include",
      });
      const ok = res.ok;
      await savePostSyncStatus({
        sessionRequired: !(ok && (res.status === 200)),
        sessionCheckedAt: new Date().toISOString(),
        lastHttpStatus: res.status,
      });
      if (ok) {
        // Mở lại các job session_required bằng cách request due_users.
        await PostSyncClient.requestPostSync("due_users").catch(() => null);
      }
      return { ok };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async function enqueueScheduledJobs(options = {}) {
    // Đẩy feed discovery mỗi 60 phút + reconcile user tới hạn. Edge function sẽ tự
    // deduplicate theo type+status+payload nên gọi lặp là an toàn.
    if (!PostSyncClient.isPostSyncConfigured()) return { enqueued: 0 };
    const status = await getPostSyncStatus();
    const now = Date.now();
    const results = [];
    // Feed mỗi 60 phút (feed_discovery).
    const feedEvery = 60 * 60 * 1000;
    if (options.force || !status.lastFeedAt || now - new Date(status.lastFeedAt).getTime() >= feedEvery) {
      try {
        const r = await PostSyncClient.requestPostSync("feed", { communitySlug: "cai-tien-moi-ngay" });
        results.push({ kind: "feed", ok: true, ...r });
        await savePostSyncStatus({ lastFeedAt: new Date().toISOString() });
      } catch (error) {
        results.push({ kind: "feed", ok: false, error: error.message });
      }
    }
    // Reconcile các user tới hạn (edge function tự tính toán).
    try {
      const r = await PostSyncClient.requestPostSync("due_users");
      results.push({ kind: "due_users", ok: true, ...r });
    } catch (error) {
      results.push({ kind: "due_users", ok: false, error: error.message });
    }
    return { enqueued: results.filter((r) => r.ok).length, results };
  }

  async function claimAndRunOneJob() {
    return runLeaderCycle({ manual: false });
  }

  async function bootstrap() {
    // Được gọi khi service worker khởi động. Không bắt lỗi ra ngoài — chỉ log.
    try {
      if (!PostSyncClient.isPostSyncConfigured()) return { ok: false, reason: "not_configured" };
      if (!PostSyncClient.isPostSyncLeader()) {
        clearAlarms();
        return { ok: true, leader: false };
      }
      // Service worker mới không thể còn giữ tác vụ của instance cũ; dọn lock
      // lưu dở để leader không phải chờ hết TTL 15 phút sau khi reload extension.
      workerRunning = false;
      await chrome.storage.local.remove(POST_SYNC_LOCK_KEY);
      scheduleAlarms();
      // Đăng ký leader device với backend qua 1 lượt enqueue + claim để backend ghi nhận.
      await enqueueScheduledJobs().catch(() => null);
      const run = await runLeaderCycle({ manual: true });
      return { ok: true, leader: true, run };
    } catch (error) {
      console.warn("[PostSync] bootstrap error:", error);
      return { ok: false, error: error.message };
    }
  }

  global.PostSyncWorker = {
    LEADER_WAKE_ALARM,
    FEED_SCHEDULE_ALARM,
    RECONCILE_SCHEDULE_ALARM,
    HINT_DEBOUNCE_MS,
    HARD_LIMITS,
    defaultStatus,
    getPostSyncStatus,
    savePostSyncStatus,
    getLeaderDeviceId,
    extractArticleIdentifierFromUrl,
    maybeSubmitHintFromUrl,
    runLeaderCycle,
    enqueueScheduledJobs,
    claimAndRunOneJob,
    bootstrap,
    scheduleAlarms,
    clearAlarms,
    checkSessionQuiet,
  };
})(typeof window !== "undefined" ? window : globalThis);
