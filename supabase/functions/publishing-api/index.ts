// Supabase Edge Function: publishing-api
//
// Kho bài AI + duyệt revision + phân lịch đăng (R5, PLAN_PRODUCT_9_10.md
// mục 6.2, 6.3, 6.4, 17.3, 19.1). Domain đăng bài tách khỏi post-sync-api;
// publishing_jobs/publishing_runs và worker thực thi thuộc R6.
//
// Deploy:
//   supabase functions deploy publishing-api --no-verify-jwt
//   supabase secrets set ADMIN_TOKEN=<dùng-chung-với-admin-api>
//
// Phân quyền:
//   - Authorization: Bearer <ADMIN_TOKEN>  → admin (kho, duyệt, phân lịch)
//   - Authorization: Bearer <device-token> → user (xem lịch của mình,
//     Chấp nhận / Từ chối bản sắp đăng). Device token do extension tự sinh,
//     server chỉ lưu SHA-256 hash trong engagement_devices (chia sẻ với
//     engagement-api theo đúng model device enrollment R1).
//
// Bảo mật bắt buộc (mục 6.2, 7.4):
//   - Server KHÔNG nhận cookie hoặc CSRF TechHub; extension là nơi thực thi.
//   - Không log token, không trả secret về response.
//   - Mọi device action lấy username từ device đã đăng ký, không tin
//     username do request body truyền lên.

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
const RATE_LIMIT_MAX = Number(Deno.env.get("PUBLISHING_RATE_LIMIT") || 60);
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

async function sha256Hex(text: string): Promise<string> {
  const data = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(data)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Giờ Việt Nam (UTC+7, không DST) — dùng cho quota/ngày và quiet hours.
function vnShifted(date: Date): Date {
  return new Date(date.getTime() + 7 * 3600 * 1000);
}
function vnDayKey(date: Date): string {
  return vnShifted(date).toISOString().slice(0, 10);
}
function vnLocalHour(date: Date): number {
  return vnShifted(date).getUTCHours();
}

class HttpError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "REQUEST_REJECTED") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Rest = {
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
  rpc: <T = unknown>(fn: string, payload: unknown) => Promise<T>;
};

function createRest(supabaseUrl: string, serviceRoleKey: string): Rest {
  const base = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1`;
  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  async function throwIfError(res: Response, label: string) {
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new HttpError(
        `${label} (HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ""})`,
        502
      );
    }
  }
  return {
    getJson: async (table, params = {}) => {
      const query = new URLSearchParams(params).toString();
      const res = await fetch(`${base}/${table}${query ? `?${query}` : ""}`, {
        headers,
      });
      await throwIfError(res, `Đọc ${table} thất bại`);
      return (await res.json()) as never;
    },
    post: async (table, payload, extraPrefer) => {
      return fetch(`${base}/${table}`, {
        method: "POST",
        headers: {
          ...headers,
          ...(extraPrefer ? { Prefer: extraPrefer } : {}),
        },
        body: JSON.stringify(payload),
      });
    },
    postJson: async (table, payload, extraPrefer) => {
      const res = await fetch(`${base}/${table}`, {
        method: "POST",
        headers: {
          ...headers,
          ...(extraPrefer ? { Prefer: extraPrefer } : {}),
        },
        body: JSON.stringify(payload),
      });
      await throwIfError(res, `Ghi ${table} thất bại`);
      return (await res.json()) as never;
    },
    patch: async (table, params, payload) => {
      const query = new URLSearchParams(params).toString();
      return fetch(`${base}/${table}?${query}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(payload),
      });
    },
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
  label: string | null;
  token_hash: string;
  revoked: boolean;
  enrollment_status: string;
  last_seen_at: string | null;
};

type Auth =
  | { kind: "admin" }
  | { kind: "device"; device: Device }
  | { kind: "none" };

async function resolveAuth(
  req: Request,
  rest: Rest
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
    select: "id,device_id,username,label,token_hash,revoked,enrollment_status,last_seen_at",
    limit: "1",
  });
  const device = rows?.[0];
  if (!device) {
    return { kind: "none" };
  }
  if (device.revoked) {
    throw new HttpError("Thiết bị đã bị thu hồi. Cần đăng ký lại.", 403, "DEVICE_REVOKED");
  }
  return { kind: "device", device };
}

function requireAdmin(auth: Auth): void {
  if (auth.kind !== "admin") {
    throw new HttpError("Unauthorized (cần ADMIN_TOKEN).", 401);
  }
}

function requireDevice(auth: Auth): Device {
  if (auth.kind !== "device") {
    throw new HttpError("Unauthorized (thiếu device token).", 401);
  }
  if (auth.device.enrollment_status !== "approved") {
    throw new HttpError("Thiết bị đang chờ duyệt.", 403, "DEVICE_ENROLLMENT_REQUIRED");
  }
  return auth.device;
}

function firstRow<T>(rows: T[] | T | null): T | null {
  if (!rows) return null;
  return Array.isArray(rows) ? rows[0] ?? null : rows;
}

