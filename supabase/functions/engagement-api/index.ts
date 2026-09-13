// Supabase Edge Function: engagement-api
//
// Điều phối tương tác giữa các user (cross-user engagement).
// Extension giữ cookie/CSRF TechHub nên vẫn là nơi THỰC THI; function này giữ
// hàng đợi + lease + campaign + kịch bản thảo luận (xem PLAN_CROSS_USER_ENGAGEMENT.md).
//
// Deploy:
//   supabase functions deploy engagement-api --no-verify-jwt
//   supabase secrets set ADMIN_TOKEN=<dùng-chung-với-admin-api>
//
// Phân quyền:
//   - Authorization: Bearer <ADMIN_TOKEN>  → admin (plan/pause/cancel/import/ops)
//   - Authorization: Bearer <device-token> → actor (heartbeat/claim/complete/fail/status)
//     Device token do extension tự sinh theo máy, server chỉ lưu SHA-256 hash
//     trong engagement_devices để khóa/thu hồi từng máy.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Giới hạn tốc độ toàn hệ thống (theo isolate — đủ chặn lạm dụng nhẹ,
// không phải chống DDoS). Tính theo caller để một máy lỗi không chặn cả hệ.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = Number(Deno.env.get("ENGAGEMENT_RATE_LIMIT") || 120);
const rateHits: { at: number; key: string }[] = [];

function isRateLimited(callerKey: string): boolean {
  const now = Date.now();
  while (rateHits.length && now - rateHits[0].at > RATE_LIMIT_WINDOW_MS) {
    rateHits.shift();
  }
  const count = rateHits.filter((hit) => hit.key === callerKey).length;
  if (count >= RATE_LIMIT_MAX) return true;
  rateHits.push({ at: now, key: callerKey });
  return false;
}

// Đầu ngày theo giờ Việt Nam (UTC+7) — khớp cách đếm "hôm nay" của extension
function startOfTodayVnIso() {
  const offsetMs = 7 * 3600 * 1000;
  const shifted = new Date(Date.now() + offsetMs);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - offsetMs).toISOString();
}

