// scripts/test-engagement.mjs — Kiểm thử offline cho cross-user engagement.
//
// Chạy: node scripts/test-engagement.mjs
// Không cần Supabase/TechHub: chỉ kiểm tra logic thuần + tính nhất quán
// giữa popup.html / engagement-ui.js / background.js / engagement-api.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(message);
    console.error(`  ✗ ${message}`);
  }
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

// Nạp file plain-script (gán vào globalThis) trong Node.
function loadScript(rel) {
  const code = read(rel);
  const fn = new Function(
    "window",
    "globalThis",
    "chrome",
    "supabase",
    "EngagementClient",
    `${code}\n;return typeof EngagementWorker !== "undefined" ? EngagementWorker : (typeof DiscussionImport !== "undefined" ? DiscussionImport : null);`
  );
  // discussion-import.js dùng IIFE(globalThis khi không có window).
  const sandboxGlobal = {};
  const result = fn(undefined, sandboxGlobal, {}, {}, {});
  return { module: result, sandbox: sandboxGlobal };
}

function loadEngagementClient(chrome) {
  const code = read("engagement-client.js");
  const sandboxGlobal = { crypto: globalThis.crypto };
  const fn = new Function(
    "window",
    "globalThis",
    "chrome",
    `${code}\n;return globalThis.EngagementClient;`
  );
  return fn(undefined, sandboxGlobal, chrome);
}

section("engagement-client.js — cache device");
{
  const storedDevice = {
    deviceId: "device-1",
    token: "token-1",
    username: "alice",
    label: "Chrome/test",
  };
  let storageReads = 0;
  let storageWrites = 0;
  const chrome = {
    storage: {
      local: {
        get: async () => {
          storageReads += 1;
          return { engagementDevice: storedDevice };
        },
        set: async () => {
          storageWrites += 1;
        },
      },
    },
    runtime: {},
  };
  const client = loadEngagementClient(chrome);
  await client.ensureEngagementDevice("alice");
  await client.getEngagementDevice();
  await client.ensureEngagementDevice("alice");
  assert(storageReads === 1, "cache device tránh đọc storage lặp lại");
  assert(storageWrites === 0, "heartbeat không ghi storage khi device không đổi");
  const switchedDevice = await client.ensureEngagementDevice("bob");
  await client.ensureEngagementDevice("bob");
  assert(storageWrites === 1, "đổi username chỉ ghi device đúng một lần");
  assert(switchedDevice.deviceId !== storedDevice.deviceId, "đổi username tạo enrollment mới thay vì rebind device cũ");
  assert(switchedDevice.token !== storedDevice.token, "đổi username xoay device token local");
}

// ---------------------------------------------------------------- 1. discussion-import
section("discussion-import.js — validate kịch bản");

const di = loadScript("discussion-import.js").sandbox.DiscussionImport;
assert(di, "DiscussionImport được export");

const NEW_FORMAT = [
  {
    name: "backlog-qua-tang",
    actors: { A: "visitor", B: "author" },
    turns: [
      { actor: "A", content: "Quà về thế này chắc backlog tăng rồi anh." },
      { actor: "B", content: "Haha backlog lúc nào cũng có em." },
      { actor: "A", content: "Ưu tiên theo impact trước anh nhỉ?" },
    ],
  },
  {
    name: "delayed",
    actors: { A: "visitor", B: "author" },
    turns: [
      { actor: "A", content: "Delayed gratification phải không anh? 😂" },
      { actor: "B", content: "Chuẩn em." },
    ],
  },
];

let result = di.validateThreads(JSON.stringify(NEW_FORMAT));
assert(result.errors.length === 0, `format turns hợp lệ không lỗi (nhận ${JSON.stringify(result.errors)})`);
assert(result.threads.length === 2, "parse được 2 thread");
assert(result.threads[0].turns.length === 3, "thread 1 có 3 turn");
assert(result.threads[0].actors.A === "visitor", "actors.A = visitor");
assert(result.threads[0].actors.B === "author", "actors.B = author");

result = di.validateThreads(JSON.stringify({ schemaVersion: 1, threads: NEW_FORMAT }));
assert(result.errors.length === 0 && result.threads.length === 2,
  "schemaVersion 1 với threads được import");
result = di.validateThreads(JSON.stringify({ schemaVersion: 2, threads: NEW_FORMAT }));
assert(result.errors.length === 1 && result.errors[0].error.includes("schemaVersion"),
  "schemaVersion không hỗ trợ bị từ chối");

