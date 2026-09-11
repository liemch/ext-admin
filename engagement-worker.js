// engagement-worker.js — Thực thi tương tác chéo giữa các user.
//
// Hai chế độ (xem PLAN_CROSS_USER_ENGAGEMENT.md):
//   - Queue (M2+): ENGAGEMENT_API_CONFIG.url được cấu hình → heartbeat rồi
//     claim đúng 1 task mỗi lần, thực thi bằng phiên TechHub local, báo kết
//     quả về server (complete/fail). Lease + idempotency key chống trùng.
//   - Legacy (M1): chưa cấu hình queue → tự chọn bài như trước nhưng đã làm
//     chắc: vote/comment tách riêng, vote idempotent, không nuốt lỗi ghi,
//     khóa chống chạy chồng, interval/quota/delay đưa vào settings.
//
// Chế độ chạy im lặng (mục 8): background KHÔNG notification, KHÔNG tự mở
// tab, KHÔNG badge/toast. Chỉ ghi trạng thái vào chrome.storage.local và
// broadcast (panel mở mới nhận được). Hết phiên → dừng im lặng, gắn cờ
// sessionRequired; chỉ khi user mở panel mới kiểm tra session và hiện banner.

(function (global) {
  "use strict";

  const ENGAGEMENT_SETTINGS_KEY = "engagementSettings";
  const ENGAGEMENT_STATUS_KEY = "engagementStatus";
  const ENGAGEMENT_LOCK_KEY = "engagementLock";
  const ENGAGEMENT_PENDING_KEY = "engagementPendingOp";
  const LEGACY_ENABLED_KEY = "crossInteractionEnabled";
  const LEGACY_LAST_TIME_KEY = "lastAutoInteractionTime";

  const LOCK_TTL_MS = 10 * 60 * 1000;
  const MAX_COMMENT_LENGTH = 2000;

  const DEFAULT_SETTINGS = {
    enabled: true,
    intervalMinutes: 15,
    tasksPerWake: 1,
    delayBetweenTasksSec: 5,
    legacyMaxPosts: 3,
    legacyDelaySec: 5,
    dailyCapPosts: 3,
  };

  let engagementRunning = false;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function todayVnKey() {
    const now = new Date(Date.now() + 7 * 3600 * 1000);
    return now.toISOString().slice(0, 10);
  }

  function clampInt(value, fallback, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(num)));
  }

  // ------------------------------------------------------------------ settings

  async function getEngagementSettings() {
    const stored = await chrome.storage.local.get([
      ENGAGEMENT_SETTINGS_KEY,
      LEGACY_ENABLED_KEY,
    ]);
    const saved =
      stored[ENGAGEMENT_SETTINGS_KEY] && typeof stored[ENGAGEMENT_SETTINGS_KEY] === "object"
        ? stored[ENGAGEMENT_SETTINGS_KEY]
        : {};
    const settings = {
      // Participation is controlled globally by admin. Every installed user
      // keeps its local alarm enabled so it can observe the server-side state.
      enabled: true,
      intervalMinutes: clampInt(saved.intervalMinutes, DEFAULT_SETTINGS.intervalMinutes, 1, 1440),
      tasksPerWake: clampInt(saved.tasksPerWake, DEFAULT_SETTINGS.tasksPerWake, 1, 10),
      delayBetweenTasksSec: clampInt(
        saved.delayBetweenTasksSec,
        DEFAULT_SETTINGS.delayBetweenTasksSec,
        1,
        600
      ),
      legacyMaxPosts: clampInt(saved.legacyMaxPosts, DEFAULT_SETTINGS.legacyMaxPosts, 1, 20),
      legacyDelaySec: clampInt(saved.legacyDelaySec, DEFAULT_SETTINGS.legacyDelaySec, 1, 600),
      dailyCapPosts: clampInt(saved.dailyCapPosts, DEFAULT_SETTINGS.dailyCapPosts, 1, 50),
    };
    // Remove any old local opt-out during migration to admin-controlled mode.
    if (saved.enabled !== true || stored[LEGACY_ENABLED_KEY] !== true) {
      await chrome.storage.local.set({
        [ENGAGEMENT_SETTINGS_KEY]: { ...saved, enabled: true },
        [LEGACY_ENABLED_KEY]: true,
      });
    }
    return settings;
  }

  async function saveEngagementSettings(patch = {}) {
    const current = await getEngagementSettings();
    const next = {
      ...current,
      enabled: true,
      intervalMinutes:
        patch.intervalMinutes !== undefined
          ? clampInt(patch.intervalMinutes, current.intervalMinutes, 1, 1440)
          : current.intervalMinutes,
      tasksPerWake:
        patch.tasksPerWake !== undefined
          ? clampInt(patch.tasksPerWake, current.tasksPerWake, 1, 10)
          : current.tasksPerWake,
      delayBetweenTasksSec:
        patch.delayBetweenTasksSec !== undefined
          ? clampInt(patch.delayBetweenTasksSec, current.delayBetweenTasksSec, 1, 600)
          : current.delayBetweenTasksSec,
      legacyMaxPosts:
        patch.legacyMaxPosts !== undefined
          ? clampInt(patch.legacyMaxPosts, current.legacyMaxPosts, 1, 20)
          : current.legacyMaxPosts,
      legacyDelaySec:
        patch.legacyDelaySec !== undefined
          ? clampInt(patch.legacyDelaySec, current.legacyDelaySec, 1, 600)
          : current.legacyDelaySec,
      dailyCapPosts:
        patch.dailyCapPosts !== undefined
          ? clampInt(patch.dailyCapPosts, current.dailyCapPosts, 1, 50)
          : current.dailyCapPosts,
      updatedAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({
      [ENGAGEMENT_SETTINGS_KEY]: next,
      // Giữ đồng bộ cờ legacy cho các đoạn mã còn đọc key cũ.
      [LEGACY_ENABLED_KEY]: next.enabled,
    });
    if (typeof syncCrossInteractionAlarm === "function") {
      await syncCrossInteractionAlarm().catch(() => {});
    }
    return next;
  }

  function defaultStatus() {
    return {
      lastRunAt: null,
      lastOutcome: "idle",
      lastMessage: null,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      pendingCount: null,
      lastError: null,
      lastHttpStatus: null,
      sessionRequired: false,
      sessionCheckedAt: null,
      actorUsername: null,
      queueMode: false,
      killSwitch: false,
      dailyDate: todayVnKey(),
      dailyPosts: 0,
    };
  }

  async function getEngagementStatus() {
    const stored = await chrome.storage.local.get(ENGAGEMENT_STATUS_KEY);
    const status = { ...defaultStatus(), ...(stored[ENGAGEMENT_STATUS_KEY] || {}) };
    if (status.dailyDate !== todayVnKey()) {
      status.dailyDate = todayVnKey();
      status.dailyPosts = 0;
    }
    return status;
  }

  async function saveEngagementStatus(patch = {}) {
    const current = await getEngagementStatus();
    const next = { ...current, ...patch };
    await chrome.storage.local.set({ [ENGAGEMENT_STATUS_KEY]: next });
    return next;
  }

  // ------------------------------------------------------------------ lock

  async function acquireEngagementLock(owner) {
    const stored = await chrome.storage.local.get(ENGAGEMENT_LOCK_KEY);
    const lock = stored[ENGAGEMENT_LOCK_KEY];
    const now = Date.now();
    if (engagementRunning) return false;
    if (lock?.lockedAt && now - lock.lockedAt < LOCK_TTL_MS) {
      return false;
    }
    await chrome.storage.local.set({
      [ENGAGEMENT_LOCK_KEY]: { lockedAt: now, owner: owner || "worker" },
    });
    engagementRunning = true;
    return true;
  }

  async function releaseEngagementLock() {
    engagementRunning = false;
    await chrome.storage.local.remove(ENGAGEMENT_LOCK_KEY).catch(() => {});
  }

  function broadcast(message, type = "info") {
    try {
      if (typeof broadcastProgress === "function") {
        broadcastProgress(message, type);
        return;
      }
    } catch (_) {
      // broadcastProgress có thể chưa load — fallback bên dưới.
    }
    chrome.runtime
      .sendMessage({ action: "interactProgress", message, type })
      .catch(() => {});
  }

  // ------------------------------------------------------- phân quyền user

  async function ensureEngagementUserAllowed() {
    const stored = await chrome.storage.local.get("userProfile");
    const username = stored.userProfile?.username;
    if (!username) {
      throw new Error("Không tìm thấy phiên TechHub. Mở TechHub và đăng nhập trước.");
    }
    const user = await supabase.findUserByUsername(username);
    if (!user) {
      throw new Error("Tài khoản chưa được đăng ký trong hệ thống.");
    }
    if (user.is_locked) {
      throw new Error("Tài khoản đã bị khóa khỏi extension.");
    }
    return user;
  }

  // ------------------------------------------------------- kiểm tra phiên
  //
  // CHỈ gọi khi user chủ động mở panel (hoặc bấm chạy tay). Background job
  // không gọi hàm này — session hết hạn được phát hiện qua HTTP 401/403.

  async function checkTechHubSession() {
    let httpStatus = null;
    try {
      const response = await fetch("https://techhub.fpt.net/api/v1/accounts/profile", {
        method: "GET",
        credentials: "include",
      });
      httpStatus = response.status;
      if (response.ok) {
        const profile = await response.json().catch(() => null);
        const username =
          profile?.username || profile?.data?.username || profile?.user?.username || null;
        await saveEngagementStatus({
          sessionRequired: false,
          sessionCheckedAt: new Date().toISOString(),
          lastError: null,
          lastHttpStatus: 200,
        });
        // Mở lại các task đang chờ phiên (queue mode).
        try {
          if (
            typeof EngagementClient !== "undefined" &&
            EngagementClient.isEngagementQueueConfigured()
          ) {
            await EngagementClient.engagementClearSessionRequired().catch(() => null);
          }
        } catch (_) {
          // Không chặn UI vì lỗi dọn task chờ.
        }
        return { ok: true, httpStatus: 200, username };
      }
      if (httpStatus === 401 || httpStatus === 403) {
        await saveEngagementStatus({
          sessionRequired: true,
          sessionCheckedAt: new Date().toISOString(),
          lastHttpStatus: httpStatus,
          lastError: "Phiên TechHub đã hết hạn.",
        });
        return { ok: false, httpStatus, sessionRequired: true };
      }
      return { ok: false, httpStatus };
    } catch (error) {
      return { ok: false, httpStatus, error: error.message };
    }
  }

  // ------------------------------------------------------- đọc trạng thái vote
  //
  // TechHub có thể đổi shape article detail — kiểm tra phòng thủ nhiều field,
  // chỉ kết luận "đã vote" khi có bằng chứng rõ ràng thuộc về phiên hiện tại.

  function parseReactionState(detail) {
    if (!detail || typeof detail !== "object") {
      return { known: false, upvoted: false };
    }
    const truthyCategory = (value) => {
      if (value === true) return true;
      const text = String(value ?? "").toLowerCase();
      return text === "upvote" || text === "upvoted" || text === "like" || text === "liked";
    };
    const directCandidates = [
      detail.current_user_reaction,
      detail.my_reaction,
      detail.user_reaction,
      detail.viewer_reaction,
      detail.reaction,
    ];
    for (const candidate of directCandidates) {
      if (candidate == null || candidate === false || candidate === "") continue;
      if (typeof candidate === "object") {
        const category =
          candidate.category || candidate.type || candidate.name || candidate.reaction;
        if (truthyCategory(category)) return { known: true, upvoted: true };
        if (candidate.upvoted === true || candidate.voted === true || candidate.liked === true) {
          return { known: true, upvoted: true };
        }
        continue;
      }
      if (truthyCategory(candidate)) return { known: true, upvoted: true };
    }
    const boolCandidates = [
      detail.is_upvoted,
      detail.upvoted,
      detail.has_upvoted,
      detail.viewer_has_upvoted,
      detail.voted,
      detail.is_liked,
      detail.liked,
      detail.has_liked,
    ];
    for (const candidate of boolCandidates) {
      if (candidate === true) return { known: true, upvoted: true };
    }
    // Mảng reactions: chỉ tin khi item upvote gắn cờ thuộc về mình.
    const lists = [detail.reactions, detail.reaction_list, detail.reaction_counts];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const category = String(
          item.category || item.type || item.name || ""
        ).toLowerCase();
        if (!category.includes("upvote") && !category.includes("like")) continue;
        if (
          item.voted === true ||
          item.reacted === true ||
          item.selected === true ||
          item.mine === true ||
          item.by_me === true ||
          item.current_user === true
        ) {
          return { known: true, upvoted: true };
        }
      }
    }
    // Có field dạng count nhưng không gắn cờ cá nhân → không kết luận được.
    return { known: false, upvoted: false };
  }

  function parseCreatedCommentId(payload, headers) {
    try {
      const rawId =
        payload?.id ??
        payload?.comment_id ??
        payload?.comment?.id ??
        payload?.data?.id ??
        null;
      const id = Number(rawId);
      if (Number.isInteger(id) && id > 0) return id;
    } catch (_) {
      // Fallback Location header bên dưới.
    }
    try {
      const location = headers?.get ? headers.get("Location") || "" : "";
      const match = String(location).match(/\/comments\/(\d+)\/?$/i);
      if (match) return Number(match[1]);
    } catch (_) {
      // Bỏ qua.
    }
    return null;
  }

  function normalizeCommentText(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^\p{L}\p{N} ]/gu, "")
      .trim();
  }

  function looksLikePlaceholder(content) {
    const text = String(content || "");
    if (!text.trim()) return true;
    if (/\{\{[^}]*\}\}/.test(text)) return true;
    if (/【[^】]*】/.test(text)) return true;
    if (/<\s*(nhập|nhap|placeholder|content|nội dung|noi dung)[^>]*>/i.test(text)) {
      return true;
    }
    if (/\b(TODO|FIXME|LOREM|XXX+)\b/i.test(text)) return true;
    return false;
  }

  function jaccardSimilarity(a, b) {
    const setA = new Set(normalizeCommentText(a).split(" ").filter(Boolean));
    const setB = new Set(normalizeCommentText(b).split(" ").filter(Boolean));
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    for (const token of setA) {
      if (setB.has(token)) intersection += 1;
    }
    return intersection / Math.max(setA.size, setB.size);
  }

  // ------------------------------------------------------- vote idempotent
  //
  // Kết quả chuẩn hóa: { ok, outcome, httpStatus, detail, error, permanent }
  // outcome: succeeded | already_done | failed | skipped

  async function performVoteTask(target, credentials) {
    const techhubId = Number(target?.techhubId);
    if (!Number.isInteger(techhubId) || techhubId <= 0) {
      return { ok: false, outcome: "failed", error: "Thiếu techhub_id.", permanent: true };
    }
    // 1. Đọc trạng thái reaction hiện tại (nếu có UUID).
    if (target?.techhubUuid && typeof fetchArticleDetail === "function") {
      try {
        const detail = await fetchArticleDetail(target.techhubUuid, credentials);
        const state = parseReactionState(detail);
        if (state.known && state.upvoted) {
          return {
            ok: true,
            outcome: "already_done",
            httpStatus: 200,
            detail: "already_upvoted",
          };
        }
      } catch (error) {
        // fetchArticleDetail ném Error thường kèm "HTTP 401" trong message.
        const status =
          error?.httpStatus ||
          Number(String(error?.message || "").match(/HTTP\s+(\d{3})/)?.[1]) ||
          null;
        if (status === 401 || status === 403) {
          return {
            ok: false,
            outcome: "failed",
            httpStatus: status,
            error: `Hết phiên khi đọc bài (HTTP ${status}).`,
            sessionRequired: true,
          };
        }
        // Không đọc được detail thì vẫn thử toggle + kiểm tra kết quả.
      }
    }
    // 2. Toggle + xác minh trạng thái cuối là upvote.
    try {
      const first = await interactWithTechHub(
        { techhub_id: techhubId },
        "like",
        null,
        credentials
      );
      if (!first) {
        return { ok: false, outcome: "failed", httpStatus: 0, error: "Không nhận được phản hồi vote." };
      }
      if (!first.ok) {
        return {
          ok: false,
          outcome: "failed",
          httpStatus: first.status,
          error: `Vote HTTP ${first.status}.`,
          sessionRequired: first.status === 401 || first.status === 403,
          permanent: [400, 404, 410, 422].includes(first.status),
        };
      }
      const data = await first.json().catch(() => ({}));
      if (data && data.result === "destroy") {
        // Toggle đã biến vote thành unvote → gọi lại một lần để vote.
        const second = await interactWithTechHub(
          { techhub_id: techhubId },
          "like",
          null,
          credentials
        );
        if (!second?.ok) {
          return {
            ok: false,
            outcome: "failed",
            httpStatus: second?.status ?? 0,
            error: `Vote lại HTTP ${second?.status ?? "unknown"} sau khi lỡ unvote.`,
            sessionRequired: second?.status === 401 || second?.status === 403,
          };
        }
        const secondData = await second.json().catch(() => ({}));
        if (secondData && secondData.result === "destroy") {
          return {
            ok: false,
            outcome: "failed",
            error: "Toggle vote không ổn định (2 lần đều destroy).",
          };
        }
        return { ok: true, outcome: "succeeded", httpStatus: 200, detail: "revoted_after_destroy" };
      }
      return { ok: true, outcome: "succeeded", httpStatus: 200, detail: data?.result || "voted" };
    } catch (error) {
      return { ok: false, outcome: "failed", httpStatus: 0, error: error.message };
    }
  }

  // ------------------------------------------------------- comment

  async function fetchRecentCommentTexts(techhubUuid, credentials, limit = 20) {
    if (!techhubUuid || typeof fetchArticleComments !== "function") return [];
    try {
      const page = await fetchArticleComments(techhubUuid, credentials, {
        sort: "new",
        page: 1,
      });
      const flat =
        typeof flattenComments === "function"
          ? flattenComments(page.comments || [])
          : page.comments || [];
      return flat.slice(0, limit).map((comment) => ({
        id: comment?.id ?? null,
        parentId:
          typeof getCommentParentId === "function"
            ? getCommentParentId(comment)
            : null,
        author:
          typeof getCommentAuthorUsername === "function"
            ? getCommentAuthorUsername(comment)
            : comment?.user?.username || null,
        body:
          typeof getCommentBody === "function"
            ? getCommentBody(comment)
            : comment?.body || "",
      }));
    } catch (_) {
      return [];
    }
  }

  function pickTemplateContent(templates, recentTexts, actorUsername) {
    const ownNormalized = new Set(
      recentTexts
        .filter((item) => item.author === actorUsername)
        .map((item) => normalizeCommentText(item.body))
        .filter(Boolean)
    );
    const candidates = (templates || []).filter(
      (template) =>
        template?.content &&
        !looksLikePlaceholder(template.content) &&
        !ownNormalized.has(normalizeCommentText(template.content))
    );
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)].content.trim();
  }

  async function generateCommentContent(target, credentials, actorUsername, options = {}) {
    const recent = await fetchRecentCommentTexts(target.techhubUuid, credentials, 20);
    // AI (nếu campaign yêu cầu và đã cấu hình NVIDIA).
    if (options.aiAssist && typeof nvidiaGenerateExternalDiscussion === "function") {
      try {
        const cfg =
          typeof getNvidiaConfig === "function" ? getNvidiaConfig() : {};
        const usable =
          (cfg.mode === "proxy" && cfg.proxyUrl && cfg.proxyToken) ||
          (cfg.mode !== "proxy" && cfg.apiKey && cfg.apiKey !== "YOUR_NVIDIA_API_KEY");
        if (usable && target.techhubUuid && typeof fetchArticleDetail === "function") {
          const detail = await fetchArticleDetail(target.techhubUuid, credentials);
          const previousBodies = recent
            .map((item) => item.body)
            .filter(Boolean)
            .slice(0, 5);
          const body = await nvidiaGenerateExternalDiscussion({
            postTitle: target.postTitle || detail?.title || `Bài #${target.techhubId}`,
            postAuthor: target.targetUsername || detail?.username || "tác giả",
            articleBody: detail?.body || "",
            previousBodies,
            discussionNumber: previousBodies.length + 1,
            discussionTarget: previousBodies.length + 1,
            username: actorUsername,
          });
          if (body && !looksLikePlaceholder(body)) {
            return { content: String(body).trim(), recent };
          }
        }
      } catch (error) {
        console.warn("[Engagement] AI gen comment thất bại, dùng template:", error.message);
      }
    }
    const templates = await supabase.getCommentTemplates({ kind: "comment" });
    if (!templates.length) {
      throw new Error("Không tìm thấy mẫu bình luận đang hoạt động.");
    }
    const content = pickTemplateContent(templates, recent, actorUsername);
    if (!content) {
      throw new Error("Mọi template đều trùng comment đã đăng của bạn trên bài này.");
    }
    return { content, recent };
  }

  async function performCommentTask(target, credentials, actorUsername, options = {}) {
    const techhubId = Number(target?.techhubId);
    if (!Number.isInteger(techhubId) || techhubId <= 0) {
      return { ok: false, outcome: "failed", error: "Thiếu techhub_id.", permanent: true };
    }
    // Nội dung server đã chốt (thread turn / retry) được dùng lại nguyên văn.
    let content = String(options.content || "").trim();
    let recent = [];
    if (!content) {
      try {
        const generated = await generateCommentContent(target, credentials, actorUsername, {
          aiAssist: options.aiAssist === true,
        });
        content = generated.content;
        recent = generated.recent;
      } catch (error) {
        return { ok: false, outcome: "failed", error: error.message, permanent: /template|trùng/i.test(error.message) };
      }
    } else {
      recent = await fetchRecentCommentTexts(target.techhubUuid, credentials, 20);
    }
    if (!content) {
      return { ok: false, outcome: "failed", error: "Nội dung comment rỗng.", permanent: true };
    }
    if (content.length > MAX_COMMENT_LENGTH) {
      return {
        ok: false,
        outcome: "failed",
        error: `Comment quá dài (>${MAX_COMMENT_LENGTH} ký tự).`,
        permanent: true,
        content,
      };
    }
    if (looksLikePlaceholder(content)) {
      return {
        ok: false,
        outcome: "failed",
        error: "Comment chứa placeholder, từ chối đăng.",
        permanent: true,
        content,
      };
    }
    // Không đăng trùng comment trước của chính actor trên cùng bài.
    // Trả kèm comment ID thật để server nối chuỗi thảo luận đúng.
    const normalized = normalizeCommentText(content);
    const ownDuplicate = recent.find(
      (item) => item.author === actorUsername && normalizeCommentText(item.body) === normalized
    );
    if (ownDuplicate) {
      return {
        ok: true,
        outcome: "already_done",
        httpStatus: 200,
        detail: "duplicate_of_own_comment",
        commentId: Number(ownDuplicate.id) || null,
        content,
      };
    }
    // Tránh đăng nội dung gần như giống hệt comment gần nhất.
    const tooSimilar = recent.some((item) => jaccardSimilarity(content, item.body) >= 0.95);
    if (tooSimilar && !options.content) {
      // Chỉ tự đổi nội dung khi worker tự gen; nội dung server chốt thì vẫn đăng.
      try {
        const retry = await generateCommentContent(target, credentials, actorUsername, {
          aiAssist: false,
        });
        if (jaccardSimilarity(retry.content, content) < 0.95) {
          content = retry.content;
        }
      } catch (_) {
        // Giữ nội dung cũ và đăng.
      }
    }

    // Ghi pending op để restart giữa chừng không đăng trùng (perform đã check
    // trùng trước POST nên lần chạy lại sẽ rơi vào already_done).
    const pendingOp = {
      opId: `${techhubId}:comment:${Date.now()}`,
      techhubId,
      type: "comment",
      content,
      startedAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({ [ENGAGEMENT_PENDING_KEY]: pendingOp });
    try {
      const response = await interactWithTechHub(
        { techhub_id: techhubId },
        "comment",
        content,
        credentials
      );
      if (!response) {
        return { ok: false, outcome: "failed", httpStatus: 0, error: "Không nhận được phản hồi comment.", content };
      }
      if (!response.ok) {
        return {
          ok: false,
          outcome: "failed",
          httpStatus: response.status,
          error: `Comment HTTP ${response.status}.`,
          sessionRequired: response.status === 401 || response.status === 403,
          permanent: [400, 404, 410, 422].includes(response.status),
          content,
        };
      }
      const payload = await response.clone().json().catch(() => null);
      let commentId = parseCreatedCommentId(payload, response.headers);
      if (!commentId) {
        // TechHub không trả ID: tìm lại comment vừa đăng theo nội dung.
        commentId = await findOwnPostedCommentId(
          target.techhubUuid, credentials, actorUsername, content, null
        );
      }
      return {
        ok: true,
        outcome: "succeeded",
        httpStatus: 200,
        commentId,
        content,
      };
    } catch (error) {
      return { ok: false, outcome: "failed", httpStatus: 0, error: error.message, content };
    } finally {
      await chrome.storage.local.remove(ENGAGEMENT_PENDING_KEY).catch(() => {});
    }
  }

  // Tìm ID comment vừa đăng (khi POST thành công nhưng không parse được ID):
  // comment mới nhất của actor trùng nội dung (và cùng cha nếu là reply).
  async function findOwnPostedCommentId(techhubUuid, credentials, actorUsername, content, parentId) {
    try {
      const recent = await fetchRecentCommentTexts(techhubUuid, credentials, 10);
      const normalized = normalizeCommentText(content);
      const match = recent.find(
        (item) =>
          item.author === actorUsername &&
          normalizeCommentText(item.body) === normalized &&
          (parentId == null || Number(item.parentId) === Number(parentId))
      );
      const id = Number(match?.id);
      return Number.isInteger(id) && id > 0 ? id : null;
    } catch (_) {
      return null;
    }
  }

  // ------------------------------------------------------- reply

  async function performReplyTask(target, credentials, actorUsername, options = {}) {
    const techhubId = Number(target?.techhubId);
    const parentId = Number(target?.parentTechhubCommentId);
    if (!Number.isInteger(techhubId) || techhubId <= 0) {
      return { ok: false, outcome: "failed", error: "Thiếu techhub_id.", permanent: true };
    }
    if (!Number.isInteger(parentId) || parentId <= 0) {
      return {
        ok: false,
        outcome: "failed",
        error: "Thiếu comment cha (turn trước chưa có TechHub comment ID).",
        permanent: true,
      };
    }
    const content = String(options.content || "").trim();
    if (!content) {
      return {
        ok: false,
        outcome: "failed",
        error: "Reply thiếu nội dung (task chưa được gán kịch bản).",
        permanent: true,
      };
    }
    if (content.length > MAX_COMMENT_LENGTH || looksLikePlaceholder(content)) {
      return {
        ok: false,
        outcome: "failed",
        error: "Nội dung reply không hợp lệ.",
        permanent: true,
        content,
      };
    }
    // Idempotent: đã reply cùng nội dung dưới cùng comment cha thì không đăng nữa.
    try {
      const recent = await fetchRecentCommentTexts(target.techhubUuid, credentials, 20);
      const normalized = normalizeCommentText(content);
      const ownReply = recent.find(
        (item) =>
          item.author === actorUsername &&
          Number(item.parentId) === parentId &&
          normalizeCommentText(item.body) === normalized
      );
      if (ownReply) {
        return {
          ok: true,
          outcome: "already_done",
          httpStatus: 200,
          detail: "duplicate_of_own_reply",
          commentId: Number(ownReply.id) || null,
          content,
        };
      }
    } catch (_) {
      // Không đọc được comment thì vẫn thử đăng (server dedup theo turn).
    }
    const pendingOp = {
      opId: `${techhubId}:reply:${parentId}:${Date.now()}`,
      techhubId,
      type: "reply",
      parentId,
      content,
      startedAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({ [ENGAGEMENT_PENDING_KEY]: pendingOp });
    try {
      const response = await interactWithTechHub(
        { techhub_id: techhubId },
        "reply",
        content,
        credentials,
        undefined,
        { parentCommentId: parentId }
      );
      if (!response) {
        return { ok: false, outcome: "failed", httpStatus: 0, error: "Không nhận được phản hồi reply.", content };
      }
      if (!response.ok) {
        return {
          ok: false,
          outcome: "failed",
          httpStatus: response.status,
          error: `Reply HTTP ${response.status}.`,
          sessionRequired: response.status === 401 || response.status === 403,
          // Comment nguồn bị xóa/bài đóng → vĩnh viễn.
          permanent: [400, 404, 410, 422].includes(response.status),
          content,
        };
      }
      const payload = await response.clone().json().catch(() => null);
      let commentId = parseCreatedCommentId(payload, response.headers);
      if (!commentId) {
        commentId = await findOwnPostedCommentId(
          target.techhubUuid, credentials, actorUsername, content, parentId
        );
      }
      return { ok: true, outcome: "succeeded", httpStatus: 200, commentId, content };
    } catch (error) {
      return { ok: false, outcome: "failed", httpStatus: 0, error: error.message, content };
    } finally {
      await chrome.storage.local.remove(ENGAGEMENT_PENDING_KEY).catch(() => {});
    }
  }

  // ------------------------------------------------------- thực thi 1 task queue

  async function executeQueueTask(task, credentials, username) {
    const base = {
      techhubId: task.techhubId,
      techhubUuid: task.techhubUuid,
      postTitle: task.postTitle,
      targetUsername: task.targetUsername,
      parentTechhubCommentId: task.parentTechhubCommentId,
    };
    if (task.action === "vote") {
      return performVoteTask(base, credentials);
    }
    if (task.action === "comment") {
      return performCommentTask(base, credentials, username, {
        content: task.content,
        aiAssist: task.aiAssist === true,
      });
    }
    if (task.action === "reply") {
      return performReplyTask(base, credentials, username, { content: task.content });
    }
    return { ok: false, outcome: "failed", error: `Action lạ: ${task.action}.`, permanent: true };
  }

  async function readLocalSession() {
    const stored = await chrome.storage.local.get(["techhubCredentials", "userProfile"]);
    return {
      credentials: stored.techhubCredentials || null,
      username: stored.userProfile?.username || null,
    };
  }

  async function refreshCsrfQuietly(credentials) {
    try {
      if (typeof refreshCSRFToken !== "function") return credentials;
      const fresh = await refreshCSRFToken();
      if (fresh && fresh !== credentials.csrfToken) {
        const next = { ...credentials, csrfToken: fresh };
        await chrome.storage.local.set({ techhubCredentials: next });
        return next;
      }
    } catch (_) {
      // Giữ token cũ.
    }
    return credentials;
  }

  // ------------------------------------------------------- chu kỳ queue (M2)

  async function runQueueCycle(settings, status, manual) {
    const startedAt = new Date().toISOString();
    const { credentials: storedCreds, username } = await readLocalSession();
    if (!storedCreds?.csrfToken || !username) {
      await saveEngagementStatus({
        sessionRequired: true,
        lastRunAt: startedAt,
        lastOutcome: "session_required",
        lastMessage: "Thiếu phiên TechHub. Mở extension để đăng nhập lại.",
        lastError: "Thiếu phiên đăng nhập hoặc profile TechHub.",
        queueMode: true,
      });
      return { ran: false, sessionRequired: true };
    }

    // Đổi tài khoản → trả claim cũ trước khi heartbeat actor mới.
    if (status.actorUsername && status.actorUsername !== username) {
      try {
        await EngagementClient.engagementReleaseMyClaims();
      } catch (_) {
        // Server cũng tự xử lý khi heartbeat báo username mới.
      }
      broadcast(
        `Đã đổi tài khoản @${status.actorUsername} → @${username}. Nhận task cho tài khoản mới.`,
        "info"
      );
    }

    const credentials = await refreshCsrfQuietly(storedCreds);

    let heartbeat;
    try {
      heartbeat = await EngagementClient.engagementHeartbeat(username);
    } catch (error) {
      await saveEngagementStatus({
        lastRunAt: startedAt,
        lastOutcome: "error",
        lastMessage: `Không kết nối được hàng đợi: ${error.message}`,
        lastError: error.message,
        lastHttpStatus: error.httpStatus || null,
        actorUsername: username,
        queueMode: true,
      });
      broadcast(`Hàng đợi tương tác lỗi: ${error.message}`, "error");
      return { ran: false, error: error.message };
    }

    if (heartbeat?.killSwitch === true) {
      await saveEngagementStatus({
        lastRunAt: startedAt,
        lastOutcome: "paused",
        lastMessage: "Hệ thống đang tạm dừng (kill switch).",
        killSwitch: true,
        actorUsername: username,
        queueMode: true,
      });
      return { ran: false, killSwitch: true };
    }

    let succeeded = 0;
    let failed = 0;
    let lastTaskLabel = null;
    let stoppedForSession = false;

    for (let i = 0; i < settings.tasksPerWake; i++) {
      if (i > 0) {
        await delay(settings.delayBetweenTasksSec * 1000 + Math.random() * 2000);
      }
      let claim;
      try {
        claim = await EngagementClient.engagementClaimTask();
      } catch (error) {
        await saveEngagementStatus({
          lastError: `Claim task thất bại: ${error.message}`,
          lastHttpStatus: error.httpStatus || null,
        });
        broadcast(`Claim task thất bại: ${error.message}`, "error");
        break;
      }
      if (!claim?.task) break;
      const task = claim.task;
      lastTaskLabel = `#${task.techhubId} ${task.action}`;
      broadcast(
        `Đang thực hiện ${task.action} bài #${task.techhubId}${task.postTitle ? ` (${task.postTitle.slice(0, 60)})` : ""}…`,
        "info"
      );
      const result = await executeQueueTask(task, credentials, username);
      if (result.sessionRequired) {
        try {
          await EngagementClient.engagementFailTask(task.id, {
            error: result.error || "TechHub 401/403",
            httpStatus: result.httpStatus || 401,
            content: result.content || task.content || null,
          });
        } catch (_) {
          // Task giữ lease sẽ tự về queue; cờ local vẫn đảm bảo dừng im lặng.
        }
        stoppedForSession = true;
        failed += 1;
        break;
      }
      if (result.ok) {
        try {
          await EngagementClient.engagementCompleteTask(task.id, {
            techhubResultId: result.commentId || null,
            content: result.content || task.content || null,
            httpStatus: result.httpStatus || 200,
            resultDetail: result.outcome === "already_done"
              ? { alreadyDone: true, detail: result.detail }
              : { detail: result.detail || null },
          });
          succeeded += 1;
          broadcast(
            result.outcome === "already_done"
              ? `Đã ${task.action} bài #${task.techhubId} từ trước, bỏ qua.`
              : `Đã ${task.action} bài #${task.techhubId}.`,
            "success"
          );
        } catch (error) {
          failed += 1;
          broadcast(`Báo kết quả thất bại (task #${task.id}): ${error.message}`, "error");
        }
      } else {
        failed += 1;
        try {
          await EngagementClient.engagementFailTask(task.id, {
            error: result.error || "unknown_error",
            httpStatus: result.httpStatus ?? null,
            content: result.content || task.content || null,
            permanent: result.permanent === true,
          });
        } catch (error) {
          broadcast(`Báo lỗi thất bại (task #${task.id}): ${error.message}`, "error");
        }
        broadcast(
          `${task.action} bài #${task.techhubId} lỗi: ${result.error || "unknown"}`,
          "error"
        );
      }
    }

    // Đếm daily theo số task thành công trong chu kỳ này.
    const freshStatus = await getEngagementStatus();
    await saveEngagementStatus({
      lastRunAt: startedAt,
      lastOutcome: stoppedForSession
        ? "session_required"
        : failed > 0 && succeeded === 0
          ? "error"
          : succeeded > 0
            ? "success"
            : "idle",
      lastMessage:
        stoppedForSession
          ? "Phiên TechHub đã hết hạn. Đăng nhập lại để tiếp tục."
          : succeeded + failed === 0
            ? "Không có task nào tới hạn."
            : `Xong ${succeeded} task, lỗi ${failed} task${lastTaskLabel ? ` (gần nhất ${lastTaskLabel})` : ""}.`,
      succeeded: freshStatus.succeeded + succeeded,
      failed: freshStatus.failed + failed,
      sessionRequired: stoppedForSession ? true : freshStatus.sessionRequired,
      lastError: stoppedForSession ? "Phiên TechHub đã hết hạn." : null,
      actorUsername: username,
      queueMode: true,
      killSwitch: false,
      pendingCount: heartbeat?.pendingCount ?? freshStatus.pendingCount,
      dailyPosts: freshStatus.dailyPosts + succeeded,
    });
    await chrome.storage.local.set({ [LEGACY_LAST_TIME_KEY]: Date.now() });
    return { ran: true, succeeded, failed, stoppedForSession };
  }

  // ------------------------------------------------------- chu kỳ legacy (M1)

  async function runLegacyCycle(settings, status, manual) {
    const startedAt = new Date().toISOString();
    const { credentials: storedCreds, username } = await readLocalSession();
    if (!storedCreds?.csrfToken || !username) {
      await saveEngagementStatus({
        sessionRequired: true,
        lastRunAt: startedAt,
        lastOutcome: "session_required",
        lastMessage: "Thiếu phiên TechHub. Mở extension để đăng nhập lại.",
        lastError: "Thiếu phiên đăng nhập hoặc profile TechHub.",
        queueMode: false,
      });
      return { ran: false, sessionRequired: true };
    }
    if (status.dailyPosts >= settings.dailyCapPosts) {
      await saveEngagementStatus({
        lastRunAt: startedAt,
        lastOutcome: "capped",
        lastMessage: `Đã chạm giới hạn ${settings.dailyCapPosts} bài/ngày.`,
        queueMode: false,
      });
      return { ran: false, capped: true };
    }
    const credentials = await refreshCsrfQuietly(storedCreds);

    const remaining = Math.max(
      0,
      Math.min(settings.legacyMaxPosts, settings.dailyCapPosts - status.dailyPosts)
    );
    if (remaining <= 0) {
      return { ran: false, capped: true };
    }
    let posts = [];
    try {
      posts = await supabase.getUninteractedPosts(username, remaining);
    } catch (error) {
      await saveEngagementStatus({
        lastRunAt: startedAt,
        lastOutcome: "error",
        lastMessage: `Không tải được bài: ${error.message}`,
        lastError: error.message,
        actorUsername: username,
        queueMode: false,
      });
      broadcast(`Lỗi tải bài tương tác: ${error.message}`, "error");
      return { ran: false, error: error.message };
    }
    if (!posts.length) {
      await saveEngagementStatus({
        lastRunAt: startedAt,
        lastOutcome: "idle",
        lastMessage: "Không có bài viết mới nào cần tương tác.",
        actorUsername: username,
        queueMode: false,
      });
      broadcast("Không có bài viết mới nào cần tương tác.", "info");
      return { ran: true, succeeded: 0, failed: 0 };
    }

    let succeeded = 0;
    let failed = 0;
    let stoppedForSession = false;
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      if (i > 0) {
        broadcast(
          `Đang chờ ${settings.legacyDelaySec}s trước khi tương tác bài tiếp theo...`,
          "info"
        );
        await delay(settings.legacyDelaySec * 1000);
      }
      if (!post.techhub_uuid) continue;
      broadcast(`Đang xử lý: ${post.title}`, "info");
      const target = {
        techhubId: post.techhub_id,
        techhubUuid: post.techhub_uuid,
        postTitle: post.title,
        targetUsername: post.username,
      };
      // Comment và vote là hai lượt riêng để lỗi một lượt không chặn lượt kia.
      const commentResult = await performCommentTask(target, credentials, username, {});
      if (commentResult.sessionRequired) {
        stoppedForSession = true;
        failed += 1;
        break;
      }
      if (commentResult.ok) {
        try {
          await supabase.recordInteraction(username, post.techhub_id, "comment");
        } catch (error) {
          // Đã đăng thành công nhưng chưa lưu lịch sử → báo rõ, không nuốt lỗi.
          broadcast(
            `Đã comment nhưng chưa lưu được lịch sử bài #${post.techhub_id}: ${error.message}`,
            "error"
          );
        }
        broadcast(`- Đã bình luận: ${post.title}`, "success");
      } else {
        failed += 1;
        broadcast(`- Lỗi bình luận ${post.title}: ${commentResult.error}`, "error");
      }

      const voteResult = await performVoteTask(target, credentials);
      if (voteResult.sessionRequired) {
        stoppedForSession = true;
        failed += 1;
        break;
      }
      if (voteResult.ok) {
        try {
          await supabase.recordInteraction(username, post.techhub_id, "like");
        } catch (error) {
          broadcast(
            `Đã vote nhưng chưa lưu được lịch sử bài #${post.techhub_id}: ${error.message}`,
            "error"
          );
        }
        broadcast(
          voteResult.outcome === "already_done"
            ? `- Đã vote từ trước: ${post.title}`
            : `- Đã thích: ${post.title}`,
          "success"
        );
      } else {
        failed += 1;
        broadcast(`- Lỗi thích bài ${post.title}: ${voteResult.error}`, "error");
      }
      if (commentResult.ok || voteResult.ok) succeeded += 1;
    }

    const freshStatus = await getEngagementStatus();
    await saveEngagementStatus({
      lastRunAt: startedAt,
      lastOutcome: stoppedForSession ? "session_required" : failed > 0 && succeeded === 0 ? "error" : "success",
      lastMessage: stoppedForSession
        ? "Phiên TechHub đã hết hạn. Đăng nhập lại để tiếp tục."
        : `Hoàn tất tương tác chéo (legacy): ${succeeded} bài ok, ${failed} lượt lỗi.`,
      succeeded: freshStatus.succeeded + succeeded,
      failed: freshStatus.failed + failed,
      sessionRequired: stoppedForSession ? true : freshStatus.sessionRequired,
      lastError: stoppedForSession ? "Phiên TechHub đã hết hạn." : null,
      actorUsername: username,
      queueMode: false,
      dailyPosts: freshStatus.dailyPosts + succeeded,
    });
    await chrome.storage.local.set({ [LEGACY_LAST_TIME_KEY]: Date.now() });
    broadcast(
      stoppedForSession
        ? "Phiên TechHub đã hết hạn. Đăng nhập lại để tiếp tục."
        : "Hoàn tất tương tác chéo.",
      stoppedForSession ? "error" : "success"
    );
    return { ran: true, succeeded, failed, stoppedForSession };
  }

  // ------------------------------------------------------- entry point

  async function runEngagementCycle(options = {}) {
    const manual = options.manual === true;
    const settings = await getEngagementSettings();
    if (!manual && !settings.enabled) {
      return { ran: false, skipped: true, reason: "disabled" };
    }
    const status = await getEngagementStatus();
    // Hết phiên → background dừng im lặng, chờ user mở panel đăng nhập lại.
    if (!manual && status.sessionRequired) {
      return { ran: false, skipped: true, reason: "session_required" };
    }
    const locked = await acquireEngagementLock(manual ? "manual" : "alarm");
    if (!locked) {
      return { ran: false, skipped: true, reason: "locked" };
    }
    try {
      const queueConfigured =
        typeof EngagementClient !== "undefined" &&
        EngagementClient.isEngagementQueueConfigured();
      if (queueConfigured) {
        return await runQueueCycle(settings, status, manual);
      }
      return await runLegacyCycle(settings, status, manual);
    } finally {
      await releaseEngagementLock();
    }
  }

  global.EngagementWorker = {
    ENGAGEMENT_SETTINGS_KEY,
    ENGAGEMENT_STATUS_KEY,
    DEFAULT_SETTINGS,
    MAX_COMMENT_LENGTH,
    getEngagementSettings,
    saveEngagementSettings,
    getEngagementStatus,
    saveEngagementStatus,
    ensureEngagementUserAllowed,
    checkTechHubSession,
    parseReactionState,
    normalizeCommentText,
    looksLikePlaceholder,
    jaccardSimilarity,
    parseCreatedCommentId,
    performVoteTask,
    performCommentTask,
    performReplyTask,
    runEngagementCycle,
    runQueueCycle,
    runLegacyCycle,
  };
})(typeof window !== "undefined" ? window : globalThis);