async function sha256Hex(text: string): Promise<string> {
  const data = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(data)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Giải mã HTML entity như &#x20; &#39; &amp; (giữ đồng bộ với discussion-import.js) */
function decodeHtmlEntities(text: string): string {
  return String(text || "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : _m;
    })
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : _m;
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

type Rest = {
  get: (table: string, params?: Record<string, string>) => Promise<Response>;
  getJson: <T = unknown[]>(
    table: string,
    params?: Record<string, string>
  ) => Promise<T>;
  post: (
    table: string,
    payload: unknown,
    extraPrefer?: string
  ) => Promise<Response>;
  postJson: <T = Record<string, unknown>>(
    table: string,
    payload: unknown,
    extraPrefer?: string
  ) => Promise<T>;
  patch: (
    table: string,
    params: Record<string, string>,
    payload: unknown
  ) => Promise<Response>;
  patchJson: <T = Record<string, unknown>[]>(
    table: string,
    params: Record<string, string>,
    payload: unknown
  ) => Promise<T>;
  del: (
    table: string,
    params: Record<string, string>
  ) => Promise<Response>;
  rpc: <T = unknown>(fn: string, payload: unknown) => Promise<T>;
};

function createRest(supabaseUrl: string, serviceRoleKey: string): Rest {
  const base = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1`;
  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  const buildUrl = (table: string, params?: Record<string, string>) => {
    const url = new URL(`${base}/${table}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  };

  async function throwIfError(res: Response, what: string): Promise<void> {
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${what}: HTTP ${res.status} ${text.slice(0, 300)}`);
    }
  }

  return {
    get: (table, params) =>
      fetch(buildUrl(table, params), { headers }),
    getJson: async (table, params) => {
      const res = await fetch(buildUrl(table, params), { headers });
      await throwIfError(res, `Đọc ${table} thất bại`);
      return (await res.json()) as never;
    },
    post: (table, payload, extraPrefer) =>
      fetch(buildUrl(table), {
        method: "POST",
        headers: extraPrefer
          ? { ...headers, Prefer: `${headers.Prefer},${extraPrefer}` }
          : headers,
        body: JSON.stringify(payload),
      }),
    postJson: async (table, payload, extraPrefer) => {
      const res = await fetch(buildUrl(table), {
        method: "POST",
        headers: extraPrefer
          ? { ...headers, Prefer: `${headers.Prefer},${extraPrefer}` }
          : headers,
        body: JSON.stringify(payload),
      });
      await throwIfError(res, `Ghi ${table} thất bại`);
      return (await res.json()) as never;
    },
    patch: (table, params, payload) =>
      fetch(buildUrl(table, params), {
        method: "PATCH",
        headers,
        body: JSON.stringify(payload),
      }),
    patchJson: async (table, params, payload) => {
      const res = await fetch(buildUrl(table, params), {
        method: "PATCH",
        headers,
        body: JSON.stringify(payload),
      });
      await throwIfError(res, `Cập nhật ${table} thất bại`);
      return (await res.json()) as never;
    },
    del: (table, params) =>
      fetch(buildUrl(table, params), { method: "DELETE", headers }),
    rpc: async (fn, payload) => {
      const res = await fetch(`${base}/rpc/${fn}`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      await throwIfError(res, `Gọi ${fn} thất bại`);
      return (await res.json()) as never;
    },
  };
}

type Device = {
  id: number;
  device_id: string;
  username: string;
  token_hash: string;
  label: string | null;
  last_seen_at: string | null;
  revoked: boolean;
};

type EngagementPreferences = {
  username: string;
  enabled: boolean;
  receive_post_limit: number;
  discussions_per_post: number;
  repeat_interval_minutes: number;
  daily_contribution_cap: number;
  contribution_points: number;
  ultra_credits: number;
  created_at?: string;
  updated_at?: string;
};

type Auth =
  | { kind: "admin" }
  | { kind: "device"; device: Device; tokenHash: string }
  | { kind: "none" };

async function resolveAuth(
  req: Request,
  rest: Rest,
  body: Record<string, unknown>
): Promise<Auth> {
  const adminToken = Deno.env.get("ADMIN_TOKEN");
  const header = req.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : "";

  if (adminToken && token && token === adminToken) {
    return { kind: "admin" };
  }
  if (!token) return { kind: "none" };

  const tokenHash = await sha256Hex(token);
  const rows = await rest.getJson<Device[]>("engagement_devices", {
    token_hash: `eq.${tokenHash}`,
    select: "*",
    limit: "1",
  });
  const device = rows?.[0];
  if (!device) {
    // Token lạ: cho phép heartbeat tự đăng ký máy mới (bootstrap),
    // các action khác yêu cầu thiết bị đã đăng ký.
    const action = String(body.action || "");
    if (action === "heartbeat") {
      return { kind: "none" };
    }
    return { kind: "none" };
  }
  if (device.revoked) {
    throw new HttpError("Thiết bị đã bị thu hồi. Liên hệ quản trị viên.", 403);
  }
  return { kind: "device", device, tokenHash };
}

class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function requireAdmin(auth: Auth): void {
  if (auth.kind !== "admin") {
    throw new HttpError("Unauthorized (cần ADMIN_TOKEN).", 401);
  }
}

function requireDevice(auth: Auth): { device: Device; tokenHash: string } {
  if (auth.kind !== "device") {
    throw new HttpError("Unauthorized (thiếu device token).", 401);
  }
  return auth;
}

async function readSetting(rest: Rest, key: string): Promise<unknown> {
  const rows = await rest.getJson<Array<{ value: unknown }>>("settings", {
    key: `eq.${key}`,
    select: "value",
    limit: "1",
  });
  return rows?.[0]?.value;
}

async function isKillSwitchOn(rest: Rest): Promise<boolean> {
  const value = await readSetting(rest, "engagement_kill_switch");
  return value === true || value === "true" || value === 1 || value === "1";
}

async function isEngagementEnabled(rest: Rest): Promise<boolean> {
  const value = await readSetting(rest, "engagement_enabled");
  // Missing setting is enabled for backward compatibility and for new users.
  return value === undefined || value === null || value === true || value === "true" || value === 1 || value === "1";
}

function settingEnabled(value: unknown, fallback = true): boolean {
  if (value === undefined || value === null) return fallback;
  return value === true || value === "true" || value === 1 || value === "1";
}

function clampPreference(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

async function getOrCreatePreferences(
  rest: Rest,
  username: string
): Promise<EngagementPreferences> {
  const rows = await rest.getJson<EngagementPreferences[]>("engagement_preferences", {
    username: `eq.${username}`,
    select: "*",
    limit: "1",
  });
  const existing = firstRow(rows);
  if (existing) return existing;
  const [receivePostLimit, discussionsPerPost, repeatIntervalMinutes, dailyContributionCap] = await Promise.all([
    readSetting(rest, "engagement_pool_receive_post_limit"),
    readSetting(rest, "engagement_pool_discussions_per_post"),
    readSetting(rest, "engagement_pool_repeat_interval_minutes"),
    readSetting(rest, "engagement_pool_daily_contribution_cap"),
  ]);
  const defaults = {
    receive_post_limit: clampPreference(receivePostLimit, 3, 1, 10),
    discussions_per_post: clampPreference(discussionsPerPost, 40, 1, 50),
    repeat_interval_minutes: clampPreference(repeatIntervalMinutes, 45, 15, 1440),
    daily_contribution_cap: clampPreference(dailyContributionCap, 20, 1, 100),
  };
  const created = await rest.postJson<EngagementPreferences[]>(
    "engagement_preferences",
    {
      username,
      enabled: true,
      ...defaults,
    },
    "resolution=ignore-duplicates"
  );
  return firstRow(created) || {
    username,
    enabled: true,
    ...defaults,
    contribution_points: 0,
    ultra_credits: 0,
  };
}

function vnDayKey(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

async function reconcileRewards(rest: Rest, username: string): Promise<number> {
  const [tasks, events, thresholdValue] = await Promise.all([
    rest.getJson<Array<{ id: number }>>("engagement_tasks", {
      actor_username: `eq.${username}`,
      status: "eq.succeeded",
      select: "id",
      order: "completed_at.desc",
      limit: "1000",
    }),
    rest.getJson<Array<{ task_id: number }>>("engagement_reward_events", {
      username: `eq.${username}`,
      select: "task_id",
      order: "created_at.desc",
      limit: "1000",
    }),
    readSetting(rest, "engagement_ultra_threshold"),
  ]);
  const recorded = new Set((events || []).map((event) => Number(event.task_id)));
  const threshold = clampPreference(thresholdValue, 20, 1, 1000);
  let repaired = 0;
  for (const task of tasks || []) {
    if (recorded.has(Number(task.id))) continue;
    await rest.rpc("record_engagement_reward", {
      p_username: username,
      p_task_id: Number(task.id),
      p_threshold: threshold,
    });
    repaired += 1;
  }
  return repaired;
}

/**
 * Tự duy trì vote giữa các user online. Comment/reply không sinh nội dung rời:
 * admin nhập kịch bản 2–3 turn để queueDiscussionTurn mở đúng chuỗi ancestry.
 * Idempotency key theo ngày ngăn heartbeat tạo trùng.
 */
async function ensureMutualPoolTasks(rest: Rest): Promise<{
  participants: number;
  posts: number;
  created: number;
  waitingForPeers: boolean;
}> {
  const poolEnabled = settingEnabled(await readSetting(rest, "engagement_pool_enabled"), true);
  if (!poolEnabled || !(await isEngagementEnabled(rest)) || await isKillSwitchOn(rest)) {
    return { participants: 0, posts: 0, created: 0, waitingForPeers: false };
  }
  const offlineMinutes = clampPreference(
    await readSetting(rest, "engagement_pool_offline_after_minutes"),
    30,
    5,
    1440
  );
  const globalCommentGapMinutes = clampPreference(
    await readSetting(rest, "engagement_pool_global_comment_gap_minutes"),
    5,
    1,
    120
  );
  const sinceIso = new Date(Date.now() - offlineMinutes * 60 * 1000).toISOString();
  const [devices, activeUsers] = await Promise.all([
    rest.getJson<Array<{ username: string }>>("engagement_devices", {
      revoked: "eq.false",
      last_seen_at: `gte.${sinceIso}`,
      select: "username",
      limit: "1000",
    }),
    rest.getJson<Array<{ username: string }>>("users", {
      is_locked: "eq.false",
      select: "username",
      limit: "10000",
    }),
  ]);
  const activeUserSet = new Set((activeUsers || []).map((row) => row.username).filter(Boolean));
  const onlineNames = [...new Set((devices || []).map((row) => row.username).filter(Boolean))];
  const memberOnlineNames = onlineNames.filter((name) => activeUserSet.has(name));
  if (memberOnlineNames.length === 0) {
    return { participants: 0, posts: 0, created: 0, waitingForPeers: true };
  }

  const prefRows = await rest.getJson<EngagementPreferences[]>("engagement_preferences", {
    username: `in.(${memberOnlineNames.join(",")})`,
    select: "*",
    limit: "1000",
  });
  const prefByUser = new Map((prefRows || []).map((pref) => [pref.username, pref]));
  for (const username of memberOnlineNames) {
    if (!prefByUser.has(username)) {
      prefByUser.set(username, await getOrCreatePreferences(rest, username));
    }
  }
  const onlineParticipants = memberOnlineNames.filter(
    (name) => prefByUser.get(name)?.enabled !== false
  );

  const [posts, activeBoosts] = await Promise.all([
    rest.getJson<PostRow[]>("posts", {
      status: "eq.open",
      verification_status: "eq.verified",
      last_verified_at: "not.is.null",
      select: "techhub_id,techhub_uuid,username,title,status,published_at,created_at,community_slug,verification_status,last_verified_at",
      order: "created_at.desc",
      limit: "500",
    }),
    rest.getJson<Array<{ techhub_id: number; requested_discussions: number }>>(
      "engagement_boost_requests",
      {
        status: "eq.active",
        expires_at: `gt.${new Date().toISOString()}`,
        select: "techhub_id,requested_discussions",
        order: "created_at.desc",
        limit: "500",
      }
    ),
  ]);
  const boostByPost = new Map<number, number>();
  for (const boost of activeBoosts || []) {
    boostByPost.set(
      Number(boost.techhub_id),
      Math.max(boostByPost.get(Number(boost.techhub_id)) || 0, Number(boost.requested_discussions) || 0)
    );
  }
  const verifiedPostOwners = new Set(
    (posts || []).map((post) => post.username).filter(Boolean) as string[]
  );
  // Pool chỉ dành cho thành viên còn trong users, đang online/được bật và đã có
  // ít nhất một bài open + verified trong posts. Một người không tạo thành pool.
  const participants = onlineParticipants.filter((name) => verifiedPostOwners.has(name));
  if (participants.length < 2) {
    return {
      participants: participants.length,
      posts: 0,
      created: 0,
      waitingForPeers: true,
    };
  }
  const selectedPosts: PostRow[] = [];
  const perOwner = new Map<string, number>();
  const participantSet = new Set(participants);
  const orderedPosts = [...(posts || [])]
    .filter((post) => !!post.username && participantSet.has(post.username))
    .sort((a, b) => {
      const boosted = Number(boostByPost.has(b.techhub_id)) - Number(boostByPost.has(a.techhub_id));
      if (boosted !== 0) return boosted;
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });
  const participantPostBudget = participants.reduce(
    (sum, username) => sum + (prefByUser.get(username)?.receive_post_limit ?? 3),
    0
  );
  for (const post of orderedPosts) {
    if (!post.username || !post.techhub_uuid) continue;
    const limit = prefByUser.get(post.username)?.receive_post_limit ?? 3;
    const count = perOwner.get(post.username) || 0;
    if (count >= limit) continue;
    selectedPosts.push(post);
    perOwner.set(post.username, count + 1);
    if (selectedPosts.length >= participantPostBudget) break;
  }

  const day = vnDayKey();
  const [existingPoolTasks, todayTasks] = await Promise.all([
    rest.getJson<TaskRow[]>("engagement_tasks", {
      idempotency_key: `like.pool:${day}:*`,
      status: "in.(pending,claimed,succeeded)",
      select: "idempotency_key",
      limit: "10000",
    }),
    rest.getJson<TaskRow[]>("engagement_tasks", {
      created_at: `gte.${startOfTodayVnIso()}`,
      status: "neq.cancelled",
      select: "actor_username",
      limit: "10000",
    }),
  ]);
  const existingKeys = new Set((existingPoolTasks || []).map((task) => task.idempotency_key));
  const actorCounts = new Map<string, number>();
  for (const task of todayTasks || []) {
    actorCounts.set(task.actor_username, (actorCounts.get(task.actor_username) || 0) + 1);
  }
  const toInsert: Record<string, unknown>[] = [];
  let sequence = 0;
  const scheduleAt = (extraMinutes = 0) => {
    sequence += 1;
    return new Date(
      Date.now() + (sequence * globalCommentGapMinutes + extraMinutes) * 60 * 1000 + Math.random() * 3 * 60 * 1000
    ).toISOString();
  };
  const reserveActor = (candidates: string[]): string | null => {
    const ordered = shuffle(candidates).sort(
      (a, b) => (actorCounts.get(a) || 0) - (actorCounts.get(b) || 0)
    );
    for (const actor of ordered) {
      const cap = prefByUser.get(actor)?.daily_contribution_cap ?? 6;
      if ((actorCounts.get(actor) || 0) < cap) return actor;
    }
    return null;
  };

  for (const post of selectedPosts) {
    if (!post.username) continue;
    const candidates = participants.filter((actor) => actor !== post.username);
    if (!candidates.length) continue;
    const voteActor = reserveActor(candidates);
    if (voteActor) {
      const key = `pool:${day}:${post.techhub_id}:vote`;
      if (!existingKeys.has(key)) {
        toInsert.push({
          actor_username: voteActor,
          target_username: post.username,
          techhub_id: post.techhub_id,
          techhub_uuid: post.techhub_uuid,
          action: "vote",
          status: "pending",
          scheduled_at: scheduleAt(),
          max_attempts: 5,
          idempotency_key: key,
        });
        existingKeys.add(key);
        actorCounts.set(voteActor, (actorCounts.get(voteActor) || 0) + 1);
      }
    }
  }

  let created = 0;
  for (let i = 0; i < toInsert.length; i += 100) {
    const response = await rest.post(
      "engagement_tasks",
      toInsert.slice(i, i + 100),
      "resolution=ignore-duplicates"
    );
    if (!response.ok) throw new HttpError(`Không tạo được pool task (HTTP ${response.status}).`, 500);
    const rows = await response.json().catch(() => []);
    created += Array.isArray(rows) ? rows.length : 0;
  }
  if (created > 0) {
    await logEvent(rest, {
      event: "pool_refilled",
      detail: { participants: participants.length, posts: selectedPosts.length, created, day },
    });
  }
  return {
    participants: participants.length,
    posts: selectedPosts.length,
    created,
    waitingForPeers: participants.length < 2,
  };
}

async function logEvent(
  rest: Rest,
  event: {
    task_id?: number | null;
    campaign_id?: number | null;
    thread_id?: number | null;
    actor_username?: string | null;
    event: string;
    http_status?: number | null;
    detail?: unknown;
  }
): Promise<void> {
  try {
    await rest.post("engagement_events", {
      task_id: event.task_id ?? null,
      campaign_id: event.campaign_id ?? null,
      thread_id: event.thread_id ?? null,
      actor_username: event.actor_username ?? null,
      event: event.event,
      http_status: event.http_status ?? null,
      detail: event.detail ?? null,
    });
  } catch (error) {
    console.error("[engagement-api] logEvent failed:", error);
  }
}

function firstRow<T>(rows: T[] | T | null): T | null {
  if (!rows) return null;
  return Array.isArray(rows) ? rows[0] ?? null : rows;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function randomMinutes(min: number, max: number): number {
  const lo = Math.max(0, Number(min) || 0);
  const hi = Math.max(lo, Number(max) || 0);
  return lo + Math.random() * (hi - lo);
}

// ---------------------------------------------------------------------------
// Validate + chuẩn hóa kịch bản JSON (giữ đồng bộ với discussion-import.js)
// ---------------------------------------------------------------------------

type NormalizedTurn = { actor: string; content: string };
type NormalizedThread = {
  name: string;
  actors: { A: string; B: string };
  turns: NormalizedTurn[];
  targetTechhubId: number | null;
  visitor: string | null;
};

function parseThreadIndex(raw: unknown, index: number): NormalizedThread {
  const label = `thread[${index}]`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(`${label}: mỗi phần tử phải là object.`, 400);
  }
  const obj = raw as Record<string, unknown>;

  // Format cũ: { discussion, answer }
  if ("discussion" in obj || "answer" in obj) {
    const discussion = decodeHtmlEntities(String(obj.discussion ?? "")).trim();
    const answer = decodeHtmlEntities(String(obj.answer ?? "")).trim();
    if (!discussion) throw new HttpError(`${label}: discussion rỗng.`, 400);
    if (!answer) throw new HttpError(`${label}: answer rỗng.`, 400);
    if (discussion.length > 2000 || answer.length > 2000) {
      throw new HttpError(`${label}: nội dung quá dài (>2000 ký tự).`, 400);
    }
    return {
      name: decodeHtmlEntities(String(obj.name ?? `thread-${index + 1}`)).trim() ||
        `thread-${index + 1}`,
      actors: { A: "visitor", B: "author" },
      turns: [
        { actor: "A", content: discussion },
        { actor: "B", content: answer },
      ],
      targetTechhubId: toPositiveInt(obj.targetTechhubId ?? obj.techhubId),
      visitor: toUsername(obj.visitor ?? obj.visitorUsername),
    };
  }

  const turnsRaw = obj.turns;
  if (!Array.isArray(turnsRaw)) {
    throw new HttpError(
      `${label}: thiếu mảng turns (hoặc dùng format cũ discussion/answer).`,
      400
    );
  }
  if (turnsRaw.length < 2 || turnsRaw.length > 3) {
    throw new HttpError(
      `${label}: số turn phải là 2 hoặc 3 (nhận ${turnsRaw.length}).`,
      400
    );
  }
  const turns: NormalizedTurn[] = turnsRaw.map((turn, turnIdx) => {
    const turnLabel = `${label}.turns[${turnIdx}]`;
    if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
      throw new HttpError(`${turnLabel}: mỗi turn phải là object.`, 400);
    }
    const actor = String(
      (turn as Record<string, unknown>).actor ?? ""
    ).trim().toUpperCase();
    if (actor !== "A" && actor !== "B") {
      throw new HttpError(
        `${turnLabel}: actor phải là "A" hoặc "B" (nhận "${actor}").`,
        400
      );
    }
    const expected = turnIdx % 2 === 0 ? "A" : "B";
    if (actor !== expected) {
      throw new HttpError(
        `${turnLabel}: turn ${turnIdx + 1} phải do ${expected} đăng (luân phiên A/B, bắt đầu bằng A).`,
        400
      );
    }
    const content = decodeHtmlEntities(
      String((turn as Record<string, unknown>).content ?? "")
    ).trim();
    if (!content) throw new HttpError(`${turnLabel}: content rỗng.`, 400);
    if (content.length > 2000) {
      throw new HttpError(`${turnLabel}: content quá dài (>2000 ký tự).`, 400);
    }
    return { actor, content };
  });

  const actorsRaw = (obj.actors as Record<string, unknown>) || {};
  const actorA = String(actorsRaw.A ?? "visitor").trim() || "visitor";
  const actorB = String(actorsRaw.B ?? "author").trim() || "author";
  if (!["visitor", "author"].includes(actorA.toLowerCase()) && !isUsername(actorA)) {
    throw new HttpError(`${label}: actors.A không hợp lệ ("${actorA}").`, 400);
  }
  if (!["visitor", "author"].includes(actorB.toLowerCase()) && !isUsername(actorB)) {
    throw new HttpError(`${label}: actors.B không hợp lệ ("${actorB}").`, 400);
  }

  return {
    name: decodeHtmlEntities(String(obj.name ?? `thread-${index + 1}`)).trim() ||
      `thread-${index + 1}`,
    actors: { A: actorA, B: actorB },
    turns,
    targetTechhubId: toPositiveInt(obj.targetTechhubId ?? obj.techhubId),
    visitor: toUsername(obj.visitor ?? obj.visitorUsername),
  };
}

function toPositiveInt(value: unknown): number | null {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function toUsername(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function isUsername(value: string): boolean {
  return /^[A-Za-z0-9_.-]{1,100}$/.test(value);
}

// ---------------------------------------------------------------------------
// Helpers nghiệp vụ
// ---------------------------------------------------------------------------

type PostRow = {
  techhub_id: number;
  techhub_uuid: string | null;
  username: string | null;
  title: string | null;
  status: string | null;
  published_at: string | null;
  last_verified_at: string | null;
  created_at: string | null;
  community_slug: string | null;
};

type TaskRow = {
  id: number;
  campaign_id: number | null;
  discussion_turn_id: number | null;
  actor_username: string;
  target_username: string | null;
  techhub_id: number;
  techhub_uuid: string | null;
  action: string;
  status: string;
  scheduled_at: string;
  claimed_at: string | null;
  claimed_by_device: string | null;
  lease_until: string | null;
  completed_at: string | null;
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  last_http_status: number | null;
  session_required: boolean;
  source_comment_id: number | null;
  parent_techhub_comment_id: number | null;
  content: string | null;
  techhub_result_id: number | null;
  result_detail: unknown;
  idempotency_key: string;
  created_at: string;
};

async function getPostByTechhubId(
  rest: Rest,
  techhubId: number
): Promise<PostRow | null> {
  const rows = await rest.getJson<PostRow[]>("posts", {
    techhub_id: `eq.${techhubId}`,
    select:
      "techhub_id,techhub_uuid,username,title,status,published_at,created_at,community_slug",
    limit: "1",
  });
  return firstRow(rows);
}

async function getLockedUsernames(rest: Rest): Promise<Set<string>> {
  const rows = await rest.getJson<Array<{ username: string }>>("users", {
    is_locked: "eq.true",
    select: "username",
    limit: "10000",
  });
  return new Set((rows || []).map((row) => row.username).filter(Boolean));
}

async function getUserByUsername(
  rest: Rest,
  username: string
): Promise<{ username: string; is_locked: boolean; is_admin: boolean } | null> {
  const rows = await rest.getJson<
    Array<{ username: string; is_locked: boolean; is_admin: boolean }>
  >("users", {
    username: `eq.${username}`,
    select: "username,is_locked,is_admin",
    limit: "1",
  });
  return firstRow(rows);
}

/** Tài khoản bị khóa giữa chừng: chặn heartbeat/claim ngay, tránh task chạy hộ. */
async function assertUserActive(rest: Rest, username: string): Promise<void> {
  const user = await getUserByUsername(rest, username);
  if (!user) {
    throw new HttpError(`Tài khoản @${username} chưa có trong hệ thống.`, 403);
  }
  if (user.is_locked) {
    throw new HttpError(`Tài khoản @${username} đã bị khóa.`, 403);
  }
}

async function maybeCompleteCampaign(rest: Rest, campaignId: number | null) {
  if (!campaignId) return;
  const open = await rest.getJson<Array<{ id: number }>>("engagement_tasks", {
    campaign_id: `eq.${campaignId}`,
    status: "in.(pending,claimed)",
    select: "id",
    limit: "1",
  });
  if (open && open.length > 0) return;
  const counts = await rest.getJson<TaskRow[]>("engagement_tasks", {
    campaign_id: `eq.${campaignId}`,
    select: "status",
    limit: "10000",
  });
  const stats: Record<string, number> = {};
  for (const row of counts || []) {
    stats[row.status] = (stats[row.status] || 0) + 1;
  }
  await rest.patch(
    "engagement_campaigns",
    { id: `eq.${campaignId}` },
    {
      status: "completed",
      ended_at: new Date().toISOString(),
      stats,
      updated_at: new Date().toISOString(),
    }
  );
  await logEvent(rest, {
    campaign_id: campaignId,
    event: "completed",
    detail: { stats },
  });
}

/** Mở turn kế tiếp sau khi một turn thành công (nối ancestry qua comment ID thật). */
async function advanceThreadAfterTurn(
  rest: Rest,
  threadId: number,
  finishedTurn: {
    id: number;
    turn_index: number;
    techhub_comment_id: number | null;
  }
): Promise<{ queuedTurnId: number | null; queuedTaskId: number | null; deferred: boolean }> {
  const threadRows = await rest.getJson<
    Array<{
      id: number;
      total_turns: number;
      status: string;
      techhub_id: number;
      techhub_uuid: string | null;
      campaign_id: number | null;
    }>
  >("discussion_threads", {
    id: `eq.${threadId}`,
    select: "id,total_turns,status,techhub_id,techhub_uuid,campaign_id",
    limit: "1",
  });
  const thread = firstRow(threadRows);
  if (!thread) return { queuedTurnId: null, queuedTaskId: null, deferred: false };

  const nextIndex = finishedTurn.turn_index + 1;
  if (nextIndex > thread.total_turns) {
    await rest.patch(
      "discussion_threads",
      { id: `eq.${threadId}` },
      {
        status: "completed",
        current_turn_index: finishedTurn.turn_index,
        updated_at: new Date().toISOString(),
      }
    );
    await logEvent(rest, {
      thread_id: threadId,
      campaign_id: thread.campaign_id,
      event: "completed",
      detail: { turns: thread.total_turns },
    });
    return { queuedTurnId: null, queuedTaskId: null, deferred: false };
  }

  const nextRows = await rest.getJson<
    Array<{
      id: number;
      turn_index: number;
      actor_key: string;
      actor_username: string;
      content: string;
      status: string;
    }>
  >("discussion_turns", {
    thread_id: `eq.${threadId}`,
    turn_index: `eq.${nextIndex}`,
    select: "id,turn_index,actor_key,actor_username,content,status",
    limit: "1",
  });
  const next = firstRow(nextRows);
  if (!next) return { queuedTurnId: null, queuedTaskId: null, deferred: false };
  if (!["pending", "failed", "blocked"].includes(next.status)) {
    return { queuedTurnId: null, queuedTaskId: null, deferred: false };
  }

  // Ghi ancestry của turn trước để reply nối đúng chuỗi.
  await rest.patch(
    "discussion_turns",
    { id: `eq.${next.id}` },
    {
      parent_techhub_comment_id: finishedTurn.techhub_comment_id,
      depends_on_turn_id: finishedTurn.id,
      updated_at: new Date().toISOString(),
    }
  );

  // Không phát turn kế tiếp nếu actor cần thiết đang offline:
  // turn giữ trạng thái pending và sẽ được heartbeat của actor đó xếp hàng.
  const OFFLINE_AFTER_MINUTES = 30;
  const sinceIso = new Date(
    Date.now() - OFFLINE_AFTER_MINUTES * 60 * 1000
  ).toISOString();
  const onlineRows = await rest.getJson<Array<{ id: number }>>(
    "engagement_devices",
    {
      username: `eq.${next.actor_username}`,
      revoked: "eq.false",
      last_seen_at: `gte.${sinceIso}`,
      select: "id",
      limit: "1",
    }
  );
  if (!onlineRows || onlineRows.length === 0) {
    await rest.patch(
      "discussion_threads",
      { id: `eq.${threadId}` },
      {
        status: "active",
        current_turn_index: nextIndex,
        updated_at: new Date().toISOString(),
      }
    );
    await logEvent(rest, {
      thread_id: threadId,
      campaign_id: thread.campaign_id,
      actor_username: next.actor_username,
      event: "deferred",
      detail: { turn: nextIndex, reason: "actor_offline" },
    });
    return { queuedTurnId: next.id, queuedTaskId: null, deferred: true };
  }

  const task = await queueDiscussionTurn(rest, thread, next, {
    parentTechhubCommentId: finishedTurn.techhub_comment_id,
    delayMinutes: randomMinutes(2, 8),
  });
  await rest.patch(
    "discussion_threads",
    { id: `eq.${threadId}` },
    {
      status: "active",
      current_turn_index: nextIndex,
      updated_at: new Date().toISOString(),
    }
  );
  return { queuedTurnId: next.id, queuedTaskId: task?.id ?? null, deferred: false };
}

async function queueDiscussionTurn(
  rest: Rest,
  thread: {
    id: number;
    techhub_id: number;
    techhub_uuid: string | null;
    campaign_id: number | null;
    author_username?: string | null;
  },
  turn: {
    id: number;
    turn_index: number;
    actor_username: string;
    content: string;
  },
  options: { parentTechhubCommentId?: number | null; delayMinutes?: number } = {}
): Promise<TaskRow | null> {
  const action = turn.turn_index === 1 ? "comment" : "reply";
  const scheduledAt = new Date(
    Date.now() + (options.delayMinutes ?? 1) * 60 * 1000
  ).toISOString();
  const created = await rest.postJson<TaskRow[]>(
    "engagement_tasks",
    {
      campaign_id: thread.campaign_id,
      discussion_turn_id: turn.id,
      actor_username: turn.actor_username,
      target_username: thread.author_username ?? null,
      techhub_id: thread.techhub_id,
      techhub_uuid: thread.techhub_uuid,
      action,
      status: "pending",
      scheduled_at: scheduledAt,
      max_attempts: 5,
      parent_techhub_comment_id:
        action === "reply" ? options.parentTechhubCommentId ?? null : null,
      content: turn.content,
      idempotency_key: `thread:${thread.id}:turn-${turn.turn_index}`,
    },
    "resolution=ignore-duplicates"
  );
  let task = firstRow(created);
  if (!task) {
    // Đã tồn tại (retry sau restart): lấy lại để nối turn.
    const existing = await rest.getJson<TaskRow[]>("engagement_tasks", {
      idempotency_key: `eq.thread:${thread.id}:turn-${turn.turn_index}`,
      select: "*",
      limit: "1",
    });
    task = firstRow(existing);
  }
  if (task) {
    await rest.patch(
      "discussion_turns",
      { id: `eq.${turn.id}` },
      {
        status: "queued",
        task_id: task.id,
        parent_techhub_comment_id:
          action === "reply"
            ? options.parentTechhubCommentId ?? null
            : null,
        updated_at: new Date().toISOString(),
      }
    );
    await logEvent(rest, {
      task_id: task.id,
      campaign_id: thread.campaign_id,
      thread_id: thread.id,
      actor_username: turn.actor_username,
      event: "queued",
      detail: { turn: turn.turn_index, action },
    });
  }
  return task;
}

/** Heartbeat tự xếp hàng các turn tới hạn của actor (turn trước đã có comment ID). */
async function queueDueDiscussionTurns(
  rest: Rest,
  actorUsername: string
): Promise<number> {
  const pendingTurns = await rest.getJson<
    Array<{
      id: number;
      thread_id: number;
      turn_index: number;
      actor_username: string;
      content: string;
      status: string;
      depends_on_turn_id: number | null;
      parent_techhub_comment_id: number | null;
      task_id: number | null;
    }>
  >("discussion_turns", {
    actor_username: `eq.${actorUsername}`,
    status: "eq.pending",
    select:
      "id,thread_id,turn_index,actor_username,content,status,depends_on_turn_id,parent_techhub_comment_id,task_id",
    order: "updated_at.asc",
    limit: "10",
  });
  if (!pendingTurns || pendingTurns.length === 0) return 0;

  let queued = 0;
  for (const turn of pendingTurns) {
    // Bỏ qua turn đầu chưa được import đúng (turn 1 luôn có task khi import).
    if (turn.turn_index === 1) continue;
    // Turn đã có task mở thì không tạo thêm.
    if (turn.task_id) {
      const tasks = await rest.getJson<TaskRow[]>("engagement_tasks", {
        id: `eq.${turn.task_id}`,
        select: "id,status",
        limit: "1",
      });
      const existing = firstRow(tasks);
      if (existing && ["pending", "claimed"].includes(existing.status)) continue;
    }
    // Turn trước phải thành công và có comment ID.
    if (!turn.depends_on_turn_id) continue;
    const prevRows = await rest.getJson<
      Array<{ status: string; techhub_comment_id: number | null }>
    >("discussion_turns", {
      id: `eq.${turn.depends_on_turn_id}`,
      select: "status,techhub_comment_id",
      limit: "1",
    });
    const prev = firstRow(prevRows);
    if (!prev || prev.status !== "succeeded" || !prev.techhub_comment_id) continue;

    const threadRows = await rest.getJson<
      Array<{
        id: number;
        techhub_id: number;
        techhub_uuid: string | null;
        campaign_id: number | null;
        author_username: string;
        status: string;
      }>
    >("discussion_threads", {
      id: `eq.${turn.thread_id}`,
      select: "id,techhub_id,techhub_uuid,campaign_id,author_username,status",
      limit: "1",
    });
    const thread = firstRow(threadRows);
    if (!thread || !["active", "pending"].includes(thread.status)) continue;

    await queueDiscussionTurn(rest, thread, turn, {
      parentTechhubCommentId: prev.techhub_comment_id,
      delayMinutes: randomMinutes(1, 5),
    });
    queued += 1;
  }
  return queued;
}

function backoffMinutes(attemptCount: number): number {
  const exp = Math.min(6, Math.max(1, attemptCount));
  const base = Math.min(120, 2 * Math.pow(2, exp - 1));
  return base + Math.random() * 5;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleHeartbeat(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>,
  token: string
) {
  const username = String(body.username || "").trim();
  const deviceId = String(body.deviceId || body.device_id || "").trim();
  const label = String(body.label || "").trim().slice(0, 120) || null;
  const nowIso = new Date().toISOString();

  let device: Device | null =
    auth.kind === "device" ? auth.device : null;

  if (!device) {
    // Đăng ký máy mới: cần username + deviceId + token mới.
    if (!token) throw new HttpError("Thiếu device token.", 401);
    if (!username || !isUsername(username)) {
      throw new HttpError("Thiếu username hợp lệ để đăng ký thiết bị.", 400);
    }
    if (!deviceId) throw new HttpError("Thiếu deviceId.", 400);
    const user = await getUserByUsername(rest, username);
    if (!user) throw new HttpError(`Tài khoản @${username} chưa có trong hệ thống.`, 403);
    if (user.is_locked) {
      throw new HttpError(`Tài khoản @${username} đã bị khóa.`, 403);
    }
    const tokenHash = await sha256Hex(token);
    const created = await rest.postJson<Device[]>(
      "engagement_devices",
      {
        device_id: deviceId,
        username,
        token_hash: tokenHash,
        label,
        last_seen_at: nowIso,
        revoked: false,
      },
      "resolution=ignore-duplicates"
    );
    device = firstRow(created);
    if (!device) {
      // Trùng (username, device_id) nhưng token khác: thay token mới, thu hồi ngầm token cũ.
      const existing = await rest.getJson<Device[]>("engagement_devices", {
        username: `eq.${username}`,
        device_id: `eq.${deviceId}`,
        select: "*",
        limit: "1",
      });
      const row = firstRow(existing);
      if (!row) throw new HttpError("Không đăng ký được thiết bị.", 500);
      const updated = await rest.patchJson<Device[]>(
        "engagement_devices",
        { id: `eq.${row.id}` },
        { token_hash: tokenHash, label, last_seen_at: nowIso, revoked: false, updated_at: nowIso }
      );
      device = firstRow(updated) || row;
    }
  } else {
    // Thiết bị cũ: kiểm tra tài khoản còn hoạt động không (có thể bị khóa sau
    // khi đăng ký). Đổi tài khoản thì nhánh dưới kiểm tra tài khoản mới.
    if (!username || username === device.username) {
      await assertUserActive(rest, device.username);
    }
    // Đổi tài khoản TechHub trên cùng máy: trả claim cũ, nhận actor mới.
    if (username && username !== device.username) {
      if (!isUsername(username)) throw new HttpError("Username mới không hợp lệ.", 400);
      const user = await getUserByUsername(rest, username);
      if (!user) throw new HttpError(`Tài khoản @${username} chưa có trong hệ thống.`, 403);
      if (user.is_locked) throw new HttpError(`Tài khoản @${username} đã bị khóa.`, 403);
      // Giải phóng claim treo của actor cũ trên máy này.
      await rest.rpc("release_actor_claims", {
        p_actor: device.username,
        p_device_id: device.device_id,
        p_now: nowIso,
      }).catch(() => 0);
      // Tránh vi phạm unique (username, device_id): xóa dòng trùng cũ nếu có.
      await rest.del("engagement_devices", {
        username: `eq.${username}`,
        device_id: `eq.${device.device_id}`,
      }).catch(() => null);
      const updated = await rest.patchJson<Device[]>(
        "engagement_devices",
        { id: `eq.${device.id}` },
        { username, label: label ?? device.label, last_seen_at: nowIso, updated_at: nowIso }
      );
      device = firstRow(updated) || { ...device, username };
      await logEvent(rest, {
        actor_username: username,
        event: "account_switched",
        detail: { device_id: device.device_id },
      });
    } else {
      await rest.patch(
        "engagement_devices",
        { id: `eq.${device.id}` },
        { last_seen_at: nowIso, updated_at: nowIso }
      );
      device = { ...device, last_seen_at: nowIso };
    }
  }

  const preferences = await getOrCreatePreferences(rest, device.username);
  const queuedTurns = preferences.enabled
    ? await queueDueDiscussionTurns(rest, device.username)
    : 0;
  if (!preferences.enabled) {
    await rest.rpc("release_actor_claims", {
      p_actor: device.username,
      p_device_id: device.device_id,
      p_now: nowIso,
    }).catch(() => 0);
  }
  const pool = await ensureMutualPoolTasks(rest);
  await cancelTasksForInvalidPosts(rest, device.username);
  const pending = await rest.getJson<Array<{ id: number }>>("engagement_tasks", {
    actor_username: `eq.${device.username}`,
    status: "eq.pending",
    select: "id",
    limit: "100",
  });
  const claimed = await rest.getJson<Array<{ id: number }>>("engagement_tasks", {
    actor_username: `eq.${device.username}`,
    status: "eq.claimed",
    select: "id",
    limit: "5",
  });
  const killSwitch = await isKillSwitchOn(rest);

  return json({
    ok: true,
    serverTime: nowIso,
    device: {
      deviceId: device.device_id,
      username: device.username,
      lastSeenAt: device.last_seen_at,
    },
    killSwitch,
    engagementEnabled: await isEngagementEnabled(rest),
    pendingCount: pending?.length ?? 0,
    claimedCount: claimed?.length ?? 0,
    queuedTurns,
    preferences,
    pool,
  });
}

async function getActiveUsernames(rest: Rest): Promise<Set<string>> {
  const rows = await rest.getJson<Array<{ username: string }>>("users", {
    is_locked: "eq.false",
    select: "username",
    limit: "10000",
  });
  return new Set((rows || []).map((row) => row.username).filter(Boolean));
}

async function writeSetting(rest: Rest, key: string, value: unknown, description: string) {
  const rows = await rest.getJson<Array<{ key: string }>>("settings", {
    key: `eq.${key}`,
    select: "key",
    limit: "1",
  });
  if (firstRow(rows)) {
    const response = await rest.patch("settings", { key: `eq.${key}` }, {
      value,
      updated_at: new Date().toISOString(),
    });
    if (!response.ok) throw new HttpError(`Không cập nhật được setting ${key}.`, 500);
    return;
  }
  const response = await rest.post("settings", { key, value, description });
  if (!response.ok) throw new HttpError(`Không tạo được setting ${key}.`, 500);
}

async function readPoolSettings(rest: Rest) {
  const values = await Promise.all([
    readSetting(rest, "engagement_pool_enabled"),
    readSetting(rest, "engagement_pool_receive_post_limit"),
    readSetting(rest, "engagement_pool_discussions_per_post"),
    readSetting(rest, "engagement_pool_repeat_interval_minutes"),
    readSetting(rest, "engagement_pool_daily_contribution_cap"),
    readSetting(rest, "engagement_ultra_threshold"),
    readSetting(rest, "engagement_ultra_discussions"),
  ]);
  return {
    enabled: settingEnabled(values[0], true),
    receivePostLimit: clampPreference(values[1], 3, 1, 10),
    discussionsPerPost: clampPreference(values[2], 40, 1, 50),
    repeatIntervalMinutes: clampPreference(values[3], 45, 15, 1440),
    dailyContributionCap: clampPreference(values[4], 20, 1, 100),
    ultraThreshold: clampPreference(values[5], 20, 1, 1000),
    ultraDiscussions: clampPreference(values[6], 5, 1, 50),
    minTurns: 2,
    maxTurns: 3,
  };
}

async function handleGetPoolSettings(rest: Rest, auth: Auth) {
  requireAdmin(auth);
  return json({ ok: true, settings: await readPoolSettings(rest) });
}

async function handleSetUserPolicy(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  requireAdmin(auth);
  const username = String(body.username || "").trim();
  if (!isUsername(username)) throw new HttpError("username không hợp lệ.", 400);
  const current = await getOrCreatePreferences(rest, username);
  const enabled = body.enabled !== false;
  const updated = await rest.patchJson<EngagementPreferences[]>(
    "engagement_preferences",
    { username: `eq.${username}` },
    { enabled, updated_at: new Date().toISOString() }
  );
  if (!enabled) {
    await rest.patch("engagement_tasks", {
      actor_username: `eq.${username}`,
      status: "eq.pending",
    }, {
      status: "cancelled",
      completed_at: new Date().toISOString(),
      last_error: "Admin đã tạm dừng user khỏi pool.",
      updated_at: new Date().toISOString(),
    });
  }
  await logEvent(rest, {
    actor_username: username,
    event: "user_policy_updated",
    detail: { enabled },
  });
  return json({ ok: true, preferences: firstRow(updated) || { ...current, enabled } });
}

async function handleSetPoolSettings(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const settings = {
    enabled: body.enabled !== false,
    receivePostLimit: clampPreference(body.receivePostLimit, 3, 1, 10),
    discussionsPerPost: clampPreference(body.discussionsPerPost, 40, 1, 50),
    repeatIntervalMinutes: clampPreference(body.repeatIntervalMinutes, 45, 15, 1440),
    dailyContributionCap: clampPreference(body.dailyContributionCap, 20, 1, 100),
    ultraThreshold: clampPreference(body.ultraThreshold, 20, 1, 1000),
    ultraDiscussions: clampPreference(body.ultraDiscussions, 5, 1, 50),
  };
  const entries: Array<[string, unknown, string]> = [
    ["engagement_pool_enabled", settings.enabled, "Admin bật/tắt pool tự động"],
    ["engagement_pool_receive_post_limit", settings.receivePostLimit, "Số bài tối đa của mỗi user"],
    ["engagement_pool_discussions_per_post", settings.discussionsPerPost, "Số chuỗi trên mỗi bài"],
    ["engagement_pool_repeat_interval_minutes", settings.repeatIntervalMinutes, "Khoảng cách giữa các chuỗi"],
    ["engagement_pool_daily_contribution_cap", settings.dailyContributionCap, "Quota actor mỗi ngày"],
    ["engagement_ultra_threshold", settings.ultraThreshold, "Mốc điểm nhận Ultra"],
    ["engagement_ultra_discussions", settings.ultraDiscussions, "Số chuỗi cho một lượt Ultra"],
  ];
  for (const [key, value, description] of entries) {
    await writeSetting(rest, key, value, description);
  }
  const preferencesUpdate = await rest.patch("engagement_preferences", {}, {
    receive_post_limit: settings.receivePostLimit,
    discussions_per_post: settings.discussionsPerPost,
    repeat_interval_minutes: settings.repeatIntervalMinutes,
    daily_contribution_cap: settings.dailyContributionCap,
    updated_at: new Date().toISOString(),
  });
  if (!preferencesUpdate.ok) {
    throw new HttpError("Đã lưu setting nhưng chưa đồng bộ được policy user.", 500);
  }
  const pool = settings.enabled
    ? await ensureMutualPoolTasks(rest)
    : { participants: 0, posts: 0, created: 0, waitingForPeers: false };
  await logEvent(rest, {
    event: "pool_settings_updated",
    detail: settings,
  });
  return json({ ok: true, settings: { ...settings, minTurns: 2, maxTurns: 3 }, pool });
}

// Hủy task mở nếu actor/target không còn là thành viên hợp lệ, task tự tương tác,
// bài không thuộc target hoặc bài đã đóng/xóa/rejected/stale.
async function cancelTasksForInvalidPosts(rest: Rest, actorUsername: string) {
  const taskRows = await rest.getJson<Array<{
    id: number;
    techhub_id: number;
    target_username: string | null;
  }>>(
    "engagement_tasks",
    {
      actor_username: `eq.${actorUsername}`,
      status: "in.(pending,claimed)",
      select: "id,techhub_id,target_username",
      limit: "200",
    }
  );
  if (!taskRows || taskRows.length === 0) return { cancelled: 0 };
  const ids = taskRows.map((t) => t.techhub_id).filter((n) => Number.isFinite(n));
  if (ids.length === 0) return { cancelled: 0 };
  const uniqueIds = [...new Set(ids)];
  const [posts, activeUsers] = await Promise.all([
    rest.getJson<
      Array<{ techhub_id: number; username: string; status: string; verification_status: string }>
    >("posts", {
      techhub_id: `in.(${uniqueIds.join(",")})`,
      select: "techhub_id,username,status,verification_status",
    }),
    getActiveUsernames(rest),
  ]);
  const byId = new Map<
    number,
    { username: string; status: string; verification_status: string }
  >();
  for (const p of posts || []) byId.set(Number(p.techhub_id), p);
  const badTaskIds: number[] = [];
  for (const task of taskRows) {
    const p = byId.get(Number(task.techhub_id));
    const target = String(task.target_username || "").trim();
    if (!p) {
      badTaskIds.push(task.id);
      continue;
    }
    const st = String(p.status || "").toLowerCase();
    const vs = String(p.verification_status || "");
    const owner = String(p.username || "").trim();
    if (
      !activeUsers.has(actorUsername) ||
      !target ||
      !activeUsers.has(target) ||
      target === actorUsername ||
      owner !== target ||
      st !== "open" ||
      vs !== "verified"
    ) {
      badTaskIds.push(task.id);
    }
  }
  if (badTaskIds.length === 0) return { cancelled: 0 };
  // Update từng lô 50.
  let cancelled = 0;
  for (let i = 0; i < badTaskIds.length; i += 50) {
    const batch = badTaskIds.slice(i, i + 50).join(",");
    await rest.patch(
      "engagement_tasks",
      { id: `in.(${batch})`, status: "in.(pending,claimed)" },
      {
        status: "cancelled",
        claimed_at: null,
        claimed_by_device: null,
        lease_until: null,
        last_error: "Bài không còn mở/verified hoặc thành viên không còn hợp lệ.",
        updated_at: new Date().toISOString(),
      }
    );
    cancelled += batch.split(",").length;
  }
  return { cancelled };
}

async function handleClaimTask(rest: Rest, auth: Auth) {
  const { device } = requireDevice(auth);
  if (!(await isEngagementEnabled(rest))) {
    return json({ task: null, engagementEnabled: false, killSwitch: false });
  }
  if (await isKillSwitchOn(rest)) {
    return json({ task: null, engagementEnabled: true, killSwitch: true });
  }
  await assertUserActive(rest, device.username);
  const preferences = await getOrCreatePreferences(rest, device.username);
  if (!preferences.enabled) {
    return json({ task: null, engagementEnabled: true, participationEnabled: false, killSwitch: false });
  }
  const completedToday = await rest.getJson<Array<{ id: number }>>("engagement_tasks", {
    actor_username: `eq.${device.username}`,
    status: "eq.succeeded",
    completed_at: `gte.${startOfTodayVnIso()}`,
    select: "id",
    limit: String(preferences.daily_contribution_cap),
  });
  if ((completedToday || []).length >= preferences.daily_contribution_cap) {
    return json({
      task: null,
      engagementEnabled: true,
      killSwitch: false,
      dailyCapReached: true,
      dailyContributionCap: preferences.daily_contribution_cap,
    });
  }
  const nowIso = new Date().toISOString();
  await rest.patch(
    "engagement_devices",
    { id: `eq.${device.id}` },
    { last_seen_at: nowIso, updated_at: nowIso }
  );

  let leaseSeconds = 300;
  const leaseSetting = await readSetting(rest, "engagement_lease_seconds");
  const parsedLease = Number(leaseSetting);
  if (Number.isFinite(parsedLease) && parsedLease >= 60 && parsedLease <= 3600) {
    leaseSeconds = Math.floor(parsedLease);
  }

  // Hủy các task nhắm vào bài không còn mở/đã rejected/stale (chỉ tác động lên
  // các task "pending" của actor hiện tại để tránh quét toàn bảng mỗi lần claim).
  try {
    await cancelTasksForInvalidPosts(rest, device.username);
  } catch (error) {
    console.warn("[engagement] cancelTasksForInvalidPosts failed:", error);
  }

  const rows = await rest.rpc<TaskRow[]>("claim_engagement_task", {
    p_actor: device.username,
    p_device_id: device.device_id,
    p_lease_seconds: leaseSeconds,
    p_now: nowIso,
  });
  const task = Array.isArray(rows) ? rows[0] : null;
  if (!task) {
    return json({ task: null, engagementEnabled: true, killSwitch: false, serverTime: nowIso });
  }

  let postTitle: string | null = null;
  let aiAssist = false;
  let commentSource = "template";
  try {
    const post = await getPostByTechhubId(rest, task.techhub_id);
    postTitle = post?.title ?? null;
  } catch {
    // Không chặn claim vì thiếu tiêu đề bài.
  }
  if (task.campaign_id) {
    try {
      const campaigns = await rest.getJson<
        Array<{ ai_assist: boolean; comment_source: string }>
      >("engagement_campaigns", {
        id: `eq.${task.campaign_id}`,
        select: "ai_assist,comment_source",
        limit: "1",
      });
      const campaign = firstRow(campaigns);
      if (campaign) {
        aiAssist = campaign.ai_assist === true;
        commentSource = campaign.comment_source || "template";
      }
    } catch {
      // Giữ mặc định template.
    }
  } else if (task.idempotency_key.startsWith("pool:")) {
    // Pool tự cân bằng ưu tiên nội dung theo ngữ cảnh trên máy actor; nếu máy
    // chưa cấu hình AI, worker tự fallback về template đang hoạt động.
    aiAssist = true;
    commentSource = "ai";
  }

  await logEvent(rest, {
    task_id: task.id,
    campaign_id: task.campaign_id,
    thread_id: null,
    actor_username: task.actor_username,
    event: "claimed",
    detail: {
      action: task.action,
      techhub_id: task.techhub_id,
      attempt: task.attempt_count,
      device_id: device.device_id,
    },
  });

  return json({
    task: {
      id: task.id,
      campaignId: task.campaign_id,
      discussionTurnId: task.discussion_turn_id,
      actorUsername: task.actor_username,
      targetUsername: task.target_username,
      techhubId: task.techhub_id,
      techhubUuid: task.techhub_uuid,
      postTitle,
      action: task.action,
      content: task.content,
      parentTechhubCommentId: task.parent_techhub_comment_id,
      sourceCommentId: task.source_comment_id,
      attemptCount: task.attempt_count,
      maxAttempts: task.max_attempts,
      leaseUntil: task.lease_until,
      idempotencyKey: task.idempotency_key,
      aiAssist,
      commentSource,
    },
    killSwitch: false,
    serverTime: nowIso,
  });
}

async function loadOwnedTask(
  rest: Rest,
  device: Device,
  taskId: number
): Promise<TaskRow> {
  const rows = await rest.getJson<TaskRow[]>("engagement_tasks", {
    id: `eq.${taskId}`,
    select: "*",
    limit: "1",
  });
  const task = firstRow(rows);
  if (!task) throw new HttpError(`Không tìm thấy task #${taskId}.`, 404);
  if (task.actor_username !== device.username) {
    throw new HttpError(`Task #${taskId} không thuộc @${device.username}.`, 403);
  }
  return task;
}

async function handleCompleteTask(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  const { device } = requireDevice(auth);
  const taskId = Number(body.taskId);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new HttpError("taskId không hợp lệ.", 400);
  }
  const task = await loadOwnedTask(rest, device, taskId);
  if (task.status === "succeeded") {
    return json({ ok: true, duplicate: true, taskId });
  }
  if (task.status === "cancelled") {
    throw new HttpError(`Task #${taskId} đã bị hủy.`, 409);
  }
  if (task.status !== "claimed") {
    throw new HttpError(
      `Task #${taskId} đang ở trạng thái ${task.status}, cần claim trước.`,
      409
    );
  }
  if (task.claimed_by_device && task.claimed_by_device !== device.device_id) {
    throw new HttpError(`Task #${taskId} đang do máy khác giữ.`, 409);
  }

  const nowIso = new Date().toISOString();
  const techhubResultId = toPositiveInt(body.techhubResultId);
  const content =
    typeof body.content === "string" && body.content.trim()
      ? body.content.trim().slice(0, 5000)
      : task.content;
  const resultDetail = body.resultDetail ?? null;
  const httpStatus =
    typeof body.httpStatus === "number" ? body.httpStatus : null;

  // Thread reply chỉ an toàn khi đã có comment ID thật để làm ancestry.
  // Nếu TechHub POST thành công nhưng không trả ID, đưa task về queue để lượt
  // sau reconcile comment đã đăng thay vì mở một reply chắc chắn lỗi.
  if (task.discussion_turn_id && !techhubResultId) {
    await rest.patch(
      "engagement_tasks",
      { id: `eq.${taskId}` },
      {
        status: "pending",
        claimed_at: null,
        claimed_by_device: null,
        lease_until: null,
        scheduled_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        content,
        last_error: "Đã đăng nhưng chưa xác định được TechHub comment ID; chờ reconcile.",
        updated_at: nowIso,
      }
    );
    await logEvent(rest, {
      task_id: taskId,
      campaign_id: task.campaign_id,
      actor_username: task.actor_username,
      event: "reconcile_required",
      detail: { discussion_turn_id: task.discussion_turn_id },
    });
    throw new HttpError("Chưa xác định được comment ID; task sẽ tự đối soát lại.", 409);
  }

  await rest.patch(
    "engagement_tasks",
    { id: `eq.${taskId}` },
    {
      status: "succeeded",
      completed_at: nowIso,
      techhub_result_id: techhubResultId,
      content,
      result_detail: resultDetail,
      last_http_status: httpStatus,
      last_error: null,
      session_required: false,
      lease_until: null,
      updated_at: nowIso,
    }
  );

  // Ghi interaction để các job khác dedup (bỏ qua nếu đã có).
  const interactionType =
    task.action === "vote" ? "like" : task.action === "reply" ? "reply" : "comment";
  try {
    await rest.post(
      "interactions",
      {
        username: task.actor_username,
        techhub_id: task.techhub_id,
        interaction_type: interactionType,
        parent_comment_id:
          task.action === "reply" ? task.parent_techhub_comment_id : null,
      },
      "resolution=ignore-duplicates"
    );
  } catch (error) {
    console.error("[engagement-api] record interaction failed:", error);
  }

  // Mỗi task thành công chỉ được cộng đúng một điểm nhờ unique(task_id).
  try {
    const ultraThreshold = clampPreference(
      await readSetting(rest, "engagement_ultra_threshold"), 20, 1, 1000
    );
    await rest.rpc("record_engagement_reward", {
      p_username: task.actor_username,
      p_task_id: taskId,
      p_threshold: ultraThreshold,
    });
  } catch (error) {
    // Không làm task TechHub thất bại chỉ vì sổ điểm tạm lỗi; event giúp admin đối soát.
    console.error("[engagement-api] record reward failed:", error);
    await logEvent(rest, {
      task_id: taskId,
      actor_username: task.actor_username,
      event: "reward_reconcile_required",
      detail: { error: error instanceof Error ? error.message.slice(0, 200) : "unknown" },
    });
  }

  await logEvent(rest, {
    task_id: taskId,
    campaign_id: task.campaign_id,
    actor_username: task.actor_username,
    event: "succeeded",
    http_status: httpStatus,
    detail: {
      action: task.action,
      techhub_id: task.techhub_id,
      techhub_result_id: techhubResultId,
      attempt: task.attempt_count,
    },
  });

  // Nối chuỗi thảo luận: ghi comment ID thật rồi mở turn kế tiếp.
  let advanced: unknown = null;
  if (task.discussion_turn_id) {
    const turnRows = await rest.getJson<
      Array<{ id: number; thread_id: number; turn_index: number }>
    >("discussion_turns", {
      id: `eq.${task.discussion_turn_id}`,
      select: "id,thread_id,turn_index",
      limit: "1",
    });
    const turn = firstRow(turnRows);
    if (turn) {
      await rest.patch(
        "discussion_turns",
        { id: `eq.${turn.id}` },
        {
          status: "succeeded",
          techhub_comment_id: techhubResultId,
          last_error: null,
          updated_at: nowIso,
        }
      );
      advanced = await advanceThreadAfterTurn(rest, turn.thread_id, {
        id: turn.id,
        turn_index: turn.turn_index,
        techhub_comment_id: techhubResultId,
      });
    }
  }

  await maybeCompleteCampaign(rest, task.campaign_id);
  return json({ ok: true, taskId, advanced });
}