result = di.validateThreads(
  JSON.stringify([{ discussion: "Hỏi&#x20;này", answer: "Đáp&#39; án &amp; thêm" }])
);
assert(result.errors.length === 0, "format cũ discussion/answer được chấp nhận");
assert(result.threads[0].format === "legacy", "đánh dấu format legacy");
assert(result.threads[0].turns[0].content === "Hỏi này", "giải mã &#x20;");
assert(result.threads[0].turns[1].content === "Đáp' án & thêm", "giải mã &#39; và &amp;");
assert(result.threads[0].turns[0].actor === "A", "discussion → A");
assert(result.threads[1 - 1].turns[1].actor === "B", "answer → B");

const expectError = (input, snippet, label) => {
  const out = di.validateThreads(typeof input === "string" ? input : JSON.stringify(input));
  const text = out.errors.map((e) => e.error).join(" | ");
  assert(out.errors.length > 0 && text.includes(snippet), `${label} (nhận: ${text || "không lỗi"})`);
};

expectError({ not: "array" }, "mảng", "từ chối JSON không phải mảng");
expectError([], "rỗng", "từ chối mảng rỗng");
expectError("not json{{", "không hợp lệ", "từ chối JSON sai cú pháp");
expectError([{ turns: [{ actor: "A", content: "một" }] }], "2 hoặc 3", "từ chối 1 turn");
expectError(
  [{ turns: [
    { actor: "A", content: "x" },
    { actor: "B", content: "y" },
    { actor: "A", content: "z" },
    { actor: "B", content: "w" },
  ] }],
  "2 hoặc 3",
  "từ chối 4 turn"
);
expectError(
  [{ turns: [{ actor: "B", content: "x" }, { actor: "A", content: "y" }] }],
  "bắt đầu bằng A",
  "từ chối thread bắt đầu bằng B"
);
expectError(
  [{ turns: [{ actor: "A", content: "x" }, { actor: "A", content: "y" }] }],
  "luân phiên",
  "từ chối 2 turn A liên tiếp"
);
expectError(
  [{ turns: [{ actor: "A", content: "  " }, { actor: "B", content: "y" }] }],
  "rỗng",
  "từ chối content rỗng"
);
expectError(
  [{ turns: [{ actor: "A", content: "x" }, { actor: "C", content: "y" }] }],
  '"A" hoặc "B"',
  "từ chối actor C"
);
// Lỗi phải chỉ rõ thread và turn.
{
  const out = di.validateThreads(
    JSON.stringify([
      { turns: [{ actor: "A", content: "ok" }, { actor: "B", content: "ok" }] },
      { turns: [{ actor: "A", content: "" }, { actor: "B", content: "ok" }] },
    ])
  );
  assert(out.threads.length === 1 && out.errors.length === 1, "thread lỗi không chặn thread đúng");
  assert(
    out.errors[0].error.includes("thread[1]") && out.errors[0].error.includes("turns[0]"),
    `lỗi chỉ rõ thread và turn (nhận: ${out.errors[0].error})`
  );
}

// ---------------------------------------------------------------- 2. worker pure fns
section("engagement-worker.js — hàm thuần");

const worker = loadScript("engagement-worker.js").sandbox.EngagementWorker;
assert(worker, "EngagementWorker được export");

assert(worker.parseReactionState({ current_user_reaction: "upvote" }).upvoted === true, "nhận diện current_user_reaction=upvote");
assert(worker.parseReactionState({ is_upvoted: true }).upvoted === true, "nhận diện is_upvoted");
assert(worker.parseReactionState({ liked: true }).upvoted === true, "nhận diện liked");
assert(
  worker.parseReactionState({ reactions: [{ category: "upvote", count: 5 }] }).known === false,
  "count upvote không gắn cờ cá nhân → unknown (không kết luận vội)"
);
assert(
  worker.parseReactionState({ reactions: [{ category: "upvote", voted: true }] }).upvoted === true,
  "nhận diện reactions[].voted"
);
assert(worker.parseReactionState({}).known === false, "detail rỗng → unknown");
assert(worker.parseReactionState(null).known === false, "detail null → unknown");

assert(
  worker.normalizeCommentText("  Chào   Bạn! ") === "chào bạn",
  "normalize comment (lower + gọn khoảng trắng + bỏ dấu câu)"
);
assert(worker.looksLikePlaceholder("{{content}}") === true, "phát hiện placeholder {{...}}");
assert(worker.looksLikePlaceholder("Bài viết hay quá!") === false, "comment thường không phải placeholder");
assert(worker.looksLikePlaceholder("   ") === true, "comment rỗng là placeholder");
assert(
  worker.jaccardSimilarity("bài viết rất hay", "bài viết rất hay") === 1,
  "jaccard trùng tuyệt đối = 1"
);
assert(
  worker.jaccardSimilarity("bài viết rất hay", "thời tiết hôm nay đẹp") < 0.5,
  "jaccard khác nội dung thấp"
);
assert(
  worker.parseCreatedCommentId({ id: 123 }, null) === 123,
  "lấy comment id từ payload.id"
);
assert(
  worker.parseCreatedCommentId({ data: { id: "456" } }, null) === 456,
  "lấy comment id từ payload.data.id (string)"
);
assert(
  worker.parseCreatedCommentId(null, { get: () => "/api/v1/comments/789/" }) === 789,
  "lấy comment id từ Location header"
);