function toPositiveInt(value: unknown): number | null {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function clampSetting(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

async function readSetting(rest: Rest, key: string): Promise<unknown> {
  const rows = await rest.getJson<Array<{ value: unknown }>>("settings", {
    key: `eq.${key}`,
    select: "value",
    limit: "1",
  });
  return rows?.[0]?.value;
}

// ---------------------------------------------------------------------------
// Content hash — chống trùng kho (mục 19.1): gồm title, body, description,
// community, terms, body_type và ảnh tùy chọn; chuẩn hóa whitespace để bắt
// trùng tuyệt đối.
// ---------------------------------------------------------------------------

function normalizeText(text: unknown): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

async function computeContentHash(input: {
  title: string;
  body: string;
  description: string;
  communityId: number;
  termIds: number[];
  bodyType: string;
  mainImage: string | null;
}): Promise<string> {
  const parts = [
    normalizeText(input.title).toLowerCase(),
    normalizeText(input.body),
    normalizeText(input.description),
    String(input.communityId),
    [...input.termIds].sort((a, b) => a - b).join(","),
    input.bodyType,
    input.mainImage ? String(input.mainImage).trim() : "",
  ];
  return sha256Hex(parts.join("\n"));
}

type PresetRow = {
  id: number;
  name: string;
  community_id: number;
  term_ids: number[];
  body_type: string;
  default_description: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

async function getPresetById(rest: Rest, presetId: number): Promise<PresetRow | null> {
  const rows = await rest.getJson<PresetRow[]>("content_presets", {
    id: `eq.${presetId}`,
    select: "*",
    limit: "1",
  });
  return firstRow(rows);
}

type ValidatedContent = {
  title: string;
  body: string;
  description: string;
  mainImage: string | null;
  featured: boolean;
};

/** Validate một item nội dung; trả lỗi kèm tên field (mục 17.3 bước 3). */
function validateContentItem(
  raw: Record<string, unknown>,
  index: number
): ValidatedContent {
  const fail = (field: string, message: string) => {
    throw new HttpError(`item[${index}].${field}: ${message}`, 400, "CONTENT_INVALID");
  };
  const title = String(raw.title ?? "").trim();
  if (!title) fail("title", "không được để trống.");
  if (title.length > 200) fail("title", "dài hơn 200 ký tự.");
  const body = String(raw.body ?? "").trim();
  if (!body) fail("body", "không được để trống.");
  if (body.length > 50000) fail("body", "dài hơn 50000 ký tự.");
  const description = String(raw.description ?? "").trim();
  if (description.length > 500) fail("description", "dài hơn 500 ký tự.");
  const mainImageRaw = String(raw.mainImage ?? raw.mainImageId ?? "").trim();
  if (mainImageRaw.length > 500) fail("mainImage", "đường dẫn ảnh dài hơn 500 ký tự.");
  const featured = raw.featured === true;
  return {
    title,
    body,
    description,
    mainImage: mainImageRaw || null,
    featured,
  };
}

// ---------------------------------------------------------------------------
// Quiet hours (mục 19.1): lịch nằm trong giờ yên lặng → yêu cầu chọn giờ khác
// TRƯỚC KHI lưu. Shape: {enabled, timezone, startHour, endHour}.
// ---------------------------------------------------------------------------

type ConsentRow = {
  username: string;
  engagement_enabled: boolean;
  auto_publish_enabled: boolean;
  paused_at: string | null;
  quiet_hours: Record<string, unknown>;
};

async function getConsent(rest: Rest, username: string): Promise<ConsentRow | null> {
  const rows = await rest.getJson<ConsentRow[]>("user_consents", {
    username: `eq.${username}`,
    select:
      "username,engagement_enabled,auto_publish_enabled,paused_at,quiet_hours",
    limit: "1",
  });
  return firstRow(rows);
}

function quietHoursConflict(
  quietHours: Record<string, unknown> | null | undefined,
  scheduledAt: Date
): { startHour: number; endHour: number } | null {
  if (!quietHours || quietHours.enabled !== true) return null;
  const startHour = Number(quietHours.startHour);
  const endHour = Number(quietHours.endHour);
  if (
    !Number.isInteger(startHour) || !Number.isInteger(endHour) ||
    startHour < 0 || startHour > 23 || endHour < 0 || endHour > 23
  ) {
    return null; // Chưa cấu hình khung giờ cụ thể — không chặn mù.
  }
  const hour = vnLocalHour(scheduledAt);
  const inWindow = startHour <= endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour; // qua nửa đêm, vd 22→6.
  return inWindow ? { startHour, endHour } : null;
}

async function getUsernamesActive(rest: Rest): Promise<Set<string>> {
  const rows = await rest.getJson<Array<{ username: string }>>("users", {
    is_locked: "eq.false",
    select: "username",
    limit: "10000",
  });
  return new Set((rows || []).map((row) => row.username).filter(Boolean));
}

// ---------------------------------------------------------------------------
// Admin: preset
// ---------------------------------------------------------------------------

async function handleListContentPresets(rest: Rest) {
  const presets = await rest.getJson<PresetRow[]>("content_presets", {
    select: "*",
    order: "name.asc",
    limit: "200",
  });
  return json({ ok: true, presets: presets || [] });
}

async function handleSaveContentPreset(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const name = String(body.name || "").trim().slice(0, 120);
  if (!name) throw new HttpError("Tên preset không được để trống.", 400);
  const communityId = toPositiveInt(body.communityId);
  if (!communityId) throw new HttpError("communityId không hợp lệ.", 400);
  const termIds = Array.isArray(body.termIds)
    ? [...new Set(body.termIds.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0))].slice(0, 50)
    : [];
  const bodyType = ["markdown", "plain"].includes(String(body.bodyType || ""))
    ? String(body.bodyType)
    : "markdown";
  const defaultDescription = String(body.defaultDescription || "").slice(0, 500);
  const enabled = body.enabled !== false;
  const presetId = toPositiveInt(body.presetId);
  const nowIso = new Date().toISOString();

  if (presetId) {
    const res = await rest.patch(
      "content_presets",
      { id: `eq.${presetId}` },
      {
        name,
        community_id: communityId,
        term_ids: termIds,
        body_type: bodyType,
        default_description: defaultDescription,
        enabled,
        updated_at: nowIso,
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new HttpError(
        text.includes("duplicate key")
          ? `Preset "${name}" đã tồn tại.`
          : `Không cập nhật được preset (HTTP ${res.status}).`,
        text.includes("duplicate key") ? 409 : 500
      );
    }
    return json({ ok: true, presetId });
  }
  const created = await rest.postJson<Array<{ id: number }>>("content_presets", {
    name,
    community_id: communityId,
    term_ids: termIds,
    body_type: bodyType,
    default_description: defaultDescription,
    enabled,
  });
  const row = firstRow(created);
  return json({ ok: true, presetId: row?.id ?? null });
}

// ---------------------------------------------------------------------------
// Admin: nhập kho (import batch — all-or-nothing, mục 17.3 bước 2–3)
// ---------------------------------------------------------------------------

type ImportItemError = { index: number; field: string | null; message: string };

async function handleImportContentBatch(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const dryRun = body.dryRun === true;
  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || items.length === 0) {
    throw new HttpError("Cần mảng items không rỗng.", 400, "CONTENT_INVALID");
  }
  const maxItems = clampSetting(
    await readSetting(rest, "publishing_batch_max_items"), 20, 1, 200
  );
  if (items.length > maxItems) {
    throw new HttpError(
      `Tối đa ${maxItems} bài mỗi batch (nhận ${items.length}).`,
      400,
      "BATCH_TOO_LARGE"
    );
  }
  const maxBytes = clampSetting(
    await readSetting(rest, "publishing_batch_max_bytes"), 1048576, 1000, 10_000_000
  );
  const encodedLength = new TextEncoder().encode(JSON.stringify(items)).length;
  if (encodedLength > maxBytes) {
    throw new HttpError(
      `Batch lớn hơn ${Math.round(maxBytes / 1024)} KB.`,
      400,
      "BATCH_TOO_LARGE"
    );
  }

  const presets = await rest.getJson<PresetRow[]>("content_presets", {
    enabled: "eq.true",
    select: "*",
    order: "name.asc",
    limit: "200",
  });
  const presetById = new Map((presets || []).map((p) => [p.id, p]));
  const presetByName = new Map((presets || []).map((p) => [p.name.toLowerCase(), p]));
  const defaultPresetId = toPositiveInt(body.defaultPresetId);

  const errors: ImportItemError[] = [];
  const validItems: Array<{
    index: number;
    preset: PresetRow;
    content: ValidatedContent;
    contentHash: string;
  }> = [];
  const seenHashes = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push({ index: i, field: null, message: "mỗi item phải là object." });
      continue;
    }
    try {
      const presetRef = raw.presetId ?? raw.preset;
      let preset: PresetRow | null = null;
      const byId = toPositiveInt(presetRef);
      if (byId) preset = presetById.get(byId) ?? null;
      if (!preset && typeof presetRef === "string") {
        preset = presetByName.get(presetRef.trim().toLowerCase()) ?? null;
      }
      if (!preset) preset = defaultPresetId ? presetById.get(defaultPresetId) ?? null : null;
      if (!preset) {
        throw new HttpError(
          `item[${i}].preset: preset không tồn tại hoặc đang tắt.`,
          400,
          "CONTENT_INVALID"
        );
      }
      const content = validateContentItem(raw as Record<string, unknown>, i);
      const contentHash = await computeContentHash({
        title: content.title,
        body: content.body,
        description: content.description,
        communityId: preset.community_id,
        termIds: preset.term_ids || [],
        bodyType: preset.body_type,
        mainImage: content.mainImage,
      });
      if (seenHashes.has(contentHash)) {
        throw new HttpError(
          `item[${i}]: trùng nội dung với một item khác trong batch.`,
          400,
          "DUPLICATE_CONTENT"
        );
      }
      seenHashes.add(contentHash);
      validItems.push({ index: i, preset, content, contentHash });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fieldMatch = message.match(/^item\[\d+\]\.(\w+):/);
      errors.push({
        index: i,
        field: fieldMatch ? fieldMatch[1] : null,
        message,
      });
    }
  }

  // Chống trùng với kho hiện có: hash đã tồn tại → lỗi (không âm thầm bỏ).
  if (validItems.length > 0) {
    const existing = await rest.getJson<Array<{ id: number; content_hash: string; title: string }>>(
      "content_items",
      {
        content_hash: `in.(${validItems.map((item) => item.contentHash).join(",")})`,
        select: "id,content_hash,title",
        limit: String(maxItems),
      }
    );
    const existingByHash = new Map((existing || []).map((row) => [row.content_hash, row]));
    for (const item of [...validItems]) {
      const dup = existingByHash.get(item.contentHash);
      if (dup) {
        errors.push({
          index: item.index,
          field: null,
          message: `đã tồn tại trong kho (item #${dup.id} "${dup.title}").`,
        });
        validItems.splice(validItems.indexOf(item), 1);
      }
    }
  }

  if (errors.length > 0) {
    // All-or-nothing: có lỗi thì không import gì (mục 17.3).
    return json({
      ok: false,
      dryRun,
      imported: [],
      valid: validItems.length,
      errors,
      message:
        "Batch có lỗi nên chưa nhập gì. Bỏ các item lỗi rồi Kiểm tra lại; không item nào bị bỏ âm thầm.",
    }, 400);
  }

  if (dryRun) {
    return json({
      ok: true,
      dryRun: true,
      valid: validItems.length,
      errors: [],
      preview: validItems.map((item) => ({
        index: item.index,
        title: item.content.title,
        preset: item.preset.name,
      })),
    });
  }

  const createdBy = String(body.createdBy || "admin").slice(0, 100);
  const payload = validItems.map((item) => ({
    preset_id: item.preset.id,
    title: item.content.title,
    body: item.content.body,
    description: item.content.description,
    main_image: item.content.mainImage,
    featured: item.content.featured,
    content_hash: item.contentHash,
    status: "review",
    ai_model: String(body.aiModel || "").slice(0, 120) || null,
    prompt_version: String(body.promptVersion || "").slice(0, 40) || null,
    generated_by: String(body.generatedBy || "ai-external").slice(0, 100),
    created_by: createdBy,
  }));
  const inserted = await rest.postJson<Array<{ id: number; title: string }>>(
    "content_items",
    payload
  );
  return json({
    ok: true,
    dryRun: false,
    valid: validItems.length,
    errors: [],
    imported: (inserted || []).map((row) => ({ id: row.id, title: row.title })),
  });
}