async function handleFailTask(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  const { device } = requireDevice(auth);
  const taskId = Number(body.taskId);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new HttpError("taskId không hợp lệ.", 400);
  }
  const task = await loadOwnedTask(rest, device, taskId);
  if (["succeeded", "cancelled", "failed"].includes(task.status)) {
    return json({ ok: true, taskId, disposition: task.status, duplicate: true });
  }

  const nowIso = new Date().toISOString();
  const errorText = String(body.error || "unknown_error").slice(0, 1000);
  const httpStatus =
    typeof body.httpStatus === "number" && Number.isFinite(body.httpStatus)
      ? Math.trunc(body.httpStatus)
      : null;
  const content =
    typeof body.content === "string" && body.content.trim()
      ? body.content.trim().slice(0, 5000)
      : task.content;
  const forcedPermanent = body.permanent === true;

  // Phân loại lỗi:
  // - 401/403: hết phiên → session_required, dừng im lặng chờ đăng nhập lại.
  // - 429/5xx/mất mạng: retry với backoff.
  // - 4xx còn lại hoặc hết lượt: lỗi vĩnh viễn.
  const isAuthError = httpStatus === 401 || httpStatus === 403;
  const isRetryableStatus =
    httpStatus === null ||
    httpStatus === 0 ||
    httpStatus === 408 ||
    httpStatus === 429 ||
    httpStatus >= 500;
  const exhausted = task.attempt_count >= task.max_attempts;

  if (isAuthError && !forcedPermanent) {
    await rest.patch(
      "engagement_tasks",
      { id: `eq.${taskId}` },
      {
        status: "pending",
        session_required: true,
        claimed_at: null,
        claimed_by_device: null,
        lease_until: null,
        scheduled_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        last_error: errorText,
        last_http_status: httpStatus,
        content,
        updated_at: nowIso,
      }
    );
    await logEvent(rest, {
      task_id: taskId,
      campaign_id: task.campaign_id,
      actor_username: task.actor_username,
      event: "session_required",
      http_status: httpStatus,
      detail: { error: errorText },
    });
    return json({ ok: true, taskId, disposition: "session_required" });
  }

  const shouldRetry =
    !forcedPermanent && isRetryableStatus && !exhausted;

  if (shouldRetry) {
    const delayMin = backoffMinutes(task.attempt_count + 1);
    await rest.patch(
      "engagement_tasks",
      { id: `eq.${taskId}` },
      {
        status: "pending",
        claimed_at: null,
        claimed_by_device: null,
        lease_until: null,
        scheduled_at: new Date(Date.now() + delayMin * 60 * 1000).toISOString(),
        last_error: errorText,
        last_http_status: httpStatus,
        content,
        updated_at: nowIso,
      }
    );
    await logEvent(rest, {
      task_id: taskId,
      campaign_id: task.campaign_id,
      actor_username: task.actor_username,
      event: "retry",
      http_status: httpStatus,
      detail: { error: errorText, attempt: task.attempt_count, delayMinutes: Math.round(delayMin) },
    });
    return json({ ok: true, taskId, disposition: "retry" });
  }

  // Lỗi vĩnh viễn.
  await rest.patch(
    "engagement_tasks",
    { id: `eq.${taskId}` },
    {
      status: "failed",
      completed_at: nowIso,
      claimed_by_device: null,
      lease_until: null,
      last_error: errorText,
      last_http_status: httpStatus,
      content,
      updated_at: nowIso,
    }
  );
  await logEvent(rest, {
    task_id: taskId,
    campaign_id: task.campaign_id,
    actor_username: task.actor_username,
    event: "failed",
    http_status: httpStatus,
    detail: { error: errorText, attempt: task.attempt_count },
  });

  // Turn lỗi vĩnh viễn → cả thread blocked, admin sửa rồi chạy lại đúng turn đó.
  if (task.discussion_turn_id) {
    const turnRows = await rest.getJson<
      Array<{ id: number; thread_id: number; turn_index: number }>
    >("discussion_turns", {
      id: `eq.${task.discussion_turn_id}`,
      select: "id,thread_id,turn_index",
      limit: "1",
    });
    const turn = firstRow(turnRows);
    if (turn) {
      await rest.patch(
        "discussion_turns",
        { id: `eq.${turn.id}` },
        { status: "blocked", last_error: errorText, updated_at: nowIso }
      );
      await rest.patch(
        "discussion_threads",
        { id: `eq.${turn.thread_id}` },
        { status: "blocked", last_error: `turn ${turn.turn_index}: ${errorText}`, updated_at: nowIso }
      );
      await logEvent(rest, {
        task_id: taskId,
        campaign_id: task.campaign_id,
        thread_id: turn.thread_id,
        actor_username: task.actor_username,
        event: "blocked",
        http_status: httpStatus,
        detail: { turn: turn.turn_index, error: errorText },
      });
    }
  }

  await maybeCompleteCampaign(rest, task.campaign_id);
  return json({ ok: true, taskId, disposition: "failed" });
}