// ---------------------------------------------------------------- 3. HTML/UI consistency
section("Nhất quán popup.html ↔ engagement-ui.js");

const html = read("popup.html");
const ui = read("engagement-ui.js");
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const uiIds = [...ui.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]);
const missingIds = [...new Set(uiIds)].filter((id) => !htmlIds.has(id));
assert(missingIds.length === 0, `mọi $("...") trong engagement-ui.js đều có trong popup.html (thiếu: ${missingIds.join(", ") || "không"})`);
for (const id of ["sessionBanner", "postsUltraNotice", "threadJsonInput", "campaignsList", "threadsList", "tasksList", "devicesList", "killSwitchToggle"]) {
  assert(htmlIds.has(id), `popup.html có #${id}`);
}
assert(html.includes("discussion-import.js"), "popup.html nạp discussion-import.js");
assert(html.includes("engagement-ui.js"), "popup.html nạp engagement-ui.js");
assert(!html.includes("crossInteractionEnabled"), "đã gỡ switch tương tác chéo cũ khỏi HTML");

// ------------------------------------------------- 4. background ↔ edge action
section("Nhất quán background.js ↔ engagement-api");

const background = read("background.js");
const popup = read("popup.js");
const edge = read("supabase/functions/engagement-api/index.ts");
const adminApi = read("supabase/functions/admin-api/index.ts");
assert((background.match(/const cfg = validateNvidiaConfig\(\);/g) || []).length === 3,
  "các luồng tạo mẫu chấp nhận NVIDIA proxy thay vì bắt buộc apiKey direct");
assert(!background.includes('throw new Error("Chưa cấu hình NVIDIA_CONFIG.apiKey trong config.js")'),
  "background không còn kiểm tra cứng NVIDIA apiKey");
assert(background.includes("async function getFreshTechHubSession()"),
  "có helper tự phục hồi profile và CSRF trước khi tạo mẫu");
assert((background.match(/await getFreshTechHubSession\(\)/g) || []).length >= 6,
  "luồng tạo mẫu và hẹn xóa đều làm mới phiên TechHub");
assert(background.includes("async function executeDeletePost(item)"),
  "hẹn xóa bài dùng chung cơ chế phục hồi phiên");
assert(background.includes("previous.csrfToken"),
  "request GET sau service worker restart không ghi đè mất CSRF đã lưu");
assert(background.includes("const MAX_AUTO_COMMENT_JOBS = 5"),
  "auto comment giới hạn tối đa năm job");
assert(background.includes("async function rotateAutoCommentJob"),
  "các job auto comment chạy luân phiên");
assert(background.includes("autoCommentJobs"),
  "danh sách job auto comment được lưu để phục hồi sau reload");
assert(background.includes("function appendAutoCommentJob(nextJob)"),
  "thêm job mới vẫn giữ lịch sử job đã hoàn tất trong cùng lô");
assert(!background.includes("autoCommentJobs = autoCommentJobs.filter((job) => job.active);"),
  "không xóa job vừa hoàn tất khi bài kế tiếp được thêm nhanh");
assert(background.includes("result.autoCommentJobs.filter((job) => job?.jobId).slice(-MAX_AUTO_COMMENT_JOBS)"),
  "reload service worker vẫn giữ tối đa năm trạng thái job gần nhất");
assert(popup.includes("activeJobCount >= maxJobs"),
  "UI khóa tạo job khi đủ giới hạn");
assert(popup.includes("function renderAutoCommentJobsLog"),
  "UI hiển thị log riêng cho các job auto comment");
assert(read("popup.html").includes('id="autoCommentJobsLog"'),
  "popup có vùng log job auto comment");
assert(background.includes("const MAX_AUTO_COMMENT_SCHEDULES = 5"),
  "hỗ trợ tối đa năm lịch auto comment độc lập");
assert(background.includes("autoCommentStartAlarmName(scheduleId)"),
  "mỗi lịch auto comment có alarm riêng");
assert(background.includes("queueScheduledAutoCommentStart(scheduleId)"),
  "các lịch cùng giờ được kích hoạt tuần tự, không ghi đè state");