// ---------------------------------------------------------------------------
// Admin: draft đơn lẻ (create/update) + duyệt/từ chối/lưu trữ
// ---------------------------------------------------------------------------

async function loadContentItem(
  rest: Rest,
  contentItemId: number
): Promise<Record<string, unknown> & { id: number; status: string }> {
  const rows = await rest.getJson<Array<Record<string, unknown> & { id: number; status: string }>>(
    "content_items",
    { id: `eq.${contentItemId}`, select: "*", limit: "1" }
  );
  const item = firstRow(rows);
  if (!item) throw new HttpError(`Không tìm thấy bài #${contentItemId}.`, 404);
  return item;
}

async function checkSimilarTitles(
  rest: Rest,
  title: string,
  excludeItemId: number | null
): Promise<Array<{ id: number; title: string; status: string }>> {
  const normalized = normalizeText(title).toLowerCase();
  if (!normalized) return [];
  const like = encodeURIComponent(`%${normalized.slice(0, 80)}%`);
  const rows = await rest.getJson<Array<{ id: number; title: string; status: string }>>(
    "content_items",
    {
      title: `ilike.${like}`,
      select: "id,title,status",
      limit: "10",
    }
  );
  return (rows || []).filter(
    (row) =>
      row.id !== excludeItemId &&
      normalizeText(row.title).toLowerCase() === normalized
  );
}