async function handleReleaseMyClaims(rest: Rest, auth: Auth) {
  const { device } = requireDevice(auth);
  const count = await rest.rpc<number>("release_actor_claims", {
    p_actor: device.username,
    p_device_id: device.device_id,
    p_now: new Date().toISOString(),
  });
  return json({ ok: true, released: Number(count) || 0 });
}

/** Sau khi user đăng nhập lại: mở lại các task đang chờ phiên. */
async function handleClearSessionRequired(rest: Rest, auth: Auth) {
  const { device } = requireDevice(auth);
  const nowIso = new Date().toISOString();
  const rows = await rest.getJson<Array<{ id: number }>>("engagement_tasks", {
    actor_username: `eq.${device.username}`,
    session_required: "eq.true",
    status: "eq.pending",
    select: "id",
    limit: "1000",
  });
  for (const row of rows || []) {
    await rest.patch(
      "engagement_tasks",
      { id: `eq.${row.id}` },
      {
        session_required: false,
        scheduled_at: nowIso,
        last_error: null,
        updated_at: nowIso,
      }
    );
  }
  await logEvent(rest, {
    actor_username: device.username,
    event: "session_restored",
    detail: { reopened: rows?.length ?? 0 },
  });
  return json({ ok: true, reopened: rows?.length ?? 0 });
}

