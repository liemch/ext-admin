// Supabase Edge Function: post-sync-api
//
// Quản lý đồng bộ bài viết: hint, sync job, lease, run history.
// Xem PLAN_POST_SYNC.md và README.md trong cùng thư mục.
//
// Deploy:
//   supabase functions deploy post-sync-api --no-verify-jwt
//   supabase secrets set ADMIN_TOKEN=<dùng-chung-với-admin-api>
//
// Phân quyền:
//   - Authorization: Bearer <ADMIN_TOKEN>   → admin/leader
//   - Authorization: Bearer <device-token>  → device (saveMyScannedPosts,
//                                              reconcileMyScannedPosts,
//                                              submitPostHint, listNewPosts)

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

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_HINT = 60;
const RATE_LIMIT_MAX_ADMIN = 240;
const rateHits: { at: number; key: string }[] = [];

function isRateLimited(callerKey: string, limit: number): boolean {
  const now = Date.now();
  while (rateHits.length && now - rateHits[0].at > RATE_LIMIT_WINDOW_MS) {
    rateHits.shift();
  }
  const count = rateHits.filter((h) => h.key === callerKey).length;
  if (count >= limit) return true;
  rateHits.push({ at: now, key: callerKey });
  return false;
}

class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type Rest = {
  get: (table: string, params?: Record<string, string>) => Promise<Response>;
  getJson: <T = unknown[]>(table: string, params?: Record<string, string>) => Promise<T>;
  post: (table: string, payload: unknown, prefer?: string, params?: Record<string, string>) => Promise<Response>;
  postJson: <T = unknown>(table: string, payload: unknown, prefer?: string) => Promise<T>;
  patch: (table: string, params: Record<string, string>, payload: unknown) => Promise<Response>;
  patchJson: <T = unknown>(table: string, params: Record<string, string>, payload: unknown) => Promise<T>;
  del: (table: string, params: Record<string, string>) => Promise<Response>;
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
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url.toString();
  };
  async function throwIfError(res: Response, what: string) {
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new HttpError(`${what}: HTTP ${res.status} ${text.slice(0, 300)}`, res.status);
    }
  }
  return {
    get: (table, params) => fetch(buildUrl(table, params), { headers }),
    getJson: async (table, params) => {
      const r = await fetch(buildUrl(table, params), { headers });
      await throwIfError(r, `Đọc ${table} thất bại`);
      return (await r.json()) as never;
    },
    post: (table, payload, prefer, params) =>
      fetch(buildUrl(table, params), {
        method: "POST",
        headers: prefer ? { ...headers, Prefer: `${headers.Prefer},${prefer}` } : headers,
        body: JSON.stringify(payload),
      }),
    postJson: async (table, payload, prefer) => {
      const r = await fetch(buildUrl(table), {
        method: "POST",
        headers: prefer ? { ...headers, Prefer: `${headers.Prefer},${prefer}` } : headers,
        body: JSON.stringify(payload),
      });
      await throwIfError(r, `Ghi ${table} thất bại`);
      return (await r.json()) as never;
    },
    patch: (table, params, payload) =>
      fetch(buildUrl(table, params), { method: "PATCH", headers, body: JSON.stringify(payload) }),
    patchJson: async (table, params, payload) => {
      const r = await fetch(buildUrl(table, params), {
        method: "PATCH",
        headers,
        body: JSON.stringify(payload),
      });
      await throwIfError(r, `Cập nhật ${table} thất bại`);
      return (await r.json()) as never;
    },
    del: (table, params) => fetch(buildUrl(table, params), { method: "DELETE", headers }),
    rpc: async (fn, payload) => {
      const r = await fetch(`${base}/rpc/${fn}`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      await throwIfError(r, `Gọi ${fn} thất bại`);
      return (await r.json()) as never;
    },
  };
}