async function handleCreateContentDraft(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const presetId = toPositiveInt(body.presetId);
  const preset = presetId ? await getPresetById(rest, presetId) : null;
  if (!preset || !preset.enabled) {
    throw new HttpError("Preset không tồn tại hoặc đang tắt.", 400);
  }
  const content = validateContentItem(body as Record<string, unknown>, 0);
  const contentHash = await computeContentHash({
    title: content.title,
    body: content.body,
    description: content.description,
    communityId: preset.community_id,
    termIds: preset.term_ids || [],
    bodyType: preset.body_type,
    mainImage: content.mainImage,
  });
  const existing = await rest.getJson<Array<{ id: number }>>("content_items", {
    content_hash: `eq.${contentHash}`,
    select: "id",
    limit: "1",
  });
  if (firstRow(existing)) {
    throw new HttpError(
      "Bài giống hệt đã có trong kho (hash trùng).",
      409,
      "DUPLICATE_CONTENT"
    );
  }
  const inserted = await rest.postJson<Array<{ id: number }>>("content_items", {
    preset_id: preset.id,
    title: content.title,
    body: content.body,
    description: content.description,
    main_image: content.mainImage,
    featured: content.featured,
    content_hash: contentHash,
    status: "draft",
    generated_by: String(body.generatedBy || "admin").slice(0, 100),
    created_by: String(body.createdBy || "admin").slice(0, 100),
  });
  const item = firstRow(inserted);
  const warnings = await checkSimilarTitles(rest, content.title, item?.id ?? null);
  return json({ ok: true, contentItemId: item?.id ?? null, warnings });
}

async function handleUpdateContentDraft(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const contentItemId = toPositiveInt(body.contentItemId);
  if (!contentItemId) throw new HttpError("contentItemId không hợp lệ.", 400);
  const item = await loadContentItem(rest, contentItemId);
  // Chỉ chỉnh được bản chưa duyệt; bài đã approved nằm ở revision bất biến.
  if (!["draft", "review", "rejected"].includes(String(item.status))) {
    throw new HttpError(
      `Bài đang ở trạng thái ${item.status}; bản đã duyệt nằm ở revision, không sửa trực tiếp.`,
      409,
      "CONTENT_LOCKED"
    );
  }
  const presetId = toPositiveInt(body.presetId) ?? Number(item.preset_id);
  const preset = await getPresetById(rest, presetId);
  if (!preset) throw new HttpError("Preset không tồn tại.", 400);
  const content = validateContentItem(body as Record<string, unknown>, 0);
  const contentHash = await computeContentHash({
    title: content.title,
    body: content.body,
    description: content.description,
    communityId: preset.community_id,
    termIds: preset.term_ids || [],
    bodyType: preset.body_type,
    mainImage: content.mainImage,
  });
  const existing = await rest.getJson<Array<{ id: number }>>("content_items", {
    content_hash: `eq.${contentHash}`,
    id: `neq.${contentItemId}`,
    select: "id",
    limit: "1",
  });
  if (firstRow(existing)) {
    throw new HttpError(
      "Nội dung sửa ra trùng bài khác trong kho (hash trùng).",
      409,
      "DUPLICATE_CONTENT"
    );
  }
  const res = await rest.patch(
    "content_items",
    { id: `eq.${contentItemId}` },
    {
      preset_id: preset.id,
      title: content.title,
      body: content.body,
      description: content.description,
      main_image: content.mainImage,
      featured: content.featured,
      content_hash: contentHash,
      status: "draft",
      rejection_reason: null,
      updated_at: new Date().toISOString(),
    }
  );
  if (!res.ok) throw new HttpError(`Không lưu được bản nháp (HTTP ${res.status}).`, 500);
  const warnings = await checkSimilarTitles(rest, content.title, contentItemId);
  return json({ ok: true, warnings });
}