async function handleGetStatus(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  let username: string;
  if (auth.kind === "device") {
    username = auth.device.username;
  } else if (auth.kind === "admin" && typeof body.username === "string" && body.username.trim()) {
    username = body.username.trim();
  } else if (auth.kind === "admin") {
    throw new HttpError("Admin cần truyền username để xem trạng thái actor.", 400);
  } else {
    throw new HttpError("Unauthorized.", 401);
  }

  await assertUserActive(rest, username);
  const pool = await ensureMutualPoolTasks(rest);
  await cancelTasksForInvalidPosts(rest, username);

  const todayStart = startOfTodayVnIso();
  const [pending, claimed, recent, todayTasks, sessionTasks, activeCampaigns] =
    await Promise.all([
      rest.getJson<Array<{ id: number }>>("engagement_tasks", {
        actor_username: `eq.${username}`,
        status: "eq.pending",
        select: "id",
        limit: "100",
      }),
      rest.getJson<TaskRow[]>("engagement_tasks", {
        actor_username: `eq.${username}`,
        status: "eq.claimed",
        select: "*",
        limit: "5",
      }),
      rest.getJson<TaskRow[]>("engagement_tasks", {
        actor_username: `eq.${username}`,
        select: "*",
        order: "updated_at.desc",
        limit: "20",
      }),
      rest.getJson<TaskRow[]>("engagement_tasks", {
        actor_username: `eq.${username}`,
        created_at: `gte.${todayStart}`,
        select: "id,action,status",
        limit: "1000",
      }),
      rest.getJson<Array<{ id: number }>>("engagement_tasks", {
        actor_username: `eq.${username}`,
        session_required: "eq.true",
        status: "eq.pending",
        select: "id",
        limit: "10",
      }),
      rest.getJson<Array<{ id: number }>>("engagement_campaigns", {
        status: "eq.active",
        select: "id",
        limit: "100",
      }),
    ]);

  const today = { vote: 0, comment: 0, reply: 0, succeeded: 0, failed: 0, total: 0 };
  for (const task of todayTasks || []) {
    today.total += 1;
    if (task.action in today) today[task.action as "vote" | "comment" | "reply"] += 1;
    if (task.status === "succeeded") today.succeeded += 1;
    if (task.status === "failed") today.failed += 1;
  }

  const recentEvents = await rest.getJson<
    Array<{
      id: number;
      task_id: number | null;
      event: string;
      http_status: number | null;
      created_at: string;
    }>
  >("engagement_events", {
    actor_username: `eq.${username}`,
    select: "id,task_id,event,http_status,created_at",
    order: "created_at.desc",
    limit: "20",
  });

  await reconcileRewards(rest, username).catch(() => 0);
  const [preferences, receivedTasks] = await Promise.all([
    getOrCreatePreferences(rest, username),
    rest.getJson<TaskRow[]>("engagement_tasks", {
      target_username: `eq.${username}`,
      created_at: `gte.${todayStart}`,
      status: "eq.succeeded",
      select: "id,action,status",
      limit: "1000",
    }),
  ]);
  const received = { vote: 0, comment: 0, reply: 0, total: 0 };
  for (const task of receivedTasks || []) {
    received.total += 1;
    if (task.action in received) {
      received[task.action as "vote" | "comment" | "reply"] += 1;
    }
  }

  const deviceRows =
    auth.kind === "admin"
      ? await rest.getJson<Device[]>("engagement_devices", {
          username: `eq.${username}`,
          select: "device_id,username,label,last_seen_at,revoked",
          limit: "20",
        })
      : null;

  const ultraThreshold = clampPreference(
    await readSetting(rest, "engagement_ultra_threshold"),
    20,
    1,
    1000
  );

  return json({
    actor: username,
    serverTime: new Date().toISOString(),
    killSwitch: await isKillSwitchOn(rest),
    engagementEnabled: await isEngagementEnabled(rest),
    online: true,
    pool,
    pendingCount: pending?.length ?? 0,
    claimedCount: claimed?.length ?? 0,
    claimed: claimed || [],
    sessionRequired: (sessionTasks?.length ?? 0) > 0,
    sessionRequiredCount: sessionTasks?.length ?? 0,
    activeCampaigns: activeCampaigns?.length ?? 0,
    today,
    recentTasks: recent || [],
    recentEvents: recentEvents || [],
    preferences,
    benefit: {
      contributed: today.succeeded,
      received,
      contributionPoints: preferences.contribution_points || 0,
      ultraCredits: preferences.ultra_credits || 0,
      ultraThreshold,
      ultraProgress: (preferences.contribution_points || 0) % ultraThreshold,
    },
    devices: deviceRows,
  });
}