assert(/id="autoCommentOwnPostId"[^>]*multiple/.test(html),
  "Auto comment cho phép chọn nhiều bài trong một lần");
assert(html.includes('class="post-picker-source"'),
  "các form dùng bộ chọn bài lớn thay cho dropdown nhỏ mặc định");
assert(popup.includes("function setupPostPickers()") && popup.includes("function renderPostPicker(selectEl)"),
  "bộ chọn bài hỗ trợ tìm kiếm, hiển thị và đồng bộ lựa chọn");
assert(popup.includes('max: 5, search: "Tìm bài để comment…"') &&
  popup.includes('max: 5, search: "Tìm bài cần xóa…"'),
  "bộ chọn comment/xóa vẫn giới hạn tối đa 5 bài");
assert(popup.includes("let autoCommentSelectedTechhubIds = []"),
  "UI lưu danh sách bài Auto comment đã chọn");
assert(popup.includes("function getAutoCommentTargets()"),
  "UI chuẩn hóa lô tối đa năm bài Auto comment");
assert(popup.includes("for (const target of targets)"),
  "chạy ngay và hẹn giờ lần lượt tạo job cho từng bài trong lô");
assert(popup.includes('status === "activated" ? "Đã kích hoạt"'),
  "UI phân biệt lịch đang chờ, đã kích hoạt và lỗi");
assert(popup.includes("việc chọn bài mới phải luôn đổi mục tiêu của form"),
  "chọn bài thứ hai không bị khóa bởi job hoặc lịch thứ nhất");