async function handleApproveContent(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const contentItemId = toPositiveInt(body.contentItemId);
  if (!contentItemId) throw new HttpError("contentItemId không hợp lệ.", 400);
  const item = await loadContentItem(rest, contentItemId);
  if (String(item.status) === "archived") {
    throw new HttpError("Bài đã lưu trữ, không duyệt được.", 409, "CONTENT_LOCKED");
  }
  const preset = await getPresetById(rest, Number(item.preset_id));
  if (!preset) throw new HttpError("Preset của bài không còn tồn tại.", 400);
  const contentHash = await computeContentHash({
    title: String(item.title),
    body: String(item.body),
    description: String(item.description ?? ""),
    communityId: preset.community_id,
    termIds: preset.term_ids || [],
    bodyType: preset.body_type,
    mainImage: item.main_image ? String(item.main_image) : null,
  });

  // Idempotent: duyệt lại bản chưa đổi gì → trả revision hiện có.
  if (
    String(item.status) === "approved" &&
    item.current_revision_id &&
    String(item.content_hash) === contentHash
  ) {
    return json({ ok: true, revisionId: item.current_revision_id, unchanged: true });
  }

  const revisionRows = await rest.getJson<Array<{ revision_number: number }>>(
    "content_revisions",
    {
      content_item_id: `eq.${contentItemId}`,
      select: "revision_number",
      order: "revision_number.desc",
      limit: "1",
    }
  );
  const nextNumber = (firstRow(revisionRows)?.revision_number || 0) + 1;
  const approvedBy = String(body.approvedBy || "admin").slice(0, 100);
  const nowIso = new Date().toISOString();

  // Revision bất biến: snapshot đủ trường để schedule không đọc draft.
  const insertedRevision = await rest.postJson<Array<{ id: number }>>(
    "content_revisions",
    {
      content_item_id: contentItemId,
      revision_number: nextNumber,
      preset_id: preset.id,
      preset_name: preset.name,
      title: String(item.title),
      body: String(item.body),
      description: String(item.description ?? ""),
      main_image: item.main_image ? String(item.main_image) : null,
      featured: item.featured === true,
      community_id: preset.community_id,
      term_ids: preset.term_ids || [],
      body_type: preset.body_type,
      content_hash: contentHash,
      approved_by: approvedBy,
      approved_at: nowIso,
    }
  );
  const revision = firstRow(insertedRevision);
  if (!revision) throw new HttpError("Không tạo được revision.", 500);
  const res = await rest.patch(
    "content_items",
    { id: `eq.${contentItemId}` },
    {
      status: "approved",
      current_revision_id: revision.id,
      content_hash: contentHash,
      approved_by: approvedBy,
      approved_at: nowIso,
      rejection_reason: null,
      updated_at: nowIso,
    }
  );
  if (!res.ok) throw new HttpError(`Không cập nhật được bài (HTTP ${res.status}).`, 500);
  return json({ ok: true, revisionId: revision.id, revisionNumber: nextNumber });
}

async function handleRejectContent(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const contentItemId = toPositiveInt(body.contentItemId);
  if (!contentItemId) throw new HttpError("contentItemId không hợp lệ.", 400);
  const item = await loadContentItem(rest, contentItemId);
  if (String(item.status) === "archived") {
    throw new HttpError("Bài đã lưu trữ.", 409, "CONTENT_LOCKED");
  }
  const res = await rest.patch(
    "content_items",
    { id: `eq.${contentItemId}` },
    {
      status: "rejected",
      rejection_reason: String(body.reason || "").slice(0, 500) || null,
      updated_at: new Date().toISOString(),
    }
  );
  if (!res.ok) throw new HttpError(`Không từ chối được (HTTP ${res.status}).`, 500);
  return json({ ok: true });
}