async function handleRedeemUltra(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  const { device } = requireDevice(auth);
  const techhubId = toPositiveInt(body.techhubId);
  if (!techhubId) throw new HttpError("techhubId không hợp lệ.", 400);
  const discussions = clampPreference(
    await readSetting(rest, "engagement_ultra_discussions"), 5, 1, 50
  );
  try {
    const result = await rest.rpc("redeem_engagement_ultra", {
      p_username: device.username,
      p_techhub_id: techhubId,
      p_discussions: discussions,
    });
    await logEvent(rest, {
      actor_username: device.username,
      event: "ultra_redeemed",
      detail: { techhub_id: techhubId, discussions },
    });
    await ensureMutualPoolTasks(rest);
    return json({
      ok: true,
      techhubId,
      discussions,
      reward: firstRow(result as Array<Record<string, unknown>>),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(
      message.includes("Không còn") ? "Bạn chưa có lượt Ultra để dùng." : message,
      400
    );
  }
}

async function handleSubmitOwnThreads(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  const { device } = requireDevice(auth);
  await assertUserActive(rest, device.username);
  const techhubId = toPositiveInt(body.techhubId);
  if (!techhubId) throw new HttpError("techhubId không hợp lệ.", 400);
  if (!Array.isArray(body.threads) || body.threads.length === 0) {
    throw new HttpError("JSON phải là mảng thread không rỗng.", 400);
  }
  const preferences = await getOrCreatePreferences(rest, device.username);
  if (!preferences.enabled) throw new HttpError("Admin đang tạm dừng tài khoản khỏi pool.", 403);
  if (body.threads.length > preferences.discussions_per_post) {
    throw new HttpError(
      `Admin giới hạn tối đa ${preferences.discussions_per_post} chuỗi cho mỗi bài.`,
      400
    );
  }
  const posts = await rest.getJson<PostRow[]>("posts", {
    techhub_id: `eq.${techhubId}`,
    username: `eq.${device.username}`,
    status: "eq.open",
    verification_status: "eq.verified",
    select: "techhub_id,techhub_uuid,username,title,status,last_verified_at,created_at,published_at,community_slug",
    limit: "1",
  });
  if (!firstRow(posts)) {
    throw new HttpError("Bài không thuộc bạn, chưa verified hoặc đã đóng.", 403);
  }
  const existing = await rest.getJson<Array<{ id: number }>>("discussion_threads", {
    techhub_id: `eq.${techhubId}`,
    author_username: `eq.${device.username}`,
    created_at: `gte.${startOfTodayVnIso()}`,
    status: "neq.cancelled",
    select: "id",
    limit: String(preferences.discussions_per_post),
  });
  if ((existing || []).length + body.threads.length > preferences.discussions_per_post) {
    throw new HttpError(
      `Bài này đã dùng quota ${preferences.discussions_per_post} chuỗi hôm nay.`,
      409
    );
  }

  const offlineMinutes = clampPreference(
    await readSetting(rest, "engagement_pool_offline_after_minutes"), 30, 5, 1440
  );
  const devices = await rest.getJson<Array<{ username: string }>>("engagement_devices", {
    revoked: "eq.false",
    last_seen_at: `gte.${new Date(Date.now() - offlineMinutes * 60 * 1000).toISOString()}`,
    select: "username",
    limit: "1000",
  });
  const candidateNames = [...new Set((devices || [])
    .map((row) => row.username)
    .filter((name) => name && name !== device.username))];
  const [activeUsers, candidatePosts] = await Promise.all([
    getActiveUsernames(rest),
    candidateNames.length
      ? rest.getJson<Array<{ username: string }>>("posts", {
          username: `in.(${candidateNames.join(",")})`,
          status: "eq.open",
          verification_status: "eq.verified",
          select: "username",
          limit: "1000",
        })
      : Promise.resolve([] as Array<{ username: string }>),
  ]);
  const ownersWithPosts = new Set((candidatePosts || []).map((post) => post.username));
  const visitors: string[] = [];
  for (const name of shuffle(candidateNames)) {
    if (!activeUsers.has(name) || !ownersWithPosts.has(name)) continue;
    const policy = await getOrCreatePreferences(rest, name);
    if (policy.enabled) visitors.push(name);
  }
  if (!visitors.length) {
    throw new HttpError(
      "Chưa có user khác online, còn trong hệ thống và có bài verified để mở đầu chuỗi. Nội dung chưa được nhập.",
      409
    );
  }

  const normalized = (body.threads as unknown[]).map((raw, index) => {
    const thread = parseThreadIndex(raw, index);
    const visitor = visitors[index % visitors.length];
    return {
      name: thread.name,
      targetTechhubId: techhubId,
      visitor,
      actors: { A: "visitor", B: "author" },
      turns: thread.turns,
    };
  });
  return await handleImportThreads(rest, { kind: "admin" }, {
    threads: normalized,
    defaults: { techhubId },
    dryRun: false,
    createdBy: `user:${device.username}`,
  });
}

async function handlePushComments(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  requireAdmin(auth);
  const techhubId = toPositiveInt(body.techhubId);
  if (!techhubId) throw new HttpError("techhubId không hợp lệ.", 400);
  const discussions = clampPreference(body.discussions, 5, 1, 50);
  const posts = await rest.getJson<PostRow[]>("posts", {
    techhub_id: `eq.${techhubId}`,
    status: "eq.open",
    verification_status: "eq.verified",
    select: "techhub_id,username,status,verification_status",
    limit: "1",
  });
  const post = firstRow(posts);
  if (!post?.username) {
    throw new HttpError("Bài chưa xác minh, đã đóng hoặc không tồn tại.", 400);
  }
  const created = await rest.postJson<Array<{ id: number }>>("engagement_boost_requests", {
    techhub_id: techhubId,
    owner_username: post.username,
    source: "admin",
    requested_discussions: discussions,
    created_by: "admin",
  });
  const boost = firstRow(created);
  await logEvent(rest, {
    event: "admin_boost_created",
    detail: { techhub_id: techhubId, discussions },
  });
  await ensureMutualPoolTasks(rest);
  return json({ ok: true, boostId: boost?.id ?? null, techhubId, discussions });
}

async function handleListBoosts(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  requireAdmin(auth);
  const status = ["active", "completed", "cancelled", "expired"].includes(String(body.status || ""))
    ? String(body.status)
    : "active";
  const boosts = await rest.getJson<Array<Record<string, unknown>>>("engagement_boost_requests", {
    status: `eq.${status}`,
    select: "id,techhub_id,owner_username,source,requested_discussions,status,created_by,expires_at,created_at,updated_at",
    order: "created_at.desc",
    limit: String(clampPreference(body.limit, 100, 1, 500)),
  });
  return json({ ok: true, boosts: boosts || [] });
}

// ---------------------------------------------------------------------------
// Campaign planner (admin) — phân phối công bằng
// ---------------------------------------------------------------------------

type PlanInput = {
  name: string;
  description?: string;
  actions: string[];
  votesPerPost: number;
  commentsPerPost: number;
  maxTasksPerActorDaily: number;
  maxPerPairDaily: number;
  cooldownMinutes: number;
  jitterMinutes: number;
  postScope: {
    usernames?: string[];
    communitySlug?: string;
    maxAgeDays?: number;
    excludePublished?: boolean;
    limit?: number;
  };
  schedule?: Record<string, unknown>;
  aiAssist?: boolean;
  commentSource?: string;
  actorUsernames?: string[];
};

function parsePlanInput(body: Record<string, unknown>): PlanInput {
  const name = String(body.name || "").trim().slice(0, 200);
  if (!name) throw new HttpError("Thiếu tên campaign.", 400);
  const actions = Array.isArray(body.actions) ? body.actions : ["vote", "comment"];
  const normalizedActions = actions
    .map((action) => String(action))
    .filter((action) => ["vote", "comment"].includes(action));
  if (normalizedActions.length === 0) {
    throw new HttpError("Campaign cần ít nhất một action vote/comment.", 400);
  }
  const num = (value: unknown, fallback: number, min: number, max: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(parsed)));
  };
  const scope = (body.postScope as Record<string, unknown>) || {};
  return {
    name,
    description: String(body.description || "").slice(0, 2000) || undefined,
    actions: normalizedActions,
    votesPerPost: normalizedActions.includes("vote")
      ? num(body.votesPerPost, 3, 0, 20)
      : 0,
    commentsPerPost: normalizedActions.includes("comment")
      ? num(body.commentsPerPost, 1, 0, 10)
      : 0,
    maxTasksPerActorDaily: num(body.maxTasksPerActorDaily, 3, 1, 50),
    maxPerPairDaily: num(body.maxPerPairDaily, 1, 1, 10),
    cooldownMinutes: num(body.cooldownMinutes, 45, 0, 1440),
    jitterMinutes: num(body.jitterMinutes, 10, 0, 720),
    postScope: {
      usernames: Array.isArray(scope.usernames)
        ? scope.usernames.map(String).slice(0, 100)
        : undefined,
      communitySlug: scope.communitySlug ? String(scope.communitySlug) : undefined,
      maxAgeDays: scope.maxAgeDays !== undefined ? num(scope.maxAgeDays, 60, 1, 365) : 60,
      excludePublished: scope.excludePublished === true,
      limit: num(scope.limit, 50, 1, 200),
    },
    schedule: (body.schedule as Record<string, unknown>) || {},
    aiAssist: body.aiAssist === true,
    commentSource: String(body.commentSource || "template"),
    actorUsernames: Array.isArray(body.actorUsernames)
      ? body.actorUsernames.map(String).slice(0, 200)
      : undefined,
  };
}

async function handlePlanCampaign(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const input = parsePlanInput(body);
  const now = new Date();
  const nowIso = now.toISOString();

  // 1. Actor chỉ lấy từ thiết bị online gần đây và user đã opt-in. Không
  // fallback sang bảng users vì người chưa cài sẽ làm task nằm chờ vô hạn.
  const sinceIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const seen = await rest.getJson<Array<{ username: string }>>("engagement_devices", {
    revoked: "eq.false",
    last_seen_at: `gte.${sinceIso}`,
    select: "username",
    limit: "5000",
  });
  const online = [...new Set((seen || []).map((row) => row.username).filter(Boolean))];
  const preferences = online.length
    ? await rest.getJson<EngagementPreferences[]>("engagement_preferences", {
        username: `in.(${online.join(",")})`,
        enabled: "eq.true",
        select: "username",
        limit: "5000",
      })
    : [];
  const optedIn = new Set((preferences || []).map((row) => row.username));
  const activeUsers = await getActiveUsernames(rest);
  const requested = input.actorUsernames?.length
    ? new Set(input.actorUsernames.map((name) => name.trim()).filter(Boolean))
    : null;
  const actors = online.filter(
    (name) => activeUsers.has(name) && optedIn.has(name) && (!requested || requested.has(name))
  );
  if (actors.length === 0) {
    throw new HttpError("Không có actor online đã bật tham gia pool.", 400);
  }

  // 2. Bài ứng viên: open + verification_status = verified, có UUID, trong phạm vi, tác giả không bị khóa.
  //    (Bài stale/rejected/unverified không được đưa vào campaign — PLAN_POST_SYNC §4.)
  const postParams: Record<string, string> = {
    status: "eq.open",
    verification_status: "eq.verified",
    last_verified_at: "not.is.null",
    select:
      "techhub_id,techhub_uuid,username,title,status,published_at,created_at,community_slug,verification_status,last_verified_at",
    order: "created_at.desc",
    limit: String(input.postScope.limit || 50),
  };
  if (input.postScope.excludePublished) postParams["published_at"] = "is.null";
  if (input.postScope.communitySlug) {
    postParams["community_slug"] = `eq.${input.postScope.communitySlug}`;
  }
  if (input.postScope.usernames && input.postScope.usernames.length > 0) {
    postParams["username"] = `in.(${input.postScope.usernames.join(",")})`;
  }
  const cutoff = new Date(
    now.getTime() - (input.postScope.maxAgeDays || 60) * 24 * 3600 * 1000
  );
  if (!input.postScope.excludePublished) {
    postParams["published_at"] = `gte.${cutoff.toISOString()}`;
  }
  let posts = await rest.getJson<PostRow[]>("posts", postParams);
  posts = (posts || []).filter((post) => {
    if (!post.techhub_uuid || !post.username) return false;
    if (!activeUsers.has(post.username)) return false;
    if (!post.last_verified_at) return false;
    if (!input.postScope.excludePublished && (!post.published_at || new Date(post.published_at) < cutoff)) return false;
    return true;
  });
  if (posts.length === 0) {
    throw new HttpError("Không có bài nào trong phạm vi campaign.", 400);
  }
  if (!posts.some((post) => actors.some((actor) => actor !== post.username))) {
    throw new HttpError(
      "Cần ít nhất 2 thành viên khác nhau trong users, đang online và có bài verified.",
      400
    );
  }

  // 3. Tạo campaign trước để task có campaign_id (idempotency key chứa campaign).
  const createdCampaigns = await rest.postJson<Array<{ id: number }>>(
    "engagement_campaigns",
    {
      name: input.name,
      description: input.description ?? null,
      status: "active",
      actions: input.actions,
      votes_per_post: input.votesPerPost,
      comments_per_post: input.commentsPerPost,
      max_tasks_per_actor_daily: input.maxTasksPerActorDaily,
      max_per_pair_daily: input.maxPerPairDaily,
      cooldown_minutes: input.cooldownMinutes,
      jitter_minutes: input.jitterMinutes,
      post_scope: input.postScope,
      schedule: input.schedule || {},
      ai_assist: input.aiAssist === true,
      comment_source: ["template", "ai", "thread"].includes(input.commentSource || "")
        ? input.commentSource
        : "template",
      created_by: String(body.createdBy || "admin").slice(0, 100),
      started_at: nowIso,
    }
  );
  const campaign = firstRow(createdCampaigns);
  if (!campaign) throw new HttpError("Không tạo được campaign.", 500);
  const campaignId = campaign.id;

  // 4. Dữ liệu chống trùng: task mở/thành công + interaction đã có.
  const postIds = posts.map((post) => post.techhub_id).join(",");
  const [existingTasks, existingInteractions, recentTasks, todayTasks] =
    await Promise.all([
      rest.getJson<TaskRow[]>("engagement_tasks", {
        techhub_id: `in.(${postIds})`,
        status: "in.(pending,claimed,succeeded)",
        select: "actor_username,techhub_id,action,status",
        limit: "10000",
      }),
      rest.getJson<
        Array<{ username: string; techhub_id: number; interaction_type: string }>
      >("interactions", {
        techhub_id: `in.(${postIds})`,
        select: "username,techhub_id,interaction_type",
        limit: "10000",
      }),
      rest.getJson<TaskRow[]>("engagement_tasks", {
        created_at: `gte.${new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString()}`,
        select: "actor_username,target_username,created_at",
        limit: "10000",
      }),
      rest.getJson<TaskRow[]>("engagement_tasks", {
        created_at: `gte.${startOfTodayVnIso()}`,
        status: "neq.cancelled",
        select: "actor_username,target_username",
        limit: "10000",
      }),
    ]);

  const openPairs = new Set(
    (existingTasks || []).map(
      (task) => `${task.actor_username}:${task.techhub_id}:${task.action}`
    )
  );
  const votedPairs = new Set(
    (existingInteractions || [])
      .filter((row) => row.interaction_type === "like")
      .map((row) => `${row.username}:${row.techhub_id}`)
  );
  const commentedPairs = new Set(
    (existingInteractions || [])
      .filter((row) =>
        ["comment", "external_discussion", "self_discussion"].includes(row.interaction_type)
      )
      .map((row) => `${row.username}:${row.techhub_id}`)
  );
  // Ưu tiên tác giả mà actor ít tương tác nhất (7 ngày gần nhất).
  const pairCounts = new Map<string, number>();
  for (const task of recentTasks || []) {
    if (!task.actor_username || !task.target_username) continue;
    const key = `${task.actor_username}:${task.target_username}`;
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }
  // Cooldown theo cặp actor–tác giả.
  const cooldownSince =
    input.cooldownMinutes > 0
      ? now.getTime() - input.cooldownMinutes * 60 * 1000
      : 0;
  const coolingPairs = new Set<string>();
  if (cooldownSince > 0) {
    for (const task of recentTasks || []) {
      if (!task.actor_username || !task.target_username) continue;
      const createdAt = new Date(
        (task as unknown as { created_at: string }).created_at
      ).getTime();
      if (Number.isFinite(createdAt) && createdAt >= cooldownSince) {
        coolingPairs.add(`${task.actor_username}:${task.target_username}`);
      }
    }
  }
  const dailyActorCount = new Map<string, number>();
  const dailyPairCount = new Map<string, number>();
  for (const task of todayTasks || []) {
    dailyActorCount.set(
      task.actor_username,
      (dailyActorCount.get(task.actor_username) || 0) + 1
    );
    if (task.target_username) {
      const key = `${task.actor_username}:${task.target_username}`;
      dailyPairCount.set(key, (dailyPairCount.get(key) || 0) + 1);
    }
  }

  // 5. Sinh task: vòng theo bài, actor ít tương tác với tác giả trước.
  const toInsert: Record<string, unknown>[] = [];
  const skipped = {
    selfPost: 0,
    alreadyVoted: 0,
    alreadyCommented: 0,
    duplicateTask: 0,
    cooldown: 0,
    dailyActorCap: 0,
    dailyPairCap: 0,
  };
  const commentSlotPerPost = new Map<number, number>();
  let staggerSeq = 0;

  const scheduleFor = () => {
    staggerSeq += 1;
    const staggerMin = (staggerSeq % 12) * 2;
    const jitterMin = randomMinutes(0, input.jitterMinutes);
    return new Date(now.getTime() + (staggerMin + jitterMin) * 60 * 1000).toISOString();
  };

  for (const post of posts) {
    if (!post.username) continue;
    const orderedActors = shuffle(actors)
      .filter((actor) => actor !== post.username)
      .sort((a, b) => {
        const countA = pairCounts.get(`${a}:${post.username}`) || 0;
        const countB = pairCounts.get(`${b}:${post.username}`) || 0;
        return countA - countB;
      });
    if (orderedActors.length === 0) {
      skipped.selfPost += 1;
      continue;
    }

    const tryAssign = (action: "vote" | "comment", quota: number) => {
      let assigned = 0;
      for (const actor of orderedActors) {
        if (assigned >= quota) break;
        const pairKey = `${actor}:${post.username}`;
        if ((dailyActorCount.get(actor) || 0) >= input.maxTasksPerActorDaily) {
          skipped.dailyActorCap += 1;
          continue;
        }
        if ((dailyPairCount.get(pairKey) || 0) >= input.maxPerPairDaily) {
          skipped.dailyPairCap += 1;
          continue;
        }
        if (coolingPairs.has(pairKey)) {
          skipped.cooldown += 1;
          continue;
        }
        if (openPairs.has(`${actor}:${post.techhub_id}:${action}`)) {
          skipped.duplicateTask += 1;
          continue;
        }
        if (action === "vote" && votedPairs.has(`${actor}:${post.techhub_id}`)) {
          skipped.alreadyVoted += 1;
          continue;
        }
        if (action === "comment" && commentedPairs.has(`${actor}:${post.techhub_id}`)) {
          skipped.alreadyCommented += 1;
          continue;
        }
        const slot =
          action === "comment"
            ? (commentSlotPerPost.get(post.techhub_id) || 0) + 1
            : 1;
        if (action === "comment") commentSlotPerPost.set(post.techhub_id, slot);
        const idempotencyKey =
          action === "vote"
            ? `c${campaignId}:${actor}:${post.techhub_id}:vote`
            : `c${campaignId}:${actor}:${post.techhub_id}:comment:slot-${slot}`;
        toInsert.push({
          campaign_id: campaignId,
          actor_username: actor,
          target_username: post.username,
          techhub_id: post.techhub_id,
          techhub_uuid: post.techhub_uuid,
          action,
          status: "pending",
          scheduled_at: scheduleFor(),
          max_attempts: 5,
          idempotency_key: idempotencyKey,
        });
        openPairs.add(`${actor}:${post.techhub_id}:${action}`);
        coolingPairs.add(pairKey);
        dailyActorCount.set(actor, (dailyActorCount.get(actor) || 0) + 1);
        dailyPairCount.set(pairKey, (dailyPairCount.get(pairKey) || 0) + 1);
        pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
        assigned += 1;
      }
      return assigned;
    };

    tryAssign("vote", input.votesPerPost);
    tryAssign("comment", input.commentsPerPost);
  }

  // 6. Ghi task theo lô (bỏ qua trùng idempotency key).
  let created = 0;
  const BATCH = 100;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const res = await rest.post(
      "engagement_tasks",
      batch,
      "resolution=ignore-duplicates"
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new HttpError(`Ghi task thất bại: HTTP ${res.status} ${text.slice(0, 200)}`, 500);
    }
    const rows = (await res.json().catch(() => [])) as unknown[];
    created += Array.isArray(rows) ? rows.length : 0;
  }

  await logEvent(rest, {
    campaign_id: campaignId,
    event: "planned",
    detail: {
      posts: posts.length,
      actors: actors.length,
      tasksCreated: created,
      skipped,
    },
  });
  await rest.patch(
    "engagement_campaigns",
    { id: `eq.${campaignId}` },
    {
      stats: { posts: posts.length, actors: actors.length, tasksCreated: created, skipped },
      updated_at: nowIso,
    }
  );

  return json({
    ok: true,
    campaignId,
    tasksCreated: created,
    posts: posts.length,
    actors: actors.length,
    skipped,
  });
}