async function sha256Hex(text: string): Promise<string> {
  const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(data)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Device = {
  id: number;
  device_id: string;
  username: string;
  token_hash: string;
  revoked: boolean;
  enrollment_status?: "pending" | "approved" | "revoked";
};

type Auth = { kind: "admin" } | { kind: "device"; device: Device } | { kind: "none" };

async function resolveAuth(req: Request, rest: Rest): Promise<Auth> {
  const adminToken = Deno.env.get("ADMIN_TOKEN");
  const header = req.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (adminToken && token && token === adminToken) return { kind: "admin" };
  if (!token) return { kind: "none" };
  const tokenHash = await sha256Hex(token);
  const rows = await rest.getJson<Device[]>("engagement_devices", {
    token_hash: `eq.${tokenHash}`,
    select: "id,device_id,username,token_hash,revoked,enrollment_status",
    limit: "1",
  });
  const device = rows?.[0];
  if (!device) return { kind: "none" };
  if (device.revoked || (device.enrollment_status || "approved") !== "approved") {
    throw new HttpError("Thiết bị chưa được duyệt hoặc đã bị thu hồi.", 403);
  }
  return { kind: "device", device };
}

function requireAdmin(auth: Auth) {
  if (auth.kind !== "admin") throw new HttpError("Unauthorized (cần ADMIN_TOKEN).", 401);
}
function requireDevice(auth: Auth): Device {
  if (auth.kind !== "device") throw new HttpError("Unauthorized (thiếu device token).", 401);
  return auth.device;
}
async function requireLeaderDevice(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
): Promise<Device> {
  requireAdmin(auth);
  const deviceId = String(body.deviceId || body.leaderDeviceId || "").trim();
  const deviceToken = String(body.leaderDeviceToken || "").trim();
  if (!deviceId || !deviceToken) {
    throw new HttpError("Leader cần deviceId và device token.", 401);
  }
  const tokenHash = await sha256Hex(deviceToken);
  const devices = await rest.getJson<Device[]>("engagement_devices", {
    device_id: `eq.${deviceId}`,
    token_hash: `eq.${tokenHash}`,
    select: "id,device_id,username,token_hash,revoked,enrollment_status",
    limit: "1",
  });
  const device = firstRow(devices);
  if (!device || device.revoked || (device.enrollment_status || "approved") !== "approved") {
    throw new HttpError("Leader device không tồn tại hoặc đã bị thu hồi.", 403);
  }
  return device;
}
function firstRow<T>(rows: T[] | T | null): T | null {
  if (!rows) return null;
  return Array.isArray(rows) ? rows[0] ?? null : rows;
}

// ---------------- URL / identifier helpers ----------------

function normalizeTechHubUrl(raw: string): string | null {
  try {
    const u = new URL(String(raw).trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    if (!/(^|\.)techhub\.fpt\.net$/i.test(u.hostname)) return null;
    const path = u.pathname.replace(/\/+/g, "/").replace(/\/$/, "");
    return `https://techhub.fpt.net${path}`;
  } catch {
    return null;
  }
}

function extractUuidFromUrl(url: string): string | null {
  const m = String(url || "").match(/\/[pc]\/(?:[^/]+\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1].toLowerCase() : null;
}

function buildIdentifierKey(identifier: {
  techhubId?: number | null;
  techhubUuid?: string | null;
  url?: string | null;
}): { key: string | null; techhubId: number | null; techhubUuid: string | null; url: string | null } {
  const id = Number(identifier.techhubId);
  const uuid = identifier.techhubUuid ? String(identifier.techhubUuid).trim().toLowerCase() : null;
  const normalizedUrl = identifier.url ? normalizeTechHubUrl(String(identifier.url)) : null;
  const urlUuid = normalizedUrl ? extractUuidFromUrl(normalizedUrl) : null;
  const finalUuid = uuid || urlUuid;
  if (Number.isInteger(id) && id > 0) return { key: `id:${id}`, techhubId: id, techhubUuid: finalUuid, url: normalizedUrl };
  if (finalUuid) return { key: `uuid:${finalUuid}`, techhubId: null, techhubUuid: finalUuid, url: normalizedUrl };
  if (normalizedUrl) return { key: `url:${normalizedUrl}`, techhubId: null, techhubUuid: null, url: normalizedUrl };
  return { key: null, techhubId: null, techhubUuid: null, url: null };
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function backoffMinutes(attempt: number): number {
  const steps = [5, 15, 60, 360];
  return steps[Math.min(steps.length - 1, Math.max(0, attempt - 1))];
}

// ---------------- read settings ----------------

async function readSettingNumber(rest: Rest, key: string, fallback: number, min: number, max: number): Promise<number> {
  const rows = await rest.getJson<Array<{ value: unknown }>>("settings", { key: `eq.${key}`, select: "value", limit: "1" });
  const parsed = Number(rows?.[0]?.value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

// ---------------- Hint ----------------

async function handleSubmitPostHint(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  const device = requireDevice(auth);
  const identifier = (body.identifier as Record<string, unknown>) || {};
  const source = String(body.source || "article_page");
  if (!["article_page", "post_created", "existing_response"].includes(source)) {
    throw new HttpError("source không hợp lệ.", 400);
  }
  const meta = (body.metadata as Record<string, unknown>) || {};
  const built = buildIdentifierKey({
    techhubId: identifier.techhubId == null ? null : Number(identifier.techhubId),
    techhubUuid: identifier.techhubUuid == null ? null : String(identifier.techhubUuid),
    url: identifier.url == null ? null : String(identifier.url),
  });
  if (!built.key) {
    throw new HttpError("Thiếu identifier hợp lệ (cần ít nhất techhubId, techhubUuid hoặc URL TechHub).", 400);
  }
  const observedAt = toIso(body.observedAt) || new Date().toISOString();
  const titleHint = meta.title ? String(meta.title).slice(0, 500) : null;
  const publishedAt = toIso(meta.publishedAt);
  const now = new Date().toISOString();

  // Upsert hint theo (username, identifier_key).
  const existing = await rest.getJson<Array<Record<string, unknown>>>("post_hints", {
    username: `eq.${device.username}`,
    identifier_key: `eq.${built.key}`,
    select: "id,status,attempt_count,title_hint",
    limit: "1",
  });
  const row = firstRow(existing);
  let hintId: number;
  let status: string;
  let createdJob = false;

  if (row) {
    hintId = Number(row.id);
    status = String(row.status);
    // Cập nhật metadata còn thiếu + thời gian quan sát.
    const patch: Record<string, unknown> = { updated_at: now };
    if (built.techhubId) patch.techhub_id = built.techhubId;
    if (built.techhubUuid) patch.techhub_uuid = built.techhubUuid;
    if (built.url) patch.url = built.url;
    if (titleHint && !row.title_hint) patch.title_hint = titleHint;
    if (publishedAt && !patch.published_at_hint) patch.published_at_hint = publishedAt;
    await rest.patch("post_hints", { id: `eq.${hintId}` }, patch);
  } else {
    const inserted = await rest.postJson<Array<{ id: number }>>("post_hints", {
      username: device.username,
      device_id: device.device_id,
      identifier_key: built.key,
      techhub_id: built.techhubId,
      techhub_uuid: built.techhubUuid,
      url: built.url,
      title_hint: titleHint,
      published_at_hint: publishedAt,
      source,
      status: "pending",
      observed_at: observedAt,
    }, "resolution=ignore-duplicates");
    const ins = firstRow(inserted);
    if (!ins) {
      // Đã có (race): đọc lại.
      const dup = await rest.getJson<Array<Record<string, unknown>>>("post_hints", {
        username: `eq.${device.username}`,
        identifier_key: `eq.${built.key}`,
        select: "id,status",
        limit: "1",
      });
      const d = firstRow(dup);
      if (!d) throw new HttpError("Không lưu được hint.", 500);
      hintId = Number(d.id);
      status = String(d.status);
    } else {
      hintId = ins.id;
      status = "pending";
    }
  }

  // Tạo verify_hint job nếu hint chưa verified/rejected và chưa có job đang mở.
  if (!["verified", "rejected"].includes(status)) {
    const idempotencyKey = `verify:${hintId}`;
    const open = await rest.getJson<Array<{ id: number }>>("post_sync_jobs", {
      idempotency_key: `eq.${idempotencyKey}`,
      status: "in.(pending,claimed,running,retry_wait)",
      select: "id",
      limit: "1",
    });
    if (!open || open.length === 0) {
      try {
        await rest.postJson("post_sync_jobs", {
          type: "verify_hint",
          hint_id: hintId,
          username: device.username,
          payload: {
            identifierKey: built.key,
            techhubId: built.techhubId,
            techhubUuid: built.techhubUuid,
            url: built.url,
            titleHint,
            publishedAtHint: publishedAt,
            source,
            observedAt,
          },
          status: "pending",
          scheduled_at: now,
          max_attempts: 5,
          idempotency_key: idempotencyKey,
        }, "resolution=ignore-duplicates");
        await rest.patch("post_hints", { id: `eq.${hintId}` }, { status: "job_created", updated_at: now });
        createdJob = true;
      } catch (e) {
        // Idempotent: nếu job đã tồn tại thì thôi.
        console.warn("[post-sync-api] create verify job failed:", (e as Error).message);
      }
    }
  }

  return json({ ok: true, hintId, status, createdJob });
}

// ---------------- Enqueue admin ----------------

function dateBucket(d: Date) {
  return d.toISOString().slice(0, 10);
}
function hourBucket(d: Date) {
  return d.toISOString().slice(0, 13);
}

async function enqueueJob(
  rest: Rest,
  opts: {
    type: "verify_hint" | "feed_discovery" | "user_reconcile";
    idempotencyKey: string;
    payload: Record<string, unknown>;
    username?: string | null;
    sourceId?: number | null;
    hintId?: number | null;
    scheduledAt?: string;
    maxAttempts?: number;
  }
): Promise<{ id: number | null; created: boolean }> {
  const now = opts.scheduledAt || new Date().toISOString();
  try {
    const rows = await rest.postJson<Array<{ id: number }>>("post_sync_jobs", {
      type: opts.type,
      hint_id: opts.hintId ?? null,
      source_id: opts.sourceId ?? null,
      username: opts.username ?? null,
      payload: opts.payload,
      status: "pending",
      scheduled_at: now,
      max_attempts: opts.maxAttempts ?? 5,
      idempotency_key: opts.idempotencyKey,
    }, "resolution=ignore-duplicates");
    const r = firstRow(rows);
    if (r) return { id: r.id, created: true };
  } catch (e) {
    console.warn("[post-sync-api] enqueue duplicate:", (e as Error).message);
  }
  // Trùng key — lấy job cũ.
  const existing = await rest.getJson<Array<{ id: number }>>("post_sync_jobs", {
    idempotency_key: `eq.${opts.idempotencyKey}`,
    select: "id",
    limit: "1",
  });
  const r = firstRow(existing);
  return { id: r ? Number(r.id) : null, created: false };
}

async function ensureSource(
  rest: Rest,
  type: "community" | "user",
  key: string,
  intervalMinutes: number
): Promise<{ id: number; existing: boolean }> {
  const existing = await rest.getJson<Array<{ id: number }>>("post_sync_sources", {
    type: `eq.${type}`,
    source_key: `eq.${key}`,
    select: "id",
    limit: "1",
  });
  const row = firstRow(existing);
  if (row) return { id: Number(row.id), existing: true };
  const created = await rest.postJson<Array<{ id: number }>>("post_sync_sources", {
    type,
    source_key: key,
    enabled: true,
    interval_minutes: intervalMinutes,
    next_check_at: new Date().toISOString(),
  }, "resolution=ignore-duplicates");
  const r = firstRow(created);
  if (r) return { id: r.id, existing: false };
  const retry = await rest.getJson<Array<{ id: number }>>("post_sync_sources", {
    type: `eq.${type}`,
    source_key: `eq.${key}`,
    select: "id",
    limit: "1",
  });
  const rr = firstRow(retry);
  return { id: rr ? Number(rr.id) : 0, existing: true };
}

async function handleRequestPostSync(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  requireAdmin(auth);
  const scope = String(body.scope || "");
  const now = new Date();
  const jobs: Array<{ id: number | null; scope: string; created: boolean }> = [];

  if (scope === "feed") {
    const communitySlug = String(body.communitySlug || "").trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(communitySlug)) {
      throw new HttpError("communitySlug không hợp lệ.", 400);
    }
    const feedInterval = await readSettingNumber(rest, "post_sync_feed_interval_minutes", 60, 10, 1440);
    const src = await ensureSource(rest, "community", communitySlug, feedInterval);
    const sourceRows = await rest.getJson<Array<{ cursor: unknown }>>("post_sync_sources", {
      id: `eq.${src.id}`,
      select: "cursor",
      limit: "1",
    });
    const sourceCursor = firstRow(sourceRows)?.cursor || null;
    const timeBucket = hourBucket(now);
    const { id, created } = await enqueueJob(rest, {
      type: "feed_discovery",
      idempotencyKey: `feed:${communitySlug}:${timeBucket}`,
      sourceId: src.id,
      payload: { communitySlug, timeBucket, force: true, cursor: sourceCursor },
    });
    jobs.push({ id, scope: `feed:${communitySlug}`, created });
  } else if (scope === "user") {
    const username = String(body.username || "").trim();
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(username)) throw new HttpError("username không hợp lệ.", 400);
    // Cooldown quét tay: ít nhất 10 phút từ lần quét user gần nhất.
    const cooldown = await readSettingNumber(rest, "post_sync_manual_user_cooldown_minutes", 10, 1, 1440);
    const cutoff = new Date(now.getTime() - cooldown * 60 * 1000).toISOString();
    const recent = await rest.getJson<Array<{ id: number }>>("post_sync_jobs", {
      type: "eq.user_reconcile",
      username: `eq.${username}`,
      created_at: `gte.${cutoff}`,
      select: "id",
      limit: "1",
    });
    if (recent && recent.length > 0) {
      return json({ ok: true, queued: false, reason: "cooldown", cooldownMinutes: cooldown, jobs });
    }
    const recInterval = await readSettingNumber(rest, "post_sync_reconcile_interval_minutes", 1440, 60, 4320);
    const src = await ensureSource(rest, "user", username, recInterval);
    const { id, created } = await enqueueJob(rest, {
      type: "user_reconcile",
      idempotencyKey: `user:${username}:${dateBucket(now)}:manual`,
      sourceId: src.id,
      username,
      payload: { username, force: true },
    });
    jobs.push({ id, scope: `user:${username}`, created });
  } else if (scope === "due_users") {
    const recInterval = await readSettingNumber(rest, "post_sync_reconcile_interval_minutes", 1440, 60, 4320);
    // Một lần kiểm tra phiên thành công sẽ mở lại các job đã dừng vì 401/403.
    await rest.patch("post_sync_jobs", { status: "eq.session_required" }, {
      status: "retry_wait",
      scheduled_at: now.toISOString(),
      last_error: null,
      updated_at: now.toISOString(),
    });

    // Tạo source còn thiếu theo lô, sau đó chỉ lấy source thật sự tới hạn.
    const allUsers = await rest.getJson<Array<{ username: string }>>("users", {
      is_locked: "eq.false",
      select: "username",
      limit: "1000",
    });
    const allowedUsers = new Set((allUsers || []).map((r) => r.username).filter(Boolean));
    const existingSources = await rest.getJson<Array<{ source_key: string }>>("post_sync_sources", {
      type: "eq.user",
      select: "source_key",
      limit: "2000",
    });
    const existingKeys = new Set((existingSources || []).map((row) => row.source_key));
    const missingSources = Array.from(allowedUsers)
      .filter((username) => !existingKeys.has(username))
      .map((username) => ({
        type: "user",
        source_key: username,
        enabled: true,
        interval_minutes: recInterval,
        next_check_at: now.toISOString(),
      }));
    if (missingSources.length > 0) {
      await rest.postJson("post_sync_sources", missingSources, "resolution=ignore-duplicates");
    }
    const due = await rest.getJson<Array<{ id: number; source_key: string; cursor: unknown }>>("post_sync_sources", {
      type: "eq.user",
      enabled: "eq.true",
      next_check_at: `lte.${now.toISOString()}`,
      select: "id,source_key,cursor,next_check_at",
      order: "next_check_at.asc,source_key.asc",
      limit: "1000",
    });
    const maxConcurrency = await readSettingNumber(rest, "post_sync_max_concurrency", 3, 1, 10);
    let queued = 0;
    for (const row of due || []) {
      if (queued >= maxConcurrency) break;
      const username = row.source_key;
      if (!allowedUsers.has(username)) continue;
      const { id, created } = await enqueueJob(rest, {
        type: "user_reconcile",
        idempotencyKey: `user:${username}:${dateBucket(now)}`,
        sourceId: Number(row.id),
        username,
        payload: { username, cursor: row.cursor || null },
      });
      if (id && created) {
        jobs.push({ id, scope: `user:${username}`, created });
        queued += 1;
      }
    }
    // Cũng xếp feed community mặc định nếu tới hạn.
    const defaultCommunity = (
      await rest.getJson<Array<{ value: unknown }>>("settings", {
        key: "eq.post_sync_default_community",
        select: "value",
        limit: "1",
      })
    )?.[0]?.value;
    if (defaultCommunity) {
      const slug = String(defaultCommunity);
      const src = await ensureSource(rest, "community", slug, await readSettingNumber(rest, "post_sync_feed_interval_minutes", 60, 10, 1440));
      const last = await rest.getJson<Array<{ last_checked_at: string | null; next_check_at: string | null; cursor: unknown }>>("post_sync_sources", {
        id: `eq.${src.id}`,
        select: "last_checked_at,next_check_at,cursor",
        limit: "1",
      });
      const srcRow = firstRow(last);
      if (srcRow) {
        const nextCheck = new Date(String(srcRow.next_check_at || 0)).getTime();
        if (!srcRow.last_checked_at || nextCheck <= now.getTime()) {
          const { id, created } = await enqueueJob(rest, {
            type: "feed_discovery",
            idempotencyKey: `feed:${slug}:${hourBucket(now)}`,
            sourceId: src.id,
            payload: { communitySlug: slug, scheduled: true, cursor: srcRow.cursor || null },
          });
          jobs.push({ id, scope: `feed:${slug}`, created });
        }
      }
    }
  } else {
    throw new HttpError(`scope không hợp lệ: ${scope}`, 400);
  }
  return json({ ok: true, queued: true, jobs });
}

async function handleSaveScannedPosts(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  requireAdmin(auth);
  const username = String(body.username || "").trim();
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(username)) {
    throw new HttpError("username không hợp lệ.", 400);
  }
  const articles = Array.isArray(body.articles) ? body.articles : [];
  if (articles.length > 5000) throw new HttpError("Tối đa 5000 bài mỗi lượt quét.", 413);

  const now = new Date().toISOString();
  const rows = articles.flatMap((raw) => {
    const article = (raw as Record<string, unknown>) || {};
    const techhubId = Number(article.techhubId ?? article.techhub_id);
    const techhubUuid = String(article.techhubUuid ?? article.techhub_uuid ?? "").trim();
    const author = String(article.username || "").trim();
    if (
      !Number.isInteger(techhubId) ||
      techhubId <= 0 ||
      !techhubUuid ||
      author.toLowerCase() !== username.toLowerCase()
    ) {
      return [];
    }
    return [{
      techhub_id: techhubId,
      techhub_uuid: techhubUuid,
      username,
      title: article.title ? String(article.title).slice(0, 500) : null,
      status: String(article.status || "open"),
      url: article.url ? String(article.url) : null,
      votes_score: Number(article.votesScore ?? article.votes_score ?? 0),
      comments_count: Number(article.commentsCount ?? article.comments_count ?? 0),
      medals_count: Number(article.medalsCount ?? article.medals_count ?? 0),
      feed_score: Number(article.feedScore ?? article.feed_score ?? 0),
      published_at: toIso(article.publishedAt ?? article.published_at),
      community_slug: article.communitySlug ?? article.community_slug ?? null,
      community_name: article.communityName ?? article.community_name ?? null,
      last_seen_at: now,
      last_verified_at: now,
      verification_status: "verified",
      discovered_by: "user_reconcile",
      sync_error: null,
    }];
  });

  const CHUNK_SIZE = 100;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const response = await rest.post(
      "posts",
      rows.slice(i, i + CHUNK_SIZE),
      "resolution=merge-duplicates,return=minimal",
      { on_conflict: "techhub_id" },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new HttpError(`Lưu posts thất bại: HTTP ${response.status} ${detail.slice(0, 300)}`, response.status);
    }
  }
  return json({ ok: true, saved: rows.length, skipped: articles.length - rows.length });
}

async function handleSaveMyScannedPosts(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  const device = requireDevice(auth);
  const users = await rest.getJson<Array<{ username: string; is_locked: boolean }>>("users", {
    username: `eq.${device.username}`,
    select: "username,is_locked",
    limit: "1",
  });
  const user = firstRow(users);
  if (!user || user.is_locked) {
    throw new HttpError(`Tài khoản @${device.username} không tồn tại hoặc đã bị khóa.`, 403);
  }

  const articles = Array.isArray(body.articles) ? body.articles : [];
  if (articles.length > 200) throw new HttpError("Tối đa 200 bài mỗi lô đồng bộ.", 413);
  const now = new Date().toISOString();
  const normalized = articles.flatMap((raw) => {
    const article = (raw as Record<string, unknown>) || {};
    const techhubId = Number(article.techhubId ?? article.techhub_id);
    const techhubUuid = String(article.techhubUuid ?? article.techhub_uuid ?? "").trim();
    const author = String(article.username || "").trim();
    if (
      !Number.isInteger(techhubId) ||
      techhubId <= 0 ||
      !techhubUuid ||
      author.toLowerCase() !== device.username.toLowerCase()
    ) {
      return [];
    }
    return [{
      techhub_id: techhubId,
      techhub_uuid: techhubUuid,
      username: device.username,
      title: article.title ? String(article.title).slice(0, 500) : null,
      status: String(article.status || "open"),
      url: article.url ? String(article.url).slice(0, 2000) : null,
      votes_score: Number(article.votesScore ?? article.votes_score ?? 0),
      comments_count: Number(article.commentsCount ?? article.comments_count ?? 0),
      medals_count: Number(article.medalsCount ?? article.medals_count ?? 0),
      feed_score: Number(article.feedScore ?? article.feed_score ?? 0),
      created_at: toIso(article.createdAt ?? article.created_at) || now,
      published_at: toIso(article.publishedAt ?? article.published_at),
      community_slug: article.communitySlug ?? article.community_slug ?? null,
      community_name: article.communityName ?? article.community_name ?? null,
      last_seen_at: now,
      last_verified_at: now,
      verification_status: "verified",
      // Dùng giá trị schema hiện có; đây là reconcile do chính user thực hiện.
      discovered_by: "user_reconcile",
      sync_error: null,
    }];
  });
  const rows = [...new Map(normalized.map((row) => [row.techhub_id, row])).values()];
  const ids = rows.map((row) => row.techhub_id);
  const existing = ids.length
    ? await rest.getJson<Array<{ techhub_id: number; username: string }>>("posts", {
        techhub_id: `in.(${ids.join(",")})`,
        select: "techhub_id,username",
        limit: String(ids.length),
      })
    : [];
  const conflicting = existing.find(
    (post) => String(post.username || "").toLowerCase() !== device.username.toLowerCase()
  );
  if (conflicting) {
    throw new HttpError(`Bài #${conflicting.techhub_id} đã thuộc tài khoản khác.`, 409);
  }

  if (rows.length) {
    const response = await rest.post(
      "posts",
      rows,
      "resolution=merge-duplicates,return=minimal",
      { on_conflict: "techhub_id" },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new HttpError(`Lưu posts thất bại: HTTP ${response.status} ${detail.slice(0, 300)}`, response.status);
    }
  }
  const existingIds = new Set(existing.map((post) => Number(post.techhub_id)));
  const updated = rows.filter((row) => existingIds.has(row.techhub_id)).length;
  return json({
    ok: true,
    username: device.username,
    saved: rows.length,
    created: rows.length - updated,
    updated,
    skipped: articles.length - rows.length,
  });
}

async function handleReconcileMyScannedPosts(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  const device = requireDevice(auth);
  const users = await rest.getJson<Array<{ username: string; is_locked: boolean }>>("users", {
    username: `eq.${device.username}`,
    select: "username,is_locked",
    limit: "1",
  });
  const user = firstRow(users);
  if (!user || user.is_locked) {
    throw new HttpError(`Tài khoản @${device.username} không tồn tại hoặc đã bị khóa.`, 403);
  }

  if (!Array.isArray(body.liveTechhubIds)) {
    throw new HttpError("Thiếu danh sách ID bài TechHub đã quét đầy đủ.", 400);
  }
  if (body.liveTechhubIds.length > 50000) {
    throw new HttpError("Danh sách đối soát vượt quá 50000 bài.", 413);
  }
  const normalizedIds = body.liveTechhubIds.map((value) => Number(value));
  if (normalizedIds.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new HttpError("Danh sách ID bài TechHub không hợp lệ; không xóa dữ liệu.", 400);
  }
  const liveIds = new Set(normalizedIds);

  const existing: Array<{ techhub_id: number }> = [];
  const PAGE_SIZE = 1000;
  for (let offset = 0; offset < 50000; offset += PAGE_SIZE) {
    const page = await rest.getJson<Array<{ techhub_id: number }>>("posts", {
      username: `eq.${device.username}`,
      select: "techhub_id",
      order: "techhub_id.asc",
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    existing.push(...page);
    if (page.length < PAGE_SIZE) break;
    if (offset + PAGE_SIZE >= 50000) {
      throw new HttpError("Có quá nhiều bài để đối soát an toàn; chưa xóa dữ liệu.", 409);
    }
  }

  const staleIds = existing
    .map((post) => Number(post.techhub_id))
    .filter((techhubId) => Number.isInteger(techhubId) && !liveIds.has(techhubId));
  let removed = 0;
  const DELETE_CHUNK_SIZE = 200;
  for (let i = 0; i < staleIds.length; i += DELETE_CHUNK_SIZE) {
    const ids = staleIds.slice(i, i + DELETE_CHUNK_SIZE);
    const response = await rest.del("posts", {
      username: `eq.${device.username}`,
      techhub_id: `in.(${ids.join(",")})`,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new HttpError(`Xóa posts không còn trên TechHub thất bại: HTTP ${response.status} ${detail.slice(0, 300)}`, response.status);
    }
    const deleted = await response.json().catch(() => []);
    removed += Array.isArray(deleted) ? deleted.length : ids.length;
  }

  return json({ ok: true, username: device.username, removed });
}

// ---------------- Leader actions ----------------

async function handleClaimPostSyncJob(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  await requireLeaderDevice(rest, auth, body);
  const deviceId = String(body.deviceId || body.leaderDeviceId || "").trim();
  if (!deviceId) throw new HttpError("Thiếu deviceId.", 400);
  const leaseSeconds = Math.max(60, Number(body.leaseSeconds) || (await readSettingNumber(rest, "post_sync_lease_seconds", 600, 60, 3600)));
  const rows = await rest.rpc<Array<Record<string, unknown>>>("claim_post_sync_job", {
    p_admin_device_id: deviceId,
    p_lease_seconds: leaseSeconds,
    p_now: new Date().toISOString(),
  });
  const job = Array.isArray(rows) ? rows[0] || null : null;
  const leaderRows = await rest.getJson<Array<{ device_id: string | null; lease_until: string | null }>>("post_sync_leader_lease", {
    singleton: "eq.true",
    select: "device_id,lease_until",
    limit: "1",
  });
  const leader = firstRow(leaderRows);
  const isLeader = leader?.device_id === deviceId;
  if (!job) return json({ job: null, isLeader, leader, serverTime: new Date().toISOString() });
  const updated = await rest.patchJson<Array<Record<string, unknown>>>("post_sync_jobs", { id: `eq.${job.id}` }, {
    status: "running",
    updated_at: new Date().toISOString(),
  });
  return json({ job: firstRow(updated) || { ...job, status: "running" }, isLeader, leader, serverTime: new Date().toISOString(), leaseSeconds });
}

async function handleStartPostSyncRun(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  await requireLeaderDevice(rest, auth, body);
  const jobId = Number(body.jobId);
  const sourceId = body.sourceId ? Number(body.sourceId) : null;
  const deviceId = String(body.deviceId || body.leaderDeviceId || "").trim();
  if (!Number.isInteger(jobId) || jobId <= 0) throw new HttpError("jobId không hợp lệ.", 400);
  const runId = await rest.rpc<number>("start_post_sync_run", {
    p_job_id: jobId,
    p_source_id: sourceId,
    p_device_id: deviceId,
    p_now: new Date().toISOString(),
  });
  return json({ ok: true, runId });
}

async function handleExtendPostSyncLease(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  await requireLeaderDevice(rest, auth, body);
  const jobId = Number(body.jobId);
  const deviceId = String(body.deviceId || "").trim();
  if (!Number.isInteger(jobId) || jobId <= 0) throw new HttpError("jobId không hợp lệ.", 400);
  const leaseSeconds = Math.max(60, Number(body.leaseSeconds) || 600);
  const now = new Date().toISOString();
  const rows = await rest.patchJson<Array<Record<string, unknown>>>("post_sync_jobs", {
    id: `eq.${jobId}`,
    claimed_by_device: `eq.${deviceId}`,
    status: "eq.running",
  }, { lease_until: new Date(Date.now() + leaseSeconds * 1000).toISOString(), updated_at: now });
  if (!firstRow(rows)) throw new HttpError("Không thể gia hạn lease không thuộc device.", 409);
  return json({ ok: true, leaseUntil: new Date(Date.now() + leaseSeconds * 1000).toISOString() });
}

// Complete atomically in Postgres: article upsert, metrics, source cursor,
// continuation and terminal job state commit together.
async function handleCompletePostSyncJob(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  await requireLeaderDevice(rest, auth, body);
  const jobId = Number(body.jobId);
  const runId = Number(body.runId);
  const deviceId = String(body.deviceId || "").trim();
  if (!Number.isInteger(jobId) || jobId <= 0) throw new HttpError("jobId không hợp lệ.", 400);
  if (!Number.isInteger(runId) || runId <= 0) throw new HttpError("runId không hợp lệ.", 400);

  const articles = (Array.isArray(body.articles) ? body.articles : []).map((raw) => {
    const article = (raw as Record<string, unknown>) || {};
    return {
      techhub_id: Number(article.techhubId ?? article.techhub_id),
      techhub_uuid: article.techhubUuid ?? article.techhub_uuid ?? null,
      username: article.username ?? null,
      title: article.title ?? null,
      status: article.status ?? "open",
      url: article.url ?? null,
      votes_score: Number(article.votesScore ?? article.votes_score ?? 0),
      comments_count: Number(article.commentsCount ?? article.comments_count ?? 0),
      medals_count: Number(article.medalsCount ?? article.medals_count ?? 0),
      feed_score: Number(article.feedScore ?? article.feed_score ?? 0),
      published_at: toIso(article.publishedAt ?? article.published_at),
      community_slug: article.communitySlug ?? article.community_slug ?? null,
      community_name: article.communityName ?? article.community_name ?? null,
    };
  });
  const result = await rest.rpc<Record<string, unknown>>("complete_post_sync_job", {
    p_job_id: jobId,
    p_run_id: runId,
    p_device_id: deviceId,
    p_metrics: {
      requestCount: Math.max(0, Math.floor(Number(body.requestCount) || 0)),
      pageCount: Math.max(0, Math.floor(Number(body.pageCount) || 0)),
      rejectedCount: Math.max(0, Math.floor(Number(body.rejectedCount) || 0)),
      lastCursor: (body.cursor ?? body.lastCursor) || null,
      budgetExhausted: body.budgetExhausted === true,
      httpStatus: body.httpStatus ? Number(body.httpStatus) : 200,
    },
    p_articles: articles,
    p_now: new Date().toISOString(),
  });
  return json(result);
}

// Kept temporarily as migration reference for deployments still on schema 013.
// The router never calls this path after the post-sync hardening migration.
async function handleCompletePostSyncJobLegacy(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  requireAdmin(auth);
  const jobId = Number(body.jobId);
  const runId = body.runId ? Number(body.runId) : null;
  const deviceId = String(body.deviceId || "").trim();
  if (!Number.isInteger(jobId) || jobId <= 0) throw new HttpError("jobId không hợp lệ.", 400);

  const jobRows = await rest.getJson<Array<Record<string, unknown>>>("post_sync_jobs", {
    id: `eq.${jobId}`,
    select: "*",
    limit: "1",
  });
  const job = firstRow(jobRows);
  if (!job) throw new HttpError(`Không tìm thấy job #${jobId}.`, 404);
  if (job.claimed_by_device && deviceId && job.claimed_by_device !== deviceId) {
    throw new HttpError(`Job #${jobId} đang do máy khác giữ.`, 409);
  }

  const now = new Date().toISOString();
  const metrics = {
    requestCount: Math.max(0, Math.floor(Number(body.requestCount) || 0)),
    pageCount: Math.max(0, Math.floor(Number(body.pageCount) || 0)),
    newCount: Math.max(0, Math.floor(Number(body.newCount) || 0)),
    updatedCount: Math.max(0, Math.floor(Number(body.updatedCount) || 0)),
    unchangedCount: Math.max(0, Math.floor(Number(body.unchangedCount) || 0)),
    rejectedCount: Math.max(0, Math.floor(Number(body.rejectedCount) || 0)),
    lastCursor: (body.cursor ?? body.lastCursor) || null,
    budgetExhausted: body.budgetExhausted === true,
    httpStatus: body.httpStatus ? Number(body.httpStatus) : 200,
    errorSummary: body.errorSummary ? String(body.errorSummary).slice(0, 2000) : null,
  };
  const discoveredBy = String(job.type === "verify_hint" ? "post_hint" : job.type);
  const articles = Array.isArray(body.articles) ? body.articles : [];
  const rejectedHints = Array.isArray(body.rejectedHints) ? body.rejectedHints : [];

  // Upsert bài viết.
  let newCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  const postPayloads = [];
  for (const raw of articles) {
    const a = (raw as Record<string, unknown>) || {};
    const techhubId = Number(a.techhubId ?? a.techhub_id);
    const techhubUuid = a.techhubUuid ?? a.techhub_uuid ?? null;
    const username = String(a.username || "").trim() || null;
    if (!Number.isInteger(techhubId) || techhubId <= 0 || !username || !techhubUuid) {
      continue;
    }
    const existing = await rest.getJson<Array<{ id: number; first_seen_at: string | null; created_at: string | null }>>("posts", {
      techhub_id: `eq.${techhubId}`,
      select: "id,first_seen_at,created_at",
      limit: "1",
    });
    const row = firstRow(existing);
    const firstSeenAt = row?.first_seen_at || row?.created_at || now;
    const payload = {
      techhub_id: techhubId,
      techhub_uuid: String(techhubUuid),
      username,
      title: a.title ? String(a.title).slice(0, 500) : null,
      status: String(a.status || "open"),
      url: a.url ? String(a.url) : null,
      votes_score: Number(a.votesScore ?? a.votes_score ?? 0),
      comments_count: Number(a.commentsCount ?? a.comments_count ?? 0),
      medals_count: Number(a.medalsCount ?? a.medals_count ?? 0),
      feed_score: Number(a.feedScore ?? a.feed_score ?? 0),
      published_at: toIso(a.publishedAt ?? a.published_at),
      community_slug: a.communitySlug ?? a.community_slug ?? null,
      community_name: a.communityName ?? a.community_name ?? null,
      last_seen_at: now,
      verification_status: "verified",
      first_seen_at: firstSeenAt,
      last_verified_at: now,
      discovered_by: discoveredBy,
      sync_error: null,
      sync_run_id: runId,
    };
    postPayloads.push(payload);
    if (row) updatedCount += 1;
    else newCount += 1;
  }
  // Nếu leader không gửi articles mà chỉ gửi newCount/updatedCount → tin số liệu.
  if (postPayloads.length === 0) {
    newCount = metrics.newCount;
    updatedCount = metrics.updatedCount;
    unchangedCount = metrics.unchangedCount;
  } else {
    unchangedCount = 0;
  }
  // Ghi theo lô.
  const CHUNK = 100;
  for (let i = 0; i < postPayloads.length; i += CHUNK) {
    await rest.post("posts", postPayloads.slice(i, i + CHUNK),
      "resolution=merge-duplicates,return=minimal");
  }

  // Rejected hints: đánh dấu rejected + reason.
  for (const raw of rejectedHints) {
    const r = (raw as Record<string, unknown>) || {};
    const hid = Number(r.hintId);
    if (!Number.isInteger(hid)) continue;
    await rest.patch("post_hints", { id: `eq.${hid}` }, {
      status: "rejected",
      last_error: r.reason ? String(r.reason).slice(0, 500) : "rejected",
      updated_at: now,
    });
  }

  // Hint verified (job verify_hint thành công).
  if (job.type === "verify_hint" && job.hint_id && !metrics.errorSummary) {
    await rest.patch("post_hints", { id: `eq.${job.hint_id}` }, {
      status: "verified",
      verified_at: now,
      last_error: null,
      updated_at: now,
    });
  }

  // Cập nhật run.
  if (runId) {
    const outcome = metrics.budgetExhausted ? "partial" : (metrics.errorSummary ? "failed" : "succeeded");
    await rest.patch("post_sync_runs", { id: `eq.${runId}` }, {
      finished_at: now,
      outcome,
      request_count: metrics.requestCount,
      page_count: metrics.pageCount,
      new_count: newCount,
      updated_count: updatedCount,
      unchanged_count: unchangedCount,
      rejected_count: metrics.rejectedCount,
      last_cursor: metrics.lastCursor,
      http_status: metrics.httpStatus,
      error_summary: metrics.errorSummary,
      budget_exhausted: metrics.budgetExhausted,
    });
  }

  // Cập nhật source.
  if (job.source_id) {
    const interval = await readSettingNumber(
      rest,
      job.type === "feed_discovery" ? "post_sync_feed_interval_minutes" : "post_sync_reconcile_interval_minutes",
      job.type === "feed_discovery" ? 60 : 1440,
      10, 4320
    );
    const patch: Record<string, unknown> = {
      last_checked_at: now,
      cursor: metrics.lastCursor,
      last_error: metrics.errorSummary,
      updated_at: now,
    };
    if (!metrics.errorSummary) {
      patch.last_success_at = now;
      patch.next_check_at = new Date(Date.now() + interval * 60 * 1000).toISOString();
      patch.request_count_24h = 0; // đơn giản hóa; cộng dồn lúc bắt đầu run
      patch.window_started_at = now;
    } else {
      patch.next_check_at = new Date(Date.now() + backoffMinutes(Number(job.attempt_count) || 1) * 60 * 1000).toISOString();
    }
    await rest.patch("post_sync_sources", { id: `eq.${job.source_id}` }, patch);
  }

  // Continuation nếu chạm budget.
  let continuationJobId: number | null = null;
  if (metrics.budgetExhausted && metrics.lastCursor) {
    const cont = await enqueueJob(rest, {
      type: job.type as "verify_hint" | "feed_discovery" | "user_reconcile",
      idempotencyKey: `${String(job.idempotency_key)}:cont:${Date.now()}`,
      sourceId: job.source_id ? Number(job.source_id) : null,
      username: job.username ? String(job.username) : null,
      hintId: job.hint_id ? Number(job.hint_id) : null,
      payload: {
        ...(typeof job.payload === "object" ? (job.payload as Record<string, unknown>) : {}),
        cursor: metrics.lastCursor,
        continuation: true,
      },
      scheduledAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    });
    continuationJobId = cont.id;
  }

  await rest.patch("post_sync_jobs", { id: `eq.${jobId}` }, {
    status: metrics.budgetExhausted ? "succeeded" : (metrics.errorSummary ? "failed" : "succeeded"),
    completed_at: now,
    cursor: metrics.lastCursor,
    last_http_status: metrics.httpStatus,
    last_error: metrics.errorSummary,
    claimed_by_device: null,
    lease_until: null,
    updated_at: now,
  });

  return json({
    ok: true,
    jobId,
    runId,
    outcome: metrics.budgetExhausted ? "partial" : (metrics.errorSummary ? "failed" : "succeeded"),
    newCount,
    updatedCount,
    continuationJobId,
  });
}

async function handleFailPostSyncJob(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  await requireLeaderDevice(rest, auth, body);
  const jobId = Number(body.jobId);
  const runId = body.runId ? Number(body.runId) : null;
  const deviceId = String(body.deviceId || "").trim();
  if (!Number.isInteger(jobId) || jobId <= 0) throw new HttpError("jobId không hợp lệ.", 400);
  const jobRows = await rest.getJson<Array<Record<string, unknown>>>("post_sync_jobs", { id: `eq.${jobId}`, select: "*", limit: "1" });
  const job = firstRow(jobRows);
  if (!job) throw new HttpError(`Không tìm thấy job #${jobId}.`, 404);
  if (job.claimed_by_device && deviceId && job.claimed_by_device !== deviceId) {
    throw new HttpError(`Job #${jobId} đang do máy khác giữ.`, 409);
  }

  const now = new Date().toISOString();
  const error = String(body.error || "unknown_error").slice(0, 1000);
  const httpStatus = Number.isFinite(Number(body.httpStatus)) ? Number(body.httpStatus) : null;
  const permanent = body.permanent === true;
  const retryAfterSeconds = Math.max(0, Math.floor(Number(body.retryAfterSeconds) || 0));
  const isAuthError = httpStatus === 401 || httpStatus === 403;
  const exhausted = (Number(job.attempt_count) || 0) >= (Number(job.max_attempts) || 5);
  const isRetryable = !permanent && (httpStatus === null || httpStatus === 0 || httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) && !exhausted;

  let disposition: string;
  const patch: Record<string, unknown> = {
    last_error: error,
    last_http_status: httpStatus,
    claimed_by_device: null,
    lease_until: null,
    updated_at: now,
  };

  if (isAuthError) {
    disposition = "session_required";
    patch.status = "session_required";
    patch.scheduled_at = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  } else if (isRetryable) {
    disposition = "retry";
    patch.status = "retry_wait";
    const delayMs = httpStatus === 429 && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : backoffMinutes(Number(job.attempt_count) || 1) * 60 * 1000;
    patch.scheduled_at = new Date(Date.now() + delayMs).toISOString();
  } else {
    disposition = "failed";
    patch.status = "failed";
    patch.completed_at = now;
  }

  await rest.patch("post_sync_jobs", { id: `eq.${jobId}` }, patch);

  // Đánh dấu hint rejected nếu là lỗi vĩnh viễn khi verify.
  if (job.type === "verify_hint" && job.hint_id && (permanent || disposition === "failed")) {
    await rest.patch("post_hints", { id: `eq.${job.hint_id}` }, {
      status: "rejected",
      last_error: error,
      updated_at: now,
    });
    if (httpStatus === 404) {
      const payload = (job.payload as Record<string, unknown>) || {};
      const filters: Record<string, string> = {};
      if (payload.techhubId) filters.techhub_id = `eq.${Number(payload.techhubId)}`;
      else if (payload.techhubUuid) filters.techhub_uuid = `eq.${String(payload.techhubUuid)}`;
      if (Object.keys(filters).length > 0) {
        await rest.patch("posts", filters, {
          status: "deleted",
          verification_status: "rejected",
          sync_error: "not_found",
          last_seen_at: now,
        });
      }
    }
  }

  if (job.source_id) {
    await rest.patch("post_sync_sources", { id: `eq.${job.source_id}` }, {
      last_error: error,
      updated_at: now,
      next_check_at: disposition === "retry"
        ? patch.scheduled_at
        : new Date(Date.now() + (disposition === "session_required" ? 30 : 60) * 60 * 1000).toISOString(),
    });
  }

  if (runId) {
    await rest.patch("post_sync_runs", { id: `eq.${runId}` }, {
      finished_at: now,
      outcome: isAuthError ? "session_required" : "failed",
      http_status: httpStatus,
      error_summary: error,
    });
  }

  return json({ ok: true, jobId, disposition });
}

// ---------------- Read actions ----------------

async function handleGetPostSyncStatus(rest: Rest, auth: Auth) {
  requireAdmin(auth);
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const [queue, runs24h, leaderRows, sessionJobs, sources] = await Promise.all([
    rest.getJson<Array<{ status: string; type: string }>>("post_sync_jobs", {
      status: "in.(pending,claimed,running,retry_wait,session_required)",
      select: "id,status,type,scheduled_at,claimed_by_device,lease_until",
      limit: "500",
    }),
    rest.getJson<Array<Record<string, unknown>>>("post_sync_runs", {
      started_at: `gte.${since24h}`,
      select: "outcome,request_count,new_count,updated_count,http_status",
      limit: "1000",
    }),
    rest.getJson<Array<{ device_id: string | null; lease_until: string | null }>>("post_sync_leader_lease", {
      singleton: "eq.true",
      lease_until: `gte.${now.toISOString()}`,
      select: "device_id,lease_until,updated_at",
      limit: "1",
    }),
    rest.getJson<Array<{ id: number }>>("post_sync_jobs", {
      status: "eq.session_required",
      select: "id",
      limit: "100",
    }),
    rest.getJson<Array<Record<string, unknown>>>("post_sync_sources", {
      select: "id,type,source_key,enabled,last_checked_at,next_check_at,last_success_at,last_error,interval_minutes,cursor",
      order: "type,source_key",
      limit: "200",
    }),
  ]);
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const j of queue || []) {
    byStatus[String(j.status)] = (byStatus[String(j.status)] || 0) + 1;
    byType[String(j.type)] = (byType[String(j.type)] || 0) + 1;
  }
  let requestCount24h = 0;
  let newPosts24h = 0;
  let updated24h = 0;
  for (const r of runs24h || []) {
    requestCount24h += Number(r.request_count) || 0;
    newPosts24h += Number(r.new_count) || 0;
    updated24h += Number(r.updated_count) || 0;
  }
  return json({
    serverTime: now.toISOString(),
    queue: byStatus,
    queueByType: byType,
    activeLeaders: (leaderRows || []).map((row) => ({
      claimed_by_device: row.device_id,
      lease_until: row.lease_until,
    })),
    sessionRequiredCount: (sessionJobs || []).length,
    requestCount24h,
    newPosts24h,
    updated24h,
    runs24h: (runs24h || []).length,
    sources: sources || [],
  });
}

async function handleListPostSyncRuns(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  requireAdmin(auth);
  const limit = Math.min(200, Math.max(1, Number(body.limit) || 50));
  const params: Record<string, string> = {
    select: "*",
    order: "started_at.desc",
    limit: String(limit),
  };
  if (body.sourceId) params.source_id = `eq.${Number(body.sourceId)}`;
  if (body.outcome) params.outcome = `eq.${String(body.outcome)}`;
  const runs = await rest.getJson("post_sync_runs", params);
  return json({ runs: runs || [] });
}

async function handleListPostHints(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  requireAdmin(auth);
  const limit = Math.min(200, Math.max(1, Number(body.limit) || 50));
  const params: Record<string, string> = {
    select: "*",
    order: "observed_at.desc",
    limit: String(limit),
  };
  if (body.status) params.status = `eq.${String(body.status)}`;
  if (body.username) params.username = `eq.${String(body.username)}`;
  const hints = await rest.getJson("post_hints", params);
  return json({ hints: hints || [] });
}

async function handleListNewPosts(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  // Cho phép device (máy user thường) đọc bài đã verify của chính họ (cho tab "Bài viết của tôi").
  // Admin xem được toàn bộ.
  const limit = Math.min(500, Math.max(1, Number(body.limit) || 100));
  const offset = Math.max(0, Number(body.offset) || 0);
  const days = Math.min(60, Math.max(1, Number(body.days) || 7));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const params: Record<string, string> = {
    select: "id,techhub_id,techhub_uuid,username,title,status,published_at,created_at,first_seen_at,last_seen_at,last_verified_at,verification_status,discovered_by,community_slug,community_name,url,votes_score,comments_count,medals_count,feed_score,sync_error",
    order: "published_at.desc.nullslast,created_at.desc",
    limit: String(limit),
    offset: String(offset),
  };
  const requestedStatus = auth.kind === "admin" && body.verificationStatus
    ? String(body.verificationStatus)
    : "verified";
  if (!["unverified", "verified", "stale", "rejected"].includes(requestedStatus)) {
    throw new HttpError("verificationStatus không hợp lệ.", 400);
  }
  params.verification_status = `eq.${requestedStatus}`;
  params.or = `(published_at.gte.${since},last_seen_at.gte.${since},last_verified_at.gte.${since})`;
  if (auth.kind === "device" && auth.device?.username) {
    params.username = `eq.${auth.device.username}`;
  } else if (auth.kind === "admin" && body.username) {
    params.username = `eq.${String(body.username)}`;
  } else if (auth.kind !== "admin") {
    requireAdmin(auth);
  }
  if (auth.kind === "admin") {
    if (body.discoveredBy) params.discovered_by = `eq.${String(body.discoveredBy)}`;
    if (body.username) params.username = `eq.${String(body.username)}`;
  }
  const posts = await rest.getJson("posts", params);
  return json({ posts: posts || [] });
}

async function handleListJobs(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  requireAdmin(auth);
  const limit = Math.min(200, Math.max(1, Number(body.limit) || 50));
  const offset = Math.max(0, Number(body.offset) || 0);
  const params: Record<string, string> = {
    select: "*",
    order: "created_at.desc",
    limit: String(limit),
    offset: String(offset),
  };
  if (body.status) params.status = `eq.${String(body.status)}`;
  const jobs = await rest.getJson("post_sync_jobs", params);
  return json({ jobs: jobs || [] });
}

async function handleListRuns(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  requireAdmin(auth);
  const limit = Math.min(200, Math.max(1, Number(body.limit) || 50));
  const offset = Math.max(0, Number(body.offset) || 0);
  const params: Record<string, string> = {
    select: "*",
    order: "started_at.desc",
    limit: String(limit),
    offset: String(offset),
  };
  if (body.jobId) params.job_id = `eq.${Number(body.jobId)}`;
  const runs = await rest.getJson("post_sync_runs", params);
  return json({ runs: runs || [] });
}

async function handleEnqueueJobs(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  requireAdmin(auth);
  // Cùng logic với requestPostSync(feed) + requestPostSync(due_users).
  const results: Array<Record<string, unknown>> = [];
  try {
    const response = await handleRequestPostSync(rest, auth, { scope: "feed", communitySlug: body.communitySlug || "cai-tien-moi-ngay", force: body.force === true });
    const payload = await response.clone().json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(payload.error || `HTTP ${response.status}`));
    results.push({ kind: "feed", ...payload, ok: true });
  } catch (error) {
    results.push({ kind: "feed", ok: false, error: error instanceof Error ? error.message : String(error) });
  }
  try {
    const response = await handleRequestPostSync(rest, auth, { scope: "due_users" });
    const payload = await response.clone().json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(payload.error || `HTTP ${response.status}`));
    results.push({ kind: "due_users", ...payload, ok: true });
  } catch (error) {
    results.push({ kind: "due_users", ok: false, error: error instanceof Error ? error.message : String(error) });
  }
  return json({ ok: true, results });
}

async function handleResubmitHint(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  requireAdmin(auth);
  const hintId = Number(body.hintId);
  if (!Number.isInteger(hintId)) throw new HttpError("hintId không hợp lệ.", 400);
  const hints = await rest.getJson<Array<Record<string, unknown>>>("post_hints", { id: `eq.${hintId}`, limit: "1" });
  const hint = hints?.[0];
  if (!hint) throw new HttpError("Không tìm thấy hint.", 404);
  await rest.patch("post_hints", { id: `eq.${hintId}` }, { status: "pending", updated_at: new Date().toISOString(), attempt_count: 0, last_error: null });
  // Tạo job verify_hint mới.
  const job = await rest.postJson<Record<string, unknown>>(
    "post_sync_jobs",
    {
      type: "verify_hint",
      hint_id: hintId,
      username: hint.username ? String(hint.username) : null,
      payload: {
        techhubUuid: hint.techhub_uuid ? String(hint.techhub_uuid) : null,
        techhubId: hint.techhub_id ? Number(hint.techhub_id) : null,
        url: hint.url ? String(hint.url) : null,
      },
      status: "pending",
      scheduled_at: new Date().toISOString(),
      attempt_count: 0,
      max_attempts: 5,
      idempotency_key: `hint-resubmit:${hintId}:${Date.now()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    "return=representation"
  );
  return json({ ok: true, job });
}

async function handleRetryJob(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  requireAdmin(auth);
  const jobId = Number(body.jobId);
  if (!Number.isInteger(jobId)) throw new HttpError("jobId không hợp lệ.", 400);
  const job = await rest.patchJson<Record<string, unknown>>(
    "post_sync_jobs",
    { id: `eq.${jobId}` },
    { status: "pending", attempt_count: 0, lease_until: null, claimed_by_device: null, claimed_at: null, scheduled_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }
  );
  return json({ ok: true, job: Array.isArray(job) ? job[0] : job });
}

async function handleCancelJob(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  requireAdmin(auth);
  const jobId = Number(body.jobId);
  if (!Number.isInteger(jobId)) throw new HttpError("jobId không hợp lệ.", 400);
  // PATCH không hỗ trợ OR/in filter dễ dàng; đọc trước rồi update các dòng đúng trạng thái.
  const rows = await rest.getJson<Array<{ id: number; status: string }>>("post_sync_jobs", { id: `eq.${jobId}`, select: "id,status", limit: "1" });
  const row = rows?.[0];
  if (!row) throw new HttpError("Không tìm thấy job.", 404);
  if (!["pending", "retry_wait", "session_required"].includes(String(row.status))) {
    throw new HttpError(`Không thể hủy job đang ở trạng thái ${row.status}.`, 400);
  }
  await rest.patch("post_sync_jobs", { id: `eq.${jobId}` }, { status: "cancelled", updated_at: new Date().toISOString() });
  return json({ ok: true });
}

async function handleGetUserSyncStatus(rest: Rest, auth: Auth, body: Record<string, unknown>) {
  requireAdmin(auth);
  const username = String(body.username || "").trim();
  if (!username) throw new HttpError("Thiếu username.", 400);
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const [user, sources, hints, posts, lastRun] = await Promise.all([
    rest.getJson<Array<Record<string, unknown>>>("users", { username: `eq.${username}`, select: "*", limit: "1" }),
    rest.getJson<Array<Record<string, unknown>>>("post_sync_sources", { type: "eq.user", source_key: `eq.${username}`, select: "*", limit: "1" }),
    rest.getJson<Array<Record<string, unknown>>>("post_hints", { username: `eq.${username}`, order: "observed_at.desc", select: "*", limit: "20" }),
    rest.getJson<Array<Record<string, unknown>>>("posts", {
      username: `eq.${username}`,
      order: "created_at.desc",
      select: "techhub_id,title,status,published_at,verification_status,discovered_by,last_verified_at",
      limit: "30",
    }),
    rest.getJson<Array<Record<string, unknown>>>("post_sync_runs", {
      started_at: `gte.${cutoff}`,
      order: "started_at.desc",
      select: "*",
      limit: "1",
    }).then(async (rows) => {
      // Runs không lưu username trực tiếp — join thủ công qua job.
      const runs = (rows || []);
      if (runs.length === 0) return null;
      const last = runs[0];
      if (!last.job_id) return last;
      const j = await rest.getJson<Array<{ username: string }>>("post_sync_jobs", { id: `eq.${last.job_id}`, username: `eq.${username}`, select: "username", limit: "1" });
      return j && j.length > 0 ? last : null;
    }),
  ]);
  return json({
    username,
    user: (user || [])[0] || null,
    source: (sources || [])[0] || null,
    recentHints: hints || [],
    recentPosts: posts || [],
    lastRun,
  });
}

async function handleListActiveUsernames(rest: Rest, auth: Auth) {
  requireAdmin(auth);
  const users = await rest.getJson<Array<{ username: string }>>("users", {
    is_locked: "eq.false",
    select: "username",
    order: "username.asc",
    limit: "10000",
  });
  return json({ usernames: (users || []).map((user) => user.username).filter(Boolean) });
}

// ---------------- Router ----------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY." }, 500);
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
  const bearer = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (bearer) {
    const callerKey = await sha256Hex(`ps:${bearer}`);
    const limit = bearer === Deno.env.get("ADMIN_TOKEN") ? RATE_LIMIT_MAX_ADMIN : RATE_LIMIT_MAX_HINT;
    if (isRateLimited(callerKey, limit)) {
      return json({ error: "Quá nhiều request, thử lại sau." }, 429);
    }
  }

  try {
    const auth = await resolveAuth(req, rest);
    switch (action) {
      case "submitPostHint":    return await handleSubmitPostHint(rest, auth, body);
      case "requestPostSync":   return await handleRequestPostSync(rest, auth, body);
      case "saveScannedPosts":  return await handleSaveScannedPosts(rest, auth, body);
      case "saveMyScannedPosts": return await handleSaveMyScannedPosts(rest, auth, body);
      case "reconcileMyScannedPosts": return await handleReconcileMyScannedPosts(rest, auth, body);
      case "claimPostSyncJob":  return await handleClaimPostSyncJob(rest, auth, body);
      case "startPostSyncRun":  return await handleStartPostSyncRun(rest, auth, body);
      case "extendPostSyncLease": return await handleExtendPostSyncLease(rest, auth, body);
      case "completePostSyncJob": return await handleCompletePostSyncJob(rest, auth, body);
      case "failPostSyncJob":   return await handleFailPostSyncJob(rest, auth, body);
      case "getPostSyncStatus": return await handleGetPostSyncStatus(rest, auth);
      case "getStatus":         return await handleGetPostSyncStatus(rest, auth);
      case "listPostSyncRuns":  return await handleListPostSyncRuns(rest, auth, body);
      case "listRuns":          return await handleListRuns(rest, auth, body);
      case "listPostHints":     return await handleListPostHints(rest, auth, body);
      case "listHints":         return await handleListPostHints(rest, auth, body);
      case "listNewPosts":      return await handleListNewPosts(rest, auth, body);
      case "getUserSyncStatus": return await handleGetUserSyncStatus(rest, auth, body);
      case "listActiveUsernames": return await handleListActiveUsernames(rest, auth);
      case "listJobs":          return await handleListJobs(rest, auth, body);
      case "enqueueJobs":       return await handleEnqueueJobs(rest, auth, body);
      case "resubmitHint":      return await handleResubmitHint(rest, auth, body);
      case "retryJob":          return await handleRetryJob(rest, auth, body);
      case "cancelJob":         return await handleCancelJob(rest, auth, body);
      default: return json({ error: `Action không hỗ trợ: ${action}` }, 400);
    }
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error("[post-sync-api] Unhandled:", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