async function handleArchiveContent(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const contentItemId = toPositiveInt(body.contentItemId);
  if (!contentItemId) throw new HttpError("contentItemId không hợp lệ.", 400);
  const res = await rest.patch(
    "content_items",
    { id: `eq.${contentItemId}` },
    { status: "archived", updated_at: new Date().toISOString() }
  );
  if (!res.ok) throw new HttpError(`Không lưu trữ được (HTTP ${res.status}).`, 500);
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Admin: kho + lịch
// ---------------------------------------------------------------------------

async function handleListContentLibrary(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const status = ["draft", "review", "approved", "rejected", "archived"].includes(
    String(body.status || "")
  )
    ? String(body.status)
    : null;
  const limit = clampSetting(body.limit, 50, 1, 200);
  const offset = clampSetting(body.offset, 0, 0, 100000);
  const params: Record<string, string> = {
    select: "id,preset_id,title,description,status,current_revision_id,content_hash,featured,main_image,updated_at,created_at,approved_at,rejection_reason",
    order: "updated_at.desc",
    limit: String(limit),
    offset: String(offset),
  };
  if (status) params.status = `eq.${status}`;
  const items = await rest.getJson<Array<Record<string, unknown>>>(
    "content_items",
    params
  );
  const ids = (items || []).map((item) => Number(item.id)).join(",");
  const schedules = ids
    ? await rest.getJson<
        Array<{
          id: number;
          content_item_id: number;
          content_revision_id: number;
          target_username: string;
          scheduled_at: string;
          status: string;
        }>
      >("publishing_schedules", {
          content_item_id: `in.(${ids})`,
          status: "in.(active,paused)",
          select: "id,content_item_id,content_revision_id,target_username,scheduled_at,status",
          order: "scheduled_at.asc",
          limit: "500",
        })
    : [];
  const scheduleByItem = new Map<number, unknown>();
  for (const schedule of schedules || []) {
    if (!scheduleByItem.has(schedule.content_item_id)) {
      scheduleByItem.set(schedule.content_item_id, schedule);
    }
  }
  return json({
    ok: true,
    items: (items || []).map((item) => {
      const schedule = scheduleByItem.get(Number(item.id)) || null;
      return {
        ...item,
        scheduled: schedule
          ? {
              scheduleId: schedule.id,
              targetUsername: schedule.target_username,
              scheduledAt: schedule.scheduled_at,
              status: schedule.status,
            }
          : null,
      };
    }),
    limit,
    offset,
  });
}

async function handleGetContentItem(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const contentItemId = toPositiveInt(body.contentItemId);
  if (!contentItemId) throw new HttpError("contentItemId không hợp lệ.", 400);
  const item = await loadContentItem(rest, contentItemId);
  const revisions = await rest.getJson<Array<Record<string, unknown>>>(
    "content_revisions",
    {
      content_item_id: `eq.${contentItemId}`,
      select: "id,revision_number,title,approved_by,approved_at,created_at",
      order: "revision_number.desc",
      limit: "50",
    }
  );
  return json({ ok: true, item, revisions: revisions || [] });
}

// ---------------------------------------------------------------------------
// Admin: phân bài + lịch tuần (mục 17.3 bước 5–6, 19.1)
// ---------------------------------------------------------------------------

type ScheduleRow = {
  id: number;
  content_item_id: number;
  content_revision_id: number;
  target_username: string;
  scheduled_at: string;
  timezone: string;
  late_policy: string;
  late_window_minutes: number;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

function parseScheduledAt(raw: unknown): Date {
  const text = String(raw || "").trim();
  const date = text ? new Date(text) : null;
  if (!date || !Number.isFinite(date.getTime())) {
    throw new HttpError("scheduledAt không hợp lệ (cần ISO hoặc giờ địa phương).", 400);
  }
  return date;
}

async function assertScheduleTimeOk(
  rest: Rest,
  targetUsername: string,
  scheduledAt: Date
): Promise<void> {
  if (scheduledAt.getTime() <= Date.now() + 60_000) {
    throw new HttpError(
      "Giờ đăng phải ở tương lai (cách hiện tại ít nhất 1 phút).",
      400,
      "SCHEDULE_IN_PAST"
    );
  }
  const consent = await getConsent(rest, targetUsername);
  const conflict = quietHoursConflict(consent?.quiet_hours, scheduledAt);
  if (conflict) {
    throw new HttpError(
      `Giờ đăng nằm trong giờ yên lặng của @${targetUsername} (${conflict.startHour}h–${conflict.endHour}h). Chọn giờ khác.`,
      400,
      "QUIET_HOURS_CONFLICT"
    );
  }
}

async function handleScheduleContent(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const contentItemId = toPositiveInt(body.contentItemId);
  if (!contentItemId) throw new HttpError("contentItemId không hợp lệ.", 400);
  const targetUsername = String(body.targetUsername || "").trim().slice(0, 100);
  if (!targetUsername) throw new HttpError("targetUsername không được để trống.", 400);
  const scheduledAt = parseScheduledAt(body.scheduledAt);

  const item = await loadContentItem(rest, contentItemId);
  // Nội dung chưa approved không được lập lịch (Phase 3 / R5).
  if (String(item.status) !== "approved" || !item.current_revision_id) {
    throw new HttpError(
      "Chỉ bài đã duyệt mới được phân lịch. Duyệt để tạo revision trước.",
      409,
      "APPROVAL_REQUIRED"
    );
  }
  const revisionId = Number(item.current_revision_id);

  const activeUsers = await getUsernamesActive(rest);
  if (!activeUsers.has(targetUsername)) {
    throw new HttpError(
      `@${targetUsername} không có trong hệ thống hoặc đã bị khóa.`,
      404,
      "USER_NOT_FOUND"
    );
  }

  await assertScheduleTimeOk(rest, targetUsername, scheduledAt);

  // Pilot: mỗi user tối đa N bài/ngày (mặc định 1, mục 17.3).
  const maxPerDay = clampSetting(
    await readSetting(rest, "publishing_max_schedules_per_user_day"), 1, 1, 10
  );
  const dayStart = new Date(
    new Date(vnShifted(scheduledAt)).setUTCHours(0, 0, 0, 0).getTime() - 7 * 3600 * 1000
  );
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
  const sameDay = await rest.getJson<Array<{ id: number }>>("publishing_schedules", {
    target_username: `eq.${targetUsername}`,
    status: "in.(active,paused)",
    scheduled_at: `gte.${dayStart.toISOString()}`,
    and: `(scheduled_at.lt.${dayEnd.toISOString()})`,
    select: "id",
    limit: String(maxPerDay + 1),
  });
  if ((sameDay || []).length >= maxPerDay) {
    throw new HttpError(
      `@${targetUsername} đã có ${sameDay.length} lịch trong ngày này (pilot tối đa ${maxPerDay}/ngày).`,
      409,
      "QUOTA_EXCEEDED"
    );
  }

  const latePolicy = ["publish_within_window", "skip_when_late", "manual_review"].includes(
    String(body.latePolicy || "")
  )
    ? String(body.latePolicy)
    : "manual_review";
  const lateWindowMinutes = clampSetting(body.lateWindowMinutes, 120, 5, 1440);

  let inserted: Array<{ id: number }> = [];
  try {
    inserted = await rest.postJson<Array<{ id: number }>>("publishing_schedules", {
      content_item_id: contentItemId,
      content_revision_id: revisionId,
      target_username: targetUsername,
      scheduled_at: scheduledAt.toISOString(),
      timezone: "Asia/Ho_Chi_Minh",
      late_policy: latePolicy,
      late_window_minutes: lateWindowMinutes,
      status: "active",
      created_by: String(body.createdBy || "admin").slice(0, 100),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("uq_publishing_schedules_active_revision")) {
      throw new HttpError(
        "Bản này đã được phân cho lịch khác còn hiệu lực. Hai admin không thể reserve cùng một revision.",
        409,
        "REVISION_ALREADY_SCHEDULED"
      );
    }
    if (message.includes("uq_publishing_schedules_active_item_user")) {
      throw new HttpError(
        `@${targetUsername} đã có lịch cho bài này còn hiệu lực.`,
        409,
        "SCHEDULE_ALREADY_EXISTS"
      );
    }
    throw error;
  }
  const schedule = firstRow(inserted);
  if (!schedule) throw new HttpError("Không tạo được lịch.", 500);

  // Yêu cầu approval của target user (pending) — không giả lập approval hộ user.
  await rest.post(
    "content_revision_approvals",
    {
      revision_id: revisionId,
      target_username: targetUsername,
      decision: "pending",
    },
    "resolution=ignore-duplicates"
  );

  return json({
    ok: true,
    scheduleId: schedule.id,
    revisionId,
    scheduledAt: scheduledAt.toISOString(),
    approval: "pending",
  });
}

async function loadSchedule(
  rest: Rest,
  scheduleId: number
): Promise<ScheduleRow> {
  const rows = await rest.getJson<ScheduleRow[]>("publishing_schedules", {
    id: `eq.${scheduleId}`,
    select: "*",
    limit: "1",
  });
  const schedule = firstRow(rows);
  if (!schedule) throw new HttpError(`Không tìm thấy lịch #${scheduleId}.`, 404);
  return schedule;
}

async function handleUpdateSchedule(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const scheduleId = toPositiveInt(body.scheduleId);
  if (!scheduleId) throw new HttpError("scheduleId không hợp lệ.", 400);
  const schedule = await loadSchedule(rest, scheduleId);
  if (!["active", "paused"].includes(schedule.status)) {
    throw new HttpError(
      `Lịch đang ở trạng thái ${schedule.status}, không đổi giờ được.`,
      409
    );
  }
  const scheduledAt = parseScheduledAt(body.scheduledAt);
  await assertScheduleTimeOk(rest, schedule.target_username, scheduledAt);
  const res = await rest.patch(
    "publishing_schedules",
    { id: `eq.${scheduleId}` },
    { scheduled_at: scheduledAt.toISOString(), updated_at: new Date().toISOString() }
  );
  if (!res.ok) throw new HttpError(`Không đổi giờ được (HTTP ${res.status}).`, 500);
  return json({ ok: true, scheduledAt: scheduledAt.toISOString() });
}

async function setScheduleStatus(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>,
  target: "paused" | "active" | "cancelled"
) {
  requireAdmin(auth);
  const scheduleId = toPositiveInt(body.scheduleId);
  if (!scheduleId) throw new HttpError("scheduleId không hợp lệ.", 400);
  const schedule = await loadSchedule(rest, scheduleId);
  if (schedule.status === "cancelled" || schedule.status === "completed") {
    throw new HttpError(
      `Lịch đã ${schedule.status === "cancelled" ? "hủy" : "hoàn tất"}, không đổi được.`,
      409
    );
  }
  if (target === "active" && schedule.status !== "paused") {
    throw new HttpError("Chỉ lịch đang tạm dừng mới tiếp tục được.", 409);
  }
  if (target === "paused" && schedule.status !== "active") {
    throw new HttpError("Chỉ lịch đang chạy mới tạm dừng được.", 409);
  }
  const res = await rest.patch(
    "publishing_schedules",
    { id: `eq.${scheduleId}` },
    { status: target, updated_at: new Date().toISOString() }
  );
  if (!res.ok) throw new HttpError(`Không cập nhật được (HTTP ${res.status}).`, 500);
  return json({ ok: true, status: target });
}

async function handleListSchedules(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  requireAdmin(auth);
  const status = ["active", "paused", "completed", "cancelled"].includes(
    String(body.status || "")
  )
    ? String(body.status)
    : null;
  const targetUsername = String(body.targetUsername || "").trim().slice(0, 100);
  const limit = clampSetting(body.limit, 100, 1, 500);
  const params: Record<string, string> = {
    select: "*",
    order: "scheduled_at.asc",
    limit: String(limit),
  };
  if (status) params.status = `eq.${status}`;
  if (targetUsername) params.target_username = `eq.${targetUsername}`;
  const schedules = await rest.getJson<ScheduleRow[]>("publishing_schedules", params);

  const revisionIds = [...new Set((schedules || []).map((row) => row.content_revision_id))];
  const revisions = revisionIds.length
    ? await rest.getJson<
        Array<{
          id: number;
          title: string;
          preset_name: string;
          revision_number: number;
        }>
      >("content_revisions", {
        id: `in.(${revisionIds.join(",")})`,
        select: "id,title,preset_name,revision_number",
        limit: String(revisionIds.length),
      })
    : [];
  const revisionById = new Map((revisions || []).map((row) => [row.id, row]));
  const approvals = revisionIds.length
    ? await rest.getJson<
        Array<{ revision_id: number; target_username: string; decision: string; decided_at: string | null }>
      >("content_revision_approvals", {
        revision_id: `in.(${revisionIds.join(",")})`,
        select: "revision_id,target_username,decision,decided_at",
        limit: "1000",
      })
    : [];
  const approvalBy = new Map(
    (approvals || []).map((row) => [`${row.revision_id}:${row.target_username}`, row])
  );

  return json({
    ok: true,
    schedules: (schedules || []).map((row) => {
      const revision = revisionById.get(row.content_revision_id);
      const approval = approvalBy.get(`${row.content_revision_id}:${row.target_username}`);
      return {
        ...row,
        title: revision?.title ?? null,
        presetName: revision?.preset_name ?? null,
        revisionNumber: revision?.revision_number ?? null,
        approvalDecision: approval?.decision ?? "pending",
        approvalDecidedAt: approval?.decided_at ?? null,
      };
    }),
  });
}

// ---------------------------------------------------------------------------
// Device: Bài sắp đăng của tôi + Chấp nhận / Từ chối (mục 17.3)
// ---------------------------------------------------------------------------

async function handleGetMyPublishingStatus(rest: Rest, auth: Auth) {
  const device = requireDevice(auth);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const schedules = await rest.getJson<ScheduleRow[]>("publishing_schedules", {
    target_username: `eq.${device.username}`,
    status: "in.(active,paused)",
    scheduled_at: `gte.${since}`,
    select: "*",
    order: "scheduled_at.asc",
    limit: "100",
  });
  const revisionIds = [...new Set((schedules || []).map((row) => row.content_revision_id))];
  const revisions = revisionIds.length
    ? await rest.getJson<
        Array<{
          id: number;
          title: string;
          body: string;
          description: string;
          preset_name: string;
          featured: boolean;
          main_image: string | null;
          revision_number: number;
        }>
      >("content_revisions", {
        id: `in.(${revisionIds.join(",")})`,
        select: "id,title,body,description,preset_name,featured,main_image,revision_number",
        limit: String(revisionIds.length),
      })
    : [];
  const revisionById = new Map((revisions || []).map((row) => [row.id, row]));
  const approvals = revisionIds.length
    ? await rest.getJson<
        Array<{ revision_id: number; decision: string; decided_at: string | null }>
      >("content_revision_approvals", {
        revision_id: `in.(${revisionIds.join(",")})`,
        target_username: `eq.${device.username}`,
        select: "revision_id,decision,decided_at",
        limit: "100",
      })
    : [];
  const approvalByRevision = new Map(
    (approvals || []).map((row) => [row.revision_id, row])
  );
  const consent = await getConsent(rest, device.username);

  return json({
    ok: true,
    username: device.username,
    autoPublishEnabled: consent?.auto_publish_enabled === true,
    paused: !!consent?.paused_at,
    quietHours: consent?.quiet_hours || { enabled: false, timezone: "Asia/Ho_Chi_Minh" },
    schedules: (schedules || []).map((row) => {
      const revision = revisionById.get(row.content_revision_id);
      const approval = approvalByRevision.get(row.content_revision_id);
      return {
        scheduleId: row.id,
        scheduledAt: row.scheduled_at,
        timezone: row.timezone,
        status: row.status,
        latePolicy: row.late_policy,
        title: revision?.title ?? null,
        body: revision?.body ?? null,
        description: revision?.description ?? null,
        presetName: revision?.preset_name ?? null,
        featured: revision?.featured === true,
        mainImage: revision?.main_image ?? null,
        revisionNumber: revision?.revision_number ?? null,
        approvalDecision: approval?.decision ?? "pending",
        approvalDecidedAt: approval?.decided_at ?? null,
      };
    }),
  });
}

async function handleDecideContentApproval(
  rest: Rest,
  auth: Auth,
  body: Record<string, unknown>
) {
  const device = requireDevice(auth);
  const scheduleId = toPositiveInt(body.scheduleId);
  if (!scheduleId) throw new HttpError("scheduleId không hợp lệ.", 400);
  const decision = String(body.decision || "");
  if (!["approved", "rejected"].includes(decision)) {
    throw new HttpError("decision phải là approved hoặc rejected.", 400);
  }
  const schedule = await loadSchedule(rest, scheduleId);
  // Username lấy từ device đã đăng ký, không tin body (mục 6.4).
  if (schedule.target_username !== device.username) {
    throw new HttpError(
      `Lịch #${scheduleId} không thuộc @${device.username}.`,
      403,
      "SCHEDULE_NOT_OWNED"
    );
  }
  if (!["active", "paused"].includes(schedule.status)) {
    throw new HttpError(
      `Lịch đã ${schedule.status === "cancelled" ? "hủy" : "hoàn tất"}, không đổi quyết định được.`,
      409
    );
  }
  const nowIso = new Date().toISOString();
  // Upsert idempotent theo (revision, username); quyết định có thể đổi trước
  // khi lịch chạy. Audit: decided_at + device_id.
  const res = await rest.post(
    "content_revision_approvals",
    {
      revision_id: schedule.content_revision_id,
      target_username: device.username,
      decision,
      decided_at: nowIso,
      device_id: device.device_id,
      updated_at: nowIso,
    },
    "resolution=merge-duplicates"
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HttpError(
      `Không lưu được quyết định (HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}).`,
      500
    );
  }
  return json({ ok: true, scheduleId, decision, decidedAt: nowIso });
}

// ---------------------------------------------------------------------------
// Dispatcher
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
  const adminToken = Deno.env.get("ADMIN_TOKEN");
  if (!supabaseUrl || !serviceRoleKey || !adminToken) {
    return json(
      { error: "Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ADMIN_TOKEN." },
      500
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body JSON không hợp lệ." }, 400);
  }

  const rest = createRest(supabaseUrl, serviceRoleKey);
  const authHeaderKey = (req.headers.get("Authorization") || "").slice(0, 16);
  if (isRateLimited(authHeaderKey)) {
    return json({ error: "Quá nhiều request. Thử lại sau một phút." }, 429);
  }

  const action = String(body.action || "");
  try {
    const auth = await resolveAuth(req, rest);
    switch (action) {
      // ---- Admin: kho bài ----
      case "listContentPresets":
        return await handleListContentPresets(rest);
      case "saveContentPreset":
        return await handleSaveContentPreset(rest, auth, body);
      case "createContentDraft":
        return await handleCreateContentDraft(rest, auth, body);
      case "importContentBatch":
        return await handleImportContentBatch(rest, auth, body);
      case "updateContentDraft":
        return await handleUpdateContentDraft(rest, auth, body);
      case "approveContent":
        return await handleApproveContent(rest, auth, body);
      case "rejectContent":
        return await handleRejectContent(rest, auth, body);
      case "archiveContent":
        return await handleArchiveContent(rest, auth, body);
      case "listContentLibrary":
        return await handleListContentLibrary(rest, auth, body);
      case "getContentItem":
        return await handleGetContentItem(rest, auth, body);
      // ---- Admin: phân bài + lịch tuần ----
      case "scheduleContent":
        return await handleScheduleContent(rest, auth, body);
      case "updateSchedule":
        return await handleUpdateSchedule(rest, auth, body);
      case "pauseSchedule":
        return await setScheduleStatus(rest, auth, body, "paused");
      case "resumeSchedule":
        return await setScheduleStatus(rest, auth, body, "active");
      case "cancelSchedule":
        return await setScheduleStatus(rest, auth, body, "cancelled");
      case "listSchedules":
        return await handleListSchedules(rest, auth, body);
      // ---- Device: user ----
      case "getMyPublishingStatus":
        return await handleGetMyPublishingStatus(rest, auth);
      case "decideContentApproval":
        return await handleDecideContentApproval(rest, auth, body);
      default:
        return json({ error: `Action không hỗ trợ: ${action}` }, 400);
    }
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message, code: error.code }, error.status);
    }
    console.error("[publishing-api] unhandled:", error);
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      500
    );
  }
});