async function handleSetCampaignStatus(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>,
  action: "pauseCampaign" | "resumeCampaign" | "cancelCampaign"
) {
  requireAdmin(auth);
  const campaignId = Number(body.campaignId);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    throw new HttpError("campaignId không hợp lệ.", 400);
  }
  const rows = await rest.getJson<Array<{ id: number; status: string }>>(
    "engagement_campaigns",
    { id: `eq.${campaignId}`, select: "id,status", limit: "1" }
  );
  const campaign = firstRow(rows);
  if (!campaign) throw new HttpError(`Không tìm thấy campaign #${campaignId}.`, 404);

  const nowIso = new Date().toISOString();
  if (action === "pauseCampaign") {
    if (campaign.status !== "active") {
      throw new HttpError(`Campaign đang ở trạng thái ${campaign.status}.`, 409);
    }
    await rest.patch(
      "engagement_campaigns",
      { id: `eq.${campaignId}` },
      { status: "paused", updated_at: nowIso }
    );
    await logEvent(rest, { campaign_id: campaignId, event: "paused" });
    return json({ ok: true, campaignId, status: "paused" });
  }
  if (action === "resumeCampaign") {
    if (campaign.status !== "paused") {
      throw new HttpError(`Campaign đang ở trạng thái ${campaign.status}.`, 409);
    }
    await rest.patch(
      "engagement_campaigns",
      { id: `eq.${campaignId}` },
      { status: "active", updated_at: nowIso }
    );
    await logEvent(rest, { campaign_id: campaignId, event: "resumed" });
    return json({ ok: true, campaignId, status: "active" });
  }
  // cancelCampaign: hủy campaign + toàn bộ task chưa xong.
  if (["completed", "cancelled"].includes(campaign.status)) {
    throw new HttpError(`Campaign đã ${campaign.status}.`, 409);
  }
  await rest.patch(
    "engagement_campaigns",
    { id: `eq.${campaignId}` },
    { status: "cancelled", ended_at: nowIso, updated_at: nowIso }
  );
  const openTasks = await rest.getJson<TaskRow[]>("engagement_tasks", {
    campaign_id: `eq.${campaignId}`,
    status: "in.(pending,claimed)",
    select: "id",
    limit: "10000",
  });
  for (const task of openTasks || []) {
    await rest.patch(
      "engagement_tasks",
      { id: `eq.${task.id}` },
      {
        status: "cancelled",
        completed_at: nowIso,
        claimed_by_device: null,
        lease_until: null,
        updated_at: nowIso,
      }
    );
  }
  await logEvent(rest, {
    campaign_id: campaignId,
    event: "cancelled",
    detail: { tasksCancelled: openTasks?.length ?? 0 },
  });
  return json({
    ok: true,
    campaignId,
    status: "cancelled",
    tasksCancelled: openTasks?.length ?? 0,
  });
}

// ---------------------------------------------------------------------------
// Import kịch bản thảo luận (admin)
// ---------------------------------------------------------------------------