const edgeActions = new Set([...edge.matchAll(/case "([a-zA-Z]+)":/g)].map((m) => m[1]));
const usedAdmin = [...background.matchAll(/engagementAdmin\("([a-zA-Z]+)"/g)].map((m) => m[1]);
const usedDirect = [...background.matchAll(/callEngagementApi\("([a-zA-Z]+)"/g)].map((m) => m[1]);
const clientSrc = read("engagement-client.js");
const clientActions = [...clientSrc.matchAll(/"(heartbeat|claimTask|completeTask|failTask|releaseMyClaims|clearSessionRequired|getStatus)"/g)].map((m) => m[1]);
for (const action of [...new Set([...usedAdmin, ...usedDirect, ...clientActions])]) {
  assert(edgeActions.has(action), `edge function hỗ trợ action "${action}"`);
}
for (const action of ["heartbeat", "claimTask", "completeTask", "failTask", "getStatus", "importThreads", "planCampaign", "pauseCampaign", "cancelCampaign"]) {
  assert(edgeActions.has(action), `edge function có action yêu cầu "${action}" (plan mục 5)`);
}
// Admin gate: mọi action engagementAdmin trong background đều thuộc ADMIN_ONLY_ACTIONS.
const adminSet = background.match(/const ADMIN_ONLY_ACTIONS = new Set\(\[([\s\S]*?)\]\);/);
assert(adminSet, "tìm thấy ADMIN_ONLY_ACTIONS");
const adminActions = new Set([...(adminSet?.[1] || "").matchAll(/"([^"]+)"/g)].map((m) => m[1]));
const bgMsgActions = [...background.matchAll(/request\.action === "(engagement[A-Za-z]+|saveEngagementSettings)"/g)].map((m) => m[1]);
const adminProxy = ["saveEngagementSettings", "engagementPlanCampaign", "engagementPauseCampaign", "engagementResumeCampaign", "engagementCancelCampaign", "engagementGetCampaigns", "engagementGetThreads", "engagementListTasks", "engagementImportThreads", "engagementUpdateTurn", "engagementRetryTurn", "engagementGetOpsStats", "engagementCleanupEvents", "engagementSetKillSwitch", "engagementRevokeDevice"];
for (const action of adminProxy) {
  assert(adminActions.has(action), `ADMIN_ONLY_ACTIONS chứa "${action}"`);
  assert(bgMsgActions.includes(action), `background xử lý message "${action}"`);
}
// Action user (máy thường) KHÔNG được nằm trong danh sách admin-only.
for (const action of ["getEngagementState", "setEngagementEnabled", "runEngagementOnce", "checkTechHubSession", "getEngagementQueueStatus"]) {
  assert(!adminActions.has(action), `"${action}" dùng được cho user thường`);
}

// Mọi message engagement-ui.js gửi background đều được background xử lý.
{
  const uiActions = [...new Set([...ui.matchAll(/action:\s*"([a-zA-Z]+)"/g)].map((m) => m[1]))];
  assert(uiActions.length > 0, "engagement-ui.js gửi message cho background");
  for (const action of uiActions) {
    assert(
      background.includes(`request.action === "${action}"`) ||
        background.includes(`request.action === '${action}'`),
      `background xử lý message "${action}"`
    );
  }
}

// ------------------------------------------------- 5. silent mode / manifest
section("Chế độ chạy im lặng + manifest");

assert(!background.includes("chrome.notifications"), "background không gọi chrome.notifications");
assert(!background.includes("icons/coin.png"), "background không tham chiếu icon notification cũ");
assert(!/chrome\.tabs\.create\(\{\s*url:\s*"https:\/\/techhub\.fpt\.net\/",\s*active:\s*false/.test(background), "background không tự mở tab ẩn");
const manifest = JSON.parse(read("manifest.json"));
assert(!manifest.permissions.includes("notifications"), "manifest đã gỡ quyền notifications");
assert(
  background.includes("sessionRequired") || read("engagement-worker.js").includes("sessionRequired"),
  "background/worker có trạng thái session_required"
);

// ------------------------------------------------- 6. migration 012
section("Migration 012");

const migration = read("supabase/migrations/012_cross_user_engagement.sql");
for (const table of ["engagement_devices", "engagement_campaigns", "engagement_tasks", "engagement_events", "discussion_threads", "discussion_turns"]) {
  assert(migration.includes(`CREATE TABLE IF NOT EXISTS public.${table}`), `migration tạo bảng ${table}`);
}
assert(migration.includes("claim_engagement_task"), "migration có hàm claim atomic");
assert(migration.includes("release_actor_claims"), "migration có hàm release claims");
assert(migration.includes("idempotency_key TEXT NOT NULL UNIQUE"), "tasks có idempotency_key unique");
assert(migration.includes("ENABLE ROW LEVEL SECURITY"), "bật RLS");
assert(migration.includes("FOR SELECT TO anon"), "anon chỉ SELECT");
assert(
  migration.includes("REVOKE ALL ON FUNCTION public.claim_engagement_task"),
  "chặn anon gọi RPC claim trực tiếp"
);
assert(
  migration.includes("REVOKE ALL ON FUNCTION public.release_actor_claims"),
  "chặn anon gọi RPC release trực tiếp"
);
assert(edge.includes("RATE_LIMIT_MAX"), "edge function có giới hạn tốc độ");
assert(edge.includes("assertUserActive"), "edge function chặn tài khoản bị khóa");

// ------------------------------------------ 6a. identity, enrollment + consent
section("R1 identity, enrollment và consent");

const identityMigration = read("supabase/migrations/20260917020158_identity_consent_enrollment.sql");
for (const table of ["device_enrollment_invitations", "user_consents", "user_consent_events"]) {
  assert(identityMigration.includes(`CREATE TABLE IF NOT EXISTS public.${table}`), `R1 tạo bảng ${table}`);
  assert(identityMigration.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`), `R1 bật RLS cho ${table}`);
}
assert(identityMigration.includes("consume_device_enrollment_invitation"), "R1 có RPC consume mã mời atomic");
assert(identityMigration.includes("CREATE OR REPLACE FUNCTION public.update_user_consent"), "consent và audit được cập nhật atomic bằng RPC");
assert(identityMigration.includes("FOR UPDATE"), "mã mời được khóa trước khi consume");
assert(identityMigration.includes("consumed_at IS NOT NULL"), "mã mời đã dùng bị chặn replay");
assert(identityMigration.includes("v_existing.enrollment_status = 'revoked'"), "RPC không hồi sinh device revoked");
assert(
  identityMigration.includes("REVOKE ALL ON FUNCTION public.consume_device_enrollment_invitation") &&
    identityMigration.includes("TO service_role"),
  "RPC enrollment chỉ dành cho service role"
);
assert(identityMigration.includes("engagement_enabled BOOLEAN NOT NULL DEFAULT FALSE"), "consent engagement mặc định tắt");
assert(identityMigration.includes("auto_publish_enabled BOOLEAN NOT NULL DEFAULT FALSE"), "consent auto publish mặc định tắt");
assert(
  identityMigration.includes('DROP POLICY IF EXISTS "ext_users_all" ON public.users') &&
    identityMigration.includes("REVOKE ALL ON public.users FROM anon, authenticated"),
  "R1 chặn client đọc/ghi trực tiếp users của tài khoản khác"
);
assert(edge.includes('case "requestEnrollment"'), "API hỗ trợ gửi yêu cầu enrollment pending");
assert(edge.includes('case "enrollDevice"'), "API hỗ trợ mã mời một lần");
assert(edge.includes('case "updateConsent"'), "API cho chính device cập nhật consent");
assert(edge.includes('case "disconnectDevice"'), "API cho user ngắt kết nối device");
assert(edge.includes("DEVICE_USERNAME_MISMATCH"), "heartbeat chặn token tự rebind username");
assert(edge.includes("requireEngagementConsent(rest, device)"), "claim/submit chịu consent gate server-side");
assert(edge.includes('enrollment_status: "eq.approved"'), "pool chỉ lấy device đã approved");
assert(clientSrc.includes('callEngagementApi("requestEnrollment"'), "client có request enrollment");
assert(clientSrc.includes('callEngagementApi("updateConsent"'), "client có update consent");
assert(background.includes('request.action === "engagementDisconnectDevice"'), "background có action disconnect");
for (const id of [
  "identityEnrollmentStatus",
  "requestEnrollmentBtn",
  "invitationCodeInput",
  "enrollDeviceBtn",
  "engagementConsentToggle",
  "engagementDailyActionLimit",
  "disconnectEngagementDeviceBtn",
  "enrollmentInviteUsername",
  "createEnrollmentInviteBtn",
  "pendingEnrollmentList",
]) {
  assert(html.includes(`id="${id}"`), `R1 UI có ${id}`);
}
assert(ui.includes("loadIdentityState"), "UI tải enrollment/consent khi mở extension");
assert(ui.includes("consentVersion: identityState.consent.consent_version"), "UI gửi đúng consent version");
assert(edge.includes('case "createEnrollmentInvitation"'), "admin có action tạo mã mời");
assert(edge.includes('case "approveDevice"'), "admin có action duyệt device pending");
assert(edge.includes('case "getAccessContext"'), "role/lock được đọc qua ownership API");
assert(background.includes('request.action === "getAccessContext"'), "popup lấy role qua background/API");
assert(!popup.includes("supabase.findUserByUsername(username)"), "popup không đọc trực tiếp users để phân quyền");

section("R2 discussion draft và revision");
const draftMigration = read("supabase/migrations/20260917025828_discussion_script_drafts.sql");
assert(draftMigration.includes("CREATE TABLE public.discussion_script_revisions"), "R2 lưu revision riêng");
assert(draftMigration.includes("POST_NOT_OWNED_OR_VERIFIED"), "R2 chỉ lưu draft cho bài verified của chủ bài");
assert(draftMigration.includes("ON CONFLICT (owner_username, techhub_id) DO UPDATE"), "R2 khóa draft theo owner và bài");
assert(draftMigration.includes("REVOKE ALL ON public.discussion_script_revisions"), "client không đọc revision liên user trực tiếp");
assert(edge.includes('case "saveOwnDiscussionDraft"'), "R2 có action lưu draft qua device token");
assert(edge.includes('case "getOwnDiscussionDraft"'), "R2 có action đọc draft của chính mình");
assert(edge.includes('actors: { A: "visitor", B: "author" }'), "actor được server chuẩn hóa");
assert(edge.includes("DRAFT_SCOPE_DENIED"), "R2 từ chối actor hoặc bài tự khai sai quyền");
assert(edge.includes("QUOTA_EXCEEDED"), "R2 kiểm tra trần admin trên server");
assert(clientSrc.includes('callEngagementApi("saveOwnDiscussionDraft"'), "client gọi API lưu draft");
assert(background.includes('request.action === "saveMyDiscussionDraft"'), "background nối action lưu draft");
assert(ui.includes('action: "saveMyDiscussionDraft"'), "UI lưu draft thay vì queue ngay");
assert(html.includes('id="myDiscussionPreview"'), "R2 có preview hội thoại");
assert(ui.includes('data-my-remove=') && ui.includes('data-my-turn='), "R2 preview cho bỏ chuỗi và sửa từng lượt");

// ------------------------------------------ 6b. moderator role + user grants
section("Moderator role và quyền đăng ký user");

const moderatorMigration = read("supabase/migrations/016_add_moderator_role.sql");
assert(
  moderatorMigration.includes("is_moderator BOOLEAN NOT NULL DEFAULT FALSE"),
  "migration 016 thêm moderator với default an toàn"
);
assert(
  moderatorMigration.includes("REVOKE INSERT, UPDATE, DELETE ON public.users FROM anon, authenticated"),
  "migration 016 thu quyền ghi toàn bảng users khỏi anon/authenticated"
);
assert(
  moderatorMigration.includes("GRANT INSERT (full_name, username, email, avatar, last_update, created_at)"),
  "user mới chỉ được insert các cột profile an toàn"
);
assert(
  !moderatorMigration.match(/GRANT INSERT \([^)]*is_(?:admin|moderator|locked)/),
  "anon không được insert cột đặc quyền"
);
assert(
  adminApi.includes('typeof body.isModerator === "boolean"') &&
    adminApi.includes("payload.is_moderator = body.isModerator"),
  "admin-api hỗ trợ cấp/thu quyền moderator"
);
assert(
  background.includes("user.isModerator && MODERATOR_ACTIONS.has(action)"),
  "background kiểm tra moderator theo allowlist action"
);
assert(
  popup.includes('const MODERATOR_PANELS = new Set(["comment", "delete"])'),
  "UI chỉ mở Auto comment và Hẹn xóa bài cho moderator"
);

// ------------------------------------------------- 7. mutual pool + admin policy + Ultra
section("Pool tương tác tự cân bằng");

const poolMigration = read("supabase/migrations/014_engagement_user_pool.sql");
const expandedThreadQuotaMigration = read("supabase/migrations/015_expand_discussion_thread_quota.sql");
assert(
  poolMigration.includes("CREATE TABLE IF NOT EXISTS public.engagement_preferences"),
  "migration 014 tạo policy theo user"
);
for (const field of [
  "receive_post_limit",
  "discussions_per_post",
  "repeat_interval_minutes",
  "daily_contribution_cap",
]) {
  assert(poolMigration.includes(field), `preferences có ${field}`);
}
assert(
  poolMigration.includes("REVOKE ALL ON public.engagement_preferences FROM anon, authenticated"),
  "preferences chỉ được ghi/đọc qua engagement-api"
);
assert(edge.includes("ensureMutualPoolTasks"), "heartbeat có bộ tự bổ sung pool task");
assert(edge.includes("if (participants.length < 2)"), "pool cần ít nhất 2 thành viên hợp lệ");
assert(edge.includes("activeUserSet.has(name)"), "pool chỉ nhận thành viên còn trong users và không bị khóa");
assert(edge.includes("verifiedPostOwners.has(name)"), "mỗi thành viên pool phải có bài verified trong posts");
assert(edge.includes("participantSet.has(post.username)"), "pool không lấy bài của người ngoài danh sách thành viên");
assert(!edge.includes("externalPostBudget"), "đã bỏ ngân sách bài ngoài pool");
assert(edge.includes("target === actorUsername"), "task tự tương tác bị hủy trước khi claim");
assert(edge.includes('status: "in.(pending,claimed)"'), "task cũ sai thành viên bị hủy cả pending và claimed");
assert(!edge.includes('case "updatePreferences"'), "API không cho user tự cập nhật pool");
assert(edge.includes('case "setPoolSettings"'), "API cho admin điều phối pool");
assert(edge.includes('case "setUserPolicy"'), "API cho admin bật/tắt riêng user");
assert(edge.includes('case "redeemUltra"'), "API cho user dùng lượt Ultra đã kiếm được");
assert(edge.includes('case "submitOwnThreads"'), "API cho user gửi chuỗi của bài mình");
assert(
  edge.includes("discussionsPerPost, 40, 1, 50") &&
    edge.includes("discussions_per_post: clampPreference(discussionsPerPost, 40, 1, 50)"),
  "API cho admin cấu hình tối đa 50 chuỗi/bài, mặc định 40"
);
assert(
  background.includes("Math.min(3, Math.max(1, Number(heartbeat?.preferences?.discussions_per_post) || 3))"),
  "wizard R2 mặc định tối đa 3 chuỗi, vẫn tôn trọng trần admin thấp hơn"
);
assert(
  html.includes('id="poolDiscussionsPerPost" type="number" min="1" max="50" value="40"'),
  "UI cấu hình chuỗi/bài cho phép 1–50 và khởi tạo 40"
);
assert(
  expandedThreadQuotaMigration.includes("CHECK (discussions_per_post BETWEEN 1 AND 50)") &&
    expandedThreadQuotaMigration.includes("ALTER COLUMN discussions_per_post SET DEFAULT 40"),
  "migration 015 nới quota lên 50 và đặt mặc định 40"
);
assert(
  !expandedThreadQuotaMigration.includes("UPDATE public.engagement_preferences"),
  "migration 015 không tự tăng quota của các user đang chạy"
);
assert(edge.includes("author_username: `eq.${device.username}`"), "server khóa thread user vào bài của chính họ");
assert(edge.includes("Chưa có user khác online"), "không giả chuỗi khi chưa có actor khác");
assert(edge.includes('case "pushComments"'), "API cho admin tạo Push comment");
assert(edge.includes('case "listBoosts"'), "API cho admin theo dõi Push/Ultra đang chờ");
assert(edge.includes("dailyCapReached"), "claim tôn trọng quota đóng góp do admin đặt");
assert(edge.includes('event: "reconcile_required"'), "thread không advance mù khi thiếu comment ID");
assert(!clientSrc.includes("engagementUpdatePreferences"), "client không còn action user sửa preferences");
assert(!background.includes('request.action === "saveMyEngagementPreferences"'), "background không nhận setting pool từ user");
assert(!ui.includes("saveMyPreferences"), "UI không cho user tự sửa pool");
assert(poolMigration.includes("record_engagement_reward"), "migration cộng điểm idempotent theo task");
assert(poolMigration.includes("redeem_engagement_ultra"), "migration đổi Ultra nguyên tử");
assert(poolMigration.includes("engagement_boost_requests"), "migration có hàng đợi Push/Ultra");
assert(read("scripts/setup-supabase.sh").includes("014_engagement_user_pool.sql"), "setup mới áp migration 014");
for (const id of [
  "engagementContributedToday",
  "engagementReceivedToday",
  "engagementUltraProgress",
  "postsUltraNotice",
  "myDiscussionPostId",
  "autoCommentOwnPostId",
  "copyMyDiscussionPromptBtn",
  "myDiscussionJsonInput",
  "submitMyDiscussionBtn",
  "poolReceivePostLimit",
  "poolDiscussionsPerPost",
  "poolRepeatInterval",
  "poolContributionCap",
  "poolUltraThreshold",
  "copyThreadPromptBtn",
  "pushCommentsBtn",
]) {
  assert(html.includes(`id="${id}"`), `popup có ${id}`);
}
const postsPanelStart = html.indexOf('data-panel="posts"');
const dashboardPanelStart = html.indexOf('<section class="panel hidden" data-panel="dashboard">');
const myDiscussionStart = html.indexOf('id="myDiscussionPostId"');
const myPostsListStart = html.indexOf('id="myPostsList"');
assert(
  postsPanelStart >= 0 && myDiscussionStart > postsPanelStart && myDiscussionStart < dashboardPanelStart,
  "form tạo thảo luận của user nằm trong menu Bài viết"
);
assert(
  myDiscussionStart < myPostsListStart,
  "form tạo thảo luận nằm trước danh sách dài để luôn nhìn thấy"
);
assert(!popup.includes('data-post-action="reply"'), "danh sách bài không còn nút AI trả lời");
assert(!popup.includes('data-post-action="discussion"'), "danh sách bài không còn nút AI thảo luận");
assert(!popup.includes('data-select-id="${id}"'), "danh sách bài không còn nút Chọn dùng chung");
assert(
  /class="nav-item admin-only"\s+type="button"\s+data-panel="engagement"/.test(html),
  "menu Tương tác chéo chỉ hiển thị cho admin"
);
assert(
  html.includes('class="panel hidden admin-only" data-panel="engagement"'),
  "panel Tương tác chéo bị khóa với user thường"
);
assert(popup.includes('data-ultra-post-id="${id}"'), "bài verified có nút dùng Ultra khi còn lượt");
assert(popup.includes("availableUltraCredits > 0"), "UI chỉ render Ultra khi còn lượt");
assert(ui.includes("globalThis.setPostsUltraCredits?.(ultraCredits)"), "trạng thái pool cập nhật lượt Ultra sang Bài viết");
assert(ui.includes("Chờ thành viên khác"), "UI nói rõ khi pool chưa đủ thành viên");
assert(!html.includes('id="engagementUltraPostId"'), "đã bỏ ô nhập ID Ultra khỏi Tương tác chéo");
assert(!html.includes('id="redeemEngagementUltraBtn"'), "đã bỏ nút Ultra khỏi Tương tác chéo");

// ------------------------------------------------- 8. Hẹn xóa nhiều bài
section("Hẹn xóa nhiều bài");
assert(
  /<select id="deleteTechhubId"[^>]*multiple/.test(html),
  "form hẹn xóa dùng danh sách chọn nhiều"
);
assert(html.includes('id="deleteSelectedLabel"'), "form hiển thị các bài đã chọn để xóa");
assert(popup.includes("let deleteSelectedTechhubIds = []"), "UI giữ danh sách bài hẹn xóa độc lập");
assert(popup.includes("deleteSelectedTechhubIds = ids.slice(0, 5)"), "UI giới hạn tối đa 5 bài hẹn xóa");
assert(popup.includes("for (const techhubId of techhubIds)"), "mỗi bài được tạo một lịch xóa riêng");
assert(popup.includes("Xóa ngay yêu cầu chọn đúng 1 bài"), "xóa ngay không cho xóa hàng loạt ngoài ý muốn");
assert(background.includes('chrome.storage.local.get("scheduledDeletes")'), "background lưu được danh sách nhiều lịch xóa");

// ------------------------------------------------- summary
console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.error("Failures:");
  for (const message of failures) console.error(` - ${message}`);
  process.exit(1);
}