async function handleImportThreads(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  // Kiểm tra cấp mảng (400 toàn bộ), còn lỗi từng thread thu thập riêng để
  // thread đúng vẫn import được (đồng bộ hành vi với discussion-import.js).
  if (!Array.isArray(body.threads)) {
    throw new HttpError("JSON phải là một mảng các thread.", 400);
  }
  if (body.threads.length === 0) throw new HttpError("Mảng thread rỗng.", 400);
  if (body.threads.length > 50) {
    throw new HttpError("Tối đa 50 thread mỗi lần import.", 400);
  }
  const rawThreads = body.threads as unknown[];
  const defaults = (body.defaults as Record<string, unknown>) || {};
  const defaultTechhubId = toPositiveInt(defaults.techhubId);
  const defaultVisitor = toUsername(defaults.visitor);
  const campaignId = toPositiveInt(body.campaignId);
  const dryRun = body.dryRun === true;

  if (campaignId) {
    const rows = await rest.getJson<Array<{ id: number }>>("engagement_campaigns", {
      id: `eq.${campaignId}`,
      select: "id",
      limit: "1",
    });
    if (!firstRow(rows)) throw new HttpError(`Không tìm thấy campaign #${campaignId}.`, 404);
  }

  const preview: Array<{
    index: number;
    name: string;
    techhubId: number;
    postTitle: string | null;
    visitor: string;
    author: string;
    turns: Array<{ turn: number; actorKey: string; actorUsername: string; content: string }>;
    staggerMinutes: number;
  }> = [];
  const errors: Array<{ index: number; name: string; error: string }> = [];

  for (let i = 0; i < rawThreads.length; i++) {
    let thread: NormalizedThread;
    try {
      thread = parseThreadIndex(rawThreads[i], i);
    } catch (error) {
      errors.push({
        index: i,
        name: `thread-${i + 1}`,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    try {
      const techhubId = thread.targetTechhubId ?? defaultTechhubId;
      if (!techhubId) {
        throw new HttpError(`thread[${i}] (${thread.name}): thiếu bài đích (targetTechhubId).`, 400);
      }
      const post = await getPostByTechhubId(rest, techhubId);
      if (!post) {
        throw new HttpError(`thread[${i}] (${thread.name}): không tìm thấy bài #${techhubId}. Hãy quét bài trước.`, 400);
      }
      if (!post.techhub_uuid || !post.username) {
        throw new HttpError(`thread[${i}] (${thread.name}): bài #${techhubId} thiếu UUID hoặc tác giả.`, 400);
      }
      if (String(post.status || "").toLowerCase() !== "open") {
        throw new HttpError(`thread[${i}] (${thread.name}): bài #${techhubId} không còn mở.`, 400);
      }
      const author = post.username;
      const locked = await getLockedUsernames(rest);
      if (locked.has(author)) {
        throw new HttpError(`thread[${i}] (${thread.name}): tác giả @${author} đã bị khóa.`, 400);
      }

      // actors.A = visitor → user được phân công; actors.B = author → chủ bài.
      const resolveActor = (declared: string, role: "A" | "B"): string => {
        const lower = declared.toLowerCase();
        if (role === "B") {
          if (lower !== "author" && declared !== author) {
            throw new HttpError(
              `thread[${i}] (${thread.name}): actors.B phải là "author" (chủ bài @${author}).`,
              400
            );
          }
          return author;
        }
        if (lower === "visitor") {
          const visitor = thread.visitor ?? defaultVisitor;
          if (!visitor) {
            throw new HttpError(
              `thread[${i}] (${thread.name}): actors.A = visitor nhưng thiếu visitor (chọn user A).`,
              400
            );
          }
          return visitor;
        }
        return declared;
      };
      const actorA = resolveActor(thread.actors.A, "A");
      const actorB = resolveActor(thread.actors.B, "B");
      if (actorA === actorB) {
        throw new HttpError(`thread[${i}] (${thread.name}): A và B trùng nhau (@${actorA}).`, 400);
      }
      for (const actor of [actorA, actorB]) {
        const user = await getUserByUsername(rest, actor);
        if (!user) {
          throw new HttpError(`thread[${i}] (${thread.name}): @${actor} chưa có trong hệ thống.`, 400);
        }
        if (user.is_locked) {
          throw new HttpError(`thread[${i}] (${thread.name}): @${actor} đã bị khóa.`, 400);
        }
      }

      preview.push({
        index: i,
        name: thread.name,
        techhubId,
        postTitle: post.title,
        visitor: actorA,
        author: actorB,
        turns: thread.turns.map((turn, turnIdx) => ({
          turn: turnIdx + 1,
          actorKey: turn.actor,
          actorUsername: turn.actor === "A" ? actorA : actorB,
          content: turn.content,
        })),
        staggerMinutes: 0,
      });
    } catch (error) {
      errors.push({
        index: i,
        name: thread.name || `thread-${i + 1}`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const repeatIntervalMinutes = clampPreference(
    await readSetting(rest, "engagement_pool_repeat_interval_minutes"), 45, 15, 1440
  );
  const previewNumberByPost = new Map<number, number>();
  for (const item of preview) {
    const number = previewNumberByPost.get(item.techhubId) || 0;
    item.staggerMinutes = number * repeatIntervalMinutes;
    previewNumberByPost.set(item.techhubId, number + 1);
  }

  if (dryRun) {
    return json({ ok: true, dryRun: true, valid: preview.length, preview, errors });
  }

  const imported: Array<{ threadId: number; name: string; techhubId: number; turns: number }> = [];
  for (const item of preview) {
    const createdThreads = await rest.postJson<Array<{ id: number }>>("discussion_threads", {
      name: item.name,
      campaign_id: campaignId,
      techhub_id: item.techhubId,
      techhub_uuid: (await getPostByTechhubId(rest, item.techhubId))?.techhub_uuid ?? null,
      author_username: item.author,
      visitor_username: item.visitor,
      actor_a_username: item.visitor,
      actor_b_username: item.author,
      status: "active",
      current_turn_index: 1,
      total_turns: item.turns.length,
      created_by: "admin",
    });
    const threadRow = firstRow(createdThreads);
    if (!threadRow) {
      errors.push({ index: item.index, name: item.name, error: "Không lưu được thread." });
      continue;
    }
    let prevTurnId: number | null = null;
    let firstTurn: { id: number; turn_index: number; actor_username: string; content: string } | null = null;
    for (const turn of item.turns) {
      const createdTurns = await rest.postJson<Array<{ id: number }>>("discussion_turns", {
        thread_id: threadRow.id,
        turn_index: turn.turn,
        actor_key: turn.actorKey,
        actor_username: turn.actorUsername,
        content: turn.content,
        status: "pending",
        depends_on_turn_id: prevTurnId,
      });
      const turnRow = firstRow(createdTurns);
      if (!turnRow) break;
      if (turn.turn === 1) {
        firstTurn = {
          id: turnRow.id,
          turn_index: 1,
          actor_username: turn.actorUsername,
          content: turn.content,
        };
      }
      prevTurnId = turnRow.id;
    }
    if (!firstTurn) {
      errors.push({ index: item.index, name: item.name, error: "Không lưu được các turn." });
      continue;
    }
    // Chỉ turn đầu vào queue; các turn sau mở dần theo dependency.
    const threadInfo = {
      id: threadRow.id,
      techhub_id: item.techhubId,
      techhub_uuid: (await getPostByTechhubId(rest, item.techhubId))?.techhub_uuid ?? null,
      campaign_id: campaignId,
      author_username: item.author,
    };
    await queueDiscussionTurn(rest, threadInfo, firstTurn, {
      delayMinutes: item.staggerMinutes + randomMinutes(0, 5),
    });
    await logEvent(rest, {
      thread_id: threadRow.id,
      campaign_id: campaignId,
      event: "imported",
      detail: { name: item.name, turns: item.turns.length, techhub_id: item.techhubId },
    });
    imported.push({
      threadId: threadRow.id,
      name: item.name,
      techhubId: item.techhubId,
      turns: item.turns.length,
    });
  }

  // Một Push chỉ hoàn tất khi đã có đủ số chuỗi thực tế được nhập cho bài đó.
  const importedPostIds = [...new Set(imported.map((item) => item.techhubId))];
  for (const techhubId of importedPostIds) {
    const boosts = await rest.getJson<Array<{
      id: number;
      requested_discussions: number;
      created_at: string;
    }>>("engagement_boost_requests", {
      techhub_id: `eq.${techhubId}`,
      status: "eq.active",
      select: "id,requested_discussions,created_at",
      order: "created_at.asc",
      limit: "100",
    });
    for (const boost of boosts || []) {
      const threads = await rest.getJson<Array<{ id: number }>>("discussion_threads", {
        techhub_id: `eq.${techhubId}`,
        created_at: `gte.${boost.created_at}`,
        select: "id",
        limit: String(Math.max(1, Number(boost.requested_discussions) || 1)),
      });
      if ((threads || []).length < Number(boost.requested_discussions)) continue;
      await rest.patch("engagement_boost_requests", { id: `eq.${boost.id}` }, {
        status: "completed",
        updated_at: new Date().toISOString(),
      });
    }
  }

  return json({ ok: true, imported, errors });
}

async function handleUpdateTurn(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const turnId = Number(body.turnId);
  const content = String(body.content || "").trim();
  if (!Number.isInteger(turnId) || turnId <= 0) {
    throw new HttpError("turnId không hợp lệ.", 400);
  }
  if (!content) throw new HttpError("Nội dung turn không được để trống.", 400);
  if (content.length > 2000) throw new HttpError("Nội dung quá dài (>2000 ký tự).", 400);

  const rows = await rest.getJson<
    Array<{ id: number; status: string; task_id: number | null; content: string }>
  >("discussion_turns", {
    id: `eq.${turnId}`,
    select: "id,status,task_id,content",
    limit: "1",
  });
  const turn = firstRow(rows);
  if (!turn) throw new HttpError(`Không tìm thấy turn #${turnId}.`, 404);
  if (!["pending", "queued", "blocked", "failed"].includes(turn.status)) {
    throw new HttpError(`Turn đang ở trạng thái ${turn.status}, không sửa được.`, 409);
  }
  const nowIso = new Date().toISOString();
  await rest.patch(
    "discussion_turns",
    { id: `eq.${turnId}` },
    { content, updated_at: nowIso }
  );
  if (turn.task_id) {
    const taskRows = await rest.getJson<TaskRow[]>("engagement_tasks", {
      id: `eq.${turn.task_id}`,
      select: "id,status",
      limit: "1",
    });
    const task = firstRow(taskRows);
    if (task && task.status === "claimed") {
      throw new HttpError(
        `Task #${task.id} của turn đang được thực thi, không sửa được lúc này.`,
        409
      );
    }
    if (task && task.status === "pending") {
      await rest.patch(
        "engagement_tasks",
        { id: `eq.${task.id}` },
        { content, updated_at: nowIso }
      );
    }
  }
  return json({ ok: true, turnId });
}

async function handleRetryTurn(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const turnId = Number(body.turnId);
  if (!Number.isInteger(turnId) || turnId <= 0) {
    throw new HttpError("turnId không hợp lệ.", 400);
  }
  const rows = await rest.getJson<
    Array<{
      id: number;
      thread_id: number;
      turn_index: number;
      actor_username: string;
      content: string;
      status: string;
      task_id: number | null;
      parent_techhub_comment_id: number | null;
      depends_on_turn_id: number | null;
    }>
  >("discussion_turns", {
    id: `eq.${turnId}`,
    select: "*",
    limit: "1",
  });
  const turn = firstRow(rows);
  if (!turn) throw new HttpError(`Không tìm thấy turn #${turnId}.`, 404);
  if (!["blocked", "failed", "pending"].includes(turn.status)) {
    throw new HttpError(`Turn đang ở trạng thái ${turn.status}, không cần chạy lại.`, 409);
  }
  // Turn trước (nếu có) phải thành công và có comment ID.
  let parentId = turn.parent_techhub_comment_id;
  if (turn.turn_index > 1) {
    if (!turn.depends_on_turn_id) {
      throw new HttpError("Turn thiếu dependency, không chạy lại được.", 400);
    }
    const prevRows = await rest.getJson<
      Array<{ status: string; techhub_comment_id: number | null }>
    >("discussion_turns", {
      id: `eq.${turn.depends_on_turn_id}`,
      select: "status,techhub_comment_id",
      limit: "1",
    });
    const prev = firstRow(prevRows);
    if (!prev || prev.status !== "succeeded" || !prev.techhub_comment_id) {
      throw new HttpError("Turn trước chưa thành công, chưa chạy lại được turn này.", 409);
    }
    parentId = prev.techhub_comment_id;
  }
  const threadRows = await rest.getJson<
    Array<{
      id: number;
      techhub_id: number;
      techhub_uuid: string | null;
      campaign_id: number | null;
      author_username: string;
    }>
  >("discussion_threads", {
    id: `eq.${turn.thread_id}`,
    select: "id,techhub_id,techhub_uuid,campaign_id,author_username",
    limit: "1",
  });
  const thread = firstRow(threadRows);
  if (!thread) throw new HttpError("Không tìm thấy thread.", 404);

  // Hủy task cũ (nếu còn mở), tạo task mới với idempotency key mới.
  if (turn.task_id) {
    await rest.patch(
      "engagement_tasks",
      { id: `eq.${turn.task_id}` },
      {
        status: "cancelled",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    );
  }
  const content =
    typeof body.content === "string" && body.content.trim()
      ? body.content.trim().slice(0, 2000)
      : turn.content;
  const nowIso = new Date().toISOString();
  const created = await rest.postJson<TaskRow[]>("engagement_tasks", {
    campaign_id: thread.campaign_id,
    discussion_turn_id: turn.id,
    actor_username: turn.actor_username,
    target_username: thread.author_username,
    techhub_id: thread.techhub_id,
    techhub_uuid: thread.techhub_uuid,
    action: turn.turn_index === 1 ? "comment" : "reply",
    status: "pending",
    scheduled_at: nowIso,
    max_attempts: 5,
    parent_techhub_comment_id: turn.turn_index === 1 ? null : parentId,
    content,
    idempotency_key: `thread:${thread.id}:turn-${turn.turn_index}:retry-${Date.now()}`,
  });
  const task = firstRow(created);
  await rest.patch(
    "discussion_turns",
    { id: `eq.${turn.id}` },
    {
      status: "queued",
      content,
      parent_techhub_comment_id: turn.turn_index === 1 ? null : parentId,
      task_id: task?.id ?? null,
      attempt_count: 0,
      last_error: null,
      updated_at: nowIso,
    }
  );
  await rest.patch(
    "discussion_threads",
    { id: `eq.${thread.id}` },
    { status: "active", current_turn_index: turn.turn_index, last_error: null, updated_at: nowIso }
  );
  await logEvent(rest, {
    task_id: task?.id ?? null,
    campaign_id: thread.campaign_id,
    thread_id: thread.id,
    actor_username: turn.actor_username,
    event: "retry",
    detail: { turn: turn.turn_index },
  });
  return json({ ok: true, turnId, taskId: task?.id ?? null });
}

// ---------------------------------------------------------------------------
// Truy vấn admin: campaigns / threads / tasks / ops
// ---------------------------------------------------------------------------

async function handleGetCampaigns(rest: Rest, auth: Auth) {
  requireAdmin(auth);
  const campaigns = await rest.getJson<
    Array<{
      id: number;
      name: string;
      status: string;
      actions: string[];
      votes_per_post: number;
      comments_per_post: number;
      created_at: string;
      started_at: string | null;
      ended_at: string | null;
      stats: unknown;
    }>
  >("engagement_campaigns", {
    select:
      "id,name,status,actions,votes_per_post,comments_per_post,created_at,started_at,ended_at,stats",
    order: "created_at.desc",
    limit: "50",
  });
  const result = [];
  for (const campaign of campaigns || []) {
    const tasks = await rest.getJson<TaskRow[]>("engagement_tasks", {
      campaign_id: `eq.${campaign.id}`,
      select: "status,action",
      limit: "10000",
    });
    const byStatus: Record<string, number> = {};
    const byAction: Record<string, number> = {};
    for (const task of tasks || []) {
      byStatus[task.status] = (byStatus[task.status] || 0) + 1;
      byAction[task.action] = (byAction[task.action] || 0) + 1;
    }
    result.push({ ...campaign, taskCounts: byStatus, actionCounts: byAction });
  }
  return json({ campaigns: result });
}

async function handleGetThreads(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const params: Record<string, string> = {
    select: "*",
    order: "updated_at.desc",
    limit: String(Math.min(100, Number(body.limit) || 30)),
  };
  if (typeof body.status === "string" && body.status) {
    params["status"] = `eq.${body.status}`;
  }
  const threads = await rest.getJson<Array<Record<string, unknown>>>(
    "discussion_threads",
    params
  );
  const result = [];
  for (const thread of threads || []) {
    const turns = await rest.getJson<Array<Record<string, unknown>>>(
      "discussion_turns",
      {
        thread_id: `eq.${thread.id}`,
        select: "*",
        order: "turn_index.asc",
        limit: "10",
      }
    );
    result.push({ ...thread, turns: turns || [] });
  }
  return json({ threads: result });
}

async function handleListTasks(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const params: Record<string, string> = {
    select: "*",
    order: "updated_at.desc",
    limit: String(Math.min(200, Number(body.limit) || 50)),
  };
  if (typeof body.status === "string" && body.status) params["status"] = `eq.${body.status}`;
  if (typeof body.actor === "string" && body.actor) {
    params["actor_username"] = `eq.${body.actor}`;
  }
  if (body.campaignId) params["campaign_id"] = `eq.${body.campaignId}`;
  if (typeof body.taskAction === "string" && body.taskAction) {
    params["action"] = `eq.${body.taskAction}`;
  }
  const tasks = await rest.getJson<TaskRow[]>("engagement_tasks", params);
  return json({ tasks: tasks || [] });
}

async function handleGetOpsStats(rest: Rest, auth: Auth) {
  requireAdmin(auth);
  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const [tasks7d, events24h, stuck, sessionTasks, devices] = await Promise.all([
    rest.getJson<TaskRow[]>("engagement_tasks", {
      created_at: `gte.${since7d}`,
      select: "id,actor_username,action,status,last_http_status,created_at,completed_at",
      limit: "10000",
    }),
    rest.getJson<
      Array<{ event: string; http_status: number | null; actor_username: string | null }>
    >("engagement_events", {
      created_at: `gte.${since24h}`,
      select: "event,http_status,actor_username",
      limit: "10000",
    }),
    rest.getJson<TaskRow[]>("engagement_tasks", {
      status: "eq.claimed",
      lease_until: `lt.${new Date().toISOString()}`,
      select: "id,actor_username,action,techhub_id,claimed_at,lease_until",
      limit: "100",
    }),
    rest.getJson<TaskRow[]>("engagement_tasks", {
      session_required: "eq.true",
      status: "eq.pending",
      select: "id,actor_username,action,techhub_id,last_error",
      limit: "100",
    }),
    rest.getJson<Device[]>("engagement_devices", {
      select: "device_id,username,label,last_seen_at,revoked",
      order: "last_seen_at.desc",
      limit: "100",
    }),
  ]);

  const byStatus: Record<string, number> = {};
  const byActor: Record<string, { total: number; succeeded: number; failed: number }> = {};
  for (const task of tasks7d || []) {
    byStatus[task.status] = (byStatus[task.status] || 0) + 1;
    const entry = byActor[task.actor_username] || { total: 0, succeeded: 0, failed: 0 };
    entry.total += 1;
    if (task.status === "succeeded") entry.succeeded += 1;
    if (task.status === "failed") entry.failed += 1;
    byActor[task.actor_username] = entry;
  }
  const byEvent: Record<string, number> = {};
  const byHttpStatus: Record<string, number> = {};
  for (const event of events24h || []) {
    byEvent[event.event] = (byEvent[event.event] || 0) + 1;
    const key = event.http_status == null ? "none" : String(event.http_status);
    byHttpStatus[key] = (byHttpStatus[key] || 0) + 1;
  }
  const total = (tasks7d || []).length;
  const succeeded = byStatus["succeeded"] || 0;

  return json({
    serverTime: new Date().toISOString(),
    killSwitch: await isKillSwitchOn(rest),
    engagementEnabled: await isEngagementEnabled(rest),
    tasks7d: total,
    successRate7d: total ? Math.round((succeeded / total) * 1000) / 10 : null,
    byStatus,
    byActor,
    events24h: (events24h || []).length,
    byEvent,
    byHttpStatus,
    stuckClaimed: stuck || [],
    sessionRequired: sessionTasks || [],
    devices: devices || [],
  });
}

async function handleCleanupEvents(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const days = Math.min(365, Math.max(1, Number(body.olderThanDays) || 30));
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const res = await rest.del("engagement_events", { created_at: `lt.${cutoff}` });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HttpError(`Dọn events thất bại: HTTP ${res.status} ${text.slice(0, 200)}`, 500);
  }
  return json({ ok: true, olderThanDays: days, cutoff });
}

async function handleSetKillSwitch(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const enabled = body.enabled === true;
  const existing = await rest.getJson<Array<{ key: string }>>("settings", {
    key: "eq.engagement_kill_switch",
    select: "key",
    limit: "1",
  });
  if (firstRow(existing)) {
    await rest.patch(
      "settings",
      { key: "eq.engagement_kill_switch" },
      { value: enabled, updated_at: new Date().toISOString() }
    );
  } else {
    await rest.post("settings", {
      key: "engagement_kill_switch",
      value: enabled,
      description: "Kill switch toàn hệ thống: true = dừng phát task mới",
    });
  }
  return json({ ok: true, killSwitch: enabled });
}

async function handleSetEngagementEnabled(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const enabled = body.enabled !== false;
  const existing = await rest.getJson<Array<{ key: string }>>("settings", {
    key: "eq.engagement_enabled",
    select: "key",
    limit: "1",
  });
  if (firstRow(existing)) {
    const updated = await rest.patch("settings", { key: "eq.engagement_enabled" }, {
      value: enabled,
      updated_at: new Date().toISOString(),
    });
    if (!updated.ok) throw new HttpError("Không cập nhật được chế độ tương tác.", 500);
  } else {
    const created = await rest.post("settings", {
      key: "engagement_enabled",
      value: enabled,
      description: "Admin global gate; each user still controls local pool participation",
    });
    if (!created.ok) throw new HttpError("Không tạo được cấu hình tương tác.", 500);
  }
  return json({ ok: true, engagementEnabled: enabled });
}

async function handleRevokeDevice(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const deviceId = String(body.deviceId || "").trim();
  const username = String(body.username || "").trim();
  if (!deviceId || !username) {
    throw new HttpError("Thiếu deviceId/username.", 400);
  }
  const revoked = body.revoked !== false;
  await rest.patch(
    "engagement_devices",
    { device_id: `eq.${deviceId}`, username: `eq.${username}` },
    { revoked, updated_at: new Date().toISOString() }
  );
  if (revoked) {
    await rest.rpc("release_actor_claims", {
      p_actor: username,
      p_device_id: deviceId,
      p_now: new Date().toISOString(),
    }).catch(() => 0);
  }
  return json({ ok: true, deviceId, username, revoked });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(
      { error: "Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (env mặc định của edge function)." },
      500
    );
  }
  const rest = createRest(supabaseUrl, serviceRoleKey);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Body JSON không hợp lệ." }, 400);
  }
  const action = String(body.action || "");
  const header = req.headers.get("Authorization") || "";
  const bearer = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : "";

  // Rate limit trước khi chạm DB (key = hash token, không log token thật).
  if (bearer) {
    const callerKey = await sha256Hex(`rl:${bearer}`);
    if (isRateLimited(callerKey)) {
      return json({ error: "Quá nhiều request, thử lại sau một phút." }, 429);
    }
  }

  try {
    const auth = await resolveAuth(req, rest, body);

    switch (action) {
      case "heartbeat":
        return await handleHeartbeat(rest, auth, body, bearer);
      case "redeemUltra":
        return await handleRedeemUltra(rest, auth, body);
      case "submitOwnThreads":
        return await handleSubmitOwnThreads(rest, auth, body);
      case "claimTask":
        return await handleClaimTask(rest, auth);
      case "completeTask":
        return await handleCompleteTask(rest, auth, body);
      case "failTask":
        return await handleFailTask(rest, auth, body);
      case "releaseMyClaims":
        return await handleReleaseMyClaims(rest, auth);
      case "clearSessionRequired":
        return await handleClearSessionRequired(rest, auth);
      case "getStatus":
        return await handleGetStatus(rest, auth, body);
      case "importThreads":
        return await handleImportThreads(rest, auth, body);
      case "planCampaign":
        return await handlePlanCampaign(rest, auth, body);
      case "pauseCampaign":
      case "resumeCampaign":
      case "cancelCampaign":
        return await handleSetCampaignStatus(
          rest,
          auth,
          body,
          action as "pauseCampaign" | "resumeCampaign" | "cancelCampaign"
        );
      case "getCampaigns":
        return await handleGetCampaigns(rest, auth);
      case "getThreads":
        return await handleGetThreads(rest, auth, body);
      case "listTasks":
        return await handleListTasks(rest, auth, body);
      case "updateTurn":
        return await handleUpdateTurn(rest, auth, body);
      case "retryTurn":
        return await handleRetryTurn(rest, auth, body);
      case "getOpsStats":
        return await handleGetOpsStats(rest, auth);
      case "cleanupEvents":
        return await handleCleanupEvents(rest, auth, body);
      case "setKillSwitch":
        return await handleSetKillSwitch(rest, auth, body);
      case "setEngagementEnabled":
        return await handleSetEngagementEnabled(rest, auth, body);
      case "getPoolSettings":
        return await handleGetPoolSettings(rest, auth);
      case "setPoolSettings":
        return await handleSetPoolSettings(rest, auth, body);
      case "setUserPolicy":
        return await handleSetUserPolicy(rest, auth, body);
      case "pushComments":
        return await handlePushComments(rest, auth, body);
      case "listBoosts":
        return await handleListBoosts(rest, auth, body);
      case "revokeDevice":
        return await handleRevokeDevice(rest, auth, body);
      default:
        return json({ error: `Action không hỗ trợ: ${action}` }, 400);
    }
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message }, error.status);
    }
    console.error("[engagement-api] Unhandled:", error);
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      500
    );
  }
});
