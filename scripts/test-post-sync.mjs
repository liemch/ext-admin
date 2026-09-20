// scripts/test-post-sync.mjs — Kiểm thử offline cho Post Sync (PLAN_POST_SYNC.md).
//
// Chạy: node scripts/test-post-sync.mjs
// Không cần Supabase/TechHub: chỉ kiểm tra tính nhất quán giữa
//   post-sync-client.js, post-sync-worker.js, post-sync-ui.js,
//   background.js, popup.html, supabase/functions/post-sync-api/index.ts,
//   supabase/migrations/013_post_sync.sql và migration hardening.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

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

function loadScript(rel, globalName) {
  const code = read(rel);
  const sandbox = {};
  // Chromium extension service worker global: set globals needed.
  const chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    alarms: {
      create: () => {}, clear: () => {}, get: async () => null,
      onAlarm: { addListener: () => {} },
    },
    runtime: {
      sendMessage: async () => {},
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      getURL: (p) => p,
    },
    tabs: { onUpdated: { addListener: () => {} }, onCreated: { addListener: () => {} } },
    sidePanel: { setPanelBehavior: async () => {} },
    webRequest: { onBeforeSendHeaders: { addListener: () => {} } },
    declarativeNetRequest: { updateDynamicRules: () => {} },
  };
  const fn = new Function(
    "window", "globalThis", "chrome", "PostSyncClient",
    `${code}\n;return typeof ${globalName} !== "undefined" ? ${globalName} : null;`
  );
  const mod = fn(undefined, sandbox, chrome, undefined);
  return { module: mod, sandbox, chrome };
}

// ---------------------------------------------------------------- 1. File tồn tại + cú pháp JS
section("File tồn tại và cú pháp hợp lệ");
const reqFiles = [
  "post-sync-client.js",
  "post-sync-worker.js",
  "post-sync-ui.js",
  "supabase/functions/post-sync-api/index.ts",
  "supabase/functions/post-sync-api/README.md",
  "supabase/migrations/013_post_sync.sql",
  "supabase/migrations/20260911100410_post_sync_hardening.sql",
  "scripts/test-post-sync.mjs",
];
for (const f of reqFiles) {
  try { read(f); assert(true, `có file ${f}`); }
  catch { assert(false, `thiếu file ${f}`); }
}

// ---------------------------------------------------------------- 2. client exports
section("post-sync-client.js — API contract");
const clientSandbox = { POST_SYNC_API_CONFIG: { url: "https://x.supabase.co/functions/v1/post-sync-api", adminToken: "" } };
{
  const code = read("post-sync-client.js");
  const fn = new Function("window", "globalThis", "chrome", "POST_SYNC_API_CONFIG", `${code};return globalThis.PostSyncClient;`);
  const chrome = { storage: { local: { get: async () => ({ engagementDevice: { token: "devtok" } }) } } };
  const client = fn(undefined, clientSandbox, chrome, clientSandbox.POST_SYNC_API_CONFIG);
  assert(client, "PostSyncClient được export");
  for (const name of [
    "getPostSyncApiConfig", "isPostSyncConfigured", "isPostSyncLeader",
    "submitPostHint", "postSyncAdmin", "requestPostSync", "saveScannedPosts", "saveMyScannedPosts",
    "reconcileMyScannedPosts",
    "claimPostSyncJob", "startPostSyncRun", "extendPostSyncLease",
    "completePostSyncJob", "failPostSyncJob", "getPostSyncStatus",
    "listPostSyncRuns", "listPostHints", "listNewPosts", "getUserSyncStatus", "listActiveUsernames",
    "getMySyncedPosts", "listJobs", "listRuns",
    "resubmitHint", "retryJob", "cancelJob", "getStatus", "enqueueJobs",
  ]) {
    assert(typeof client[name] === "function", `PostSyncClient.${name} là hàm`);
  }
  assert(client.isPostSyncConfigured() === true, "isPostSyncConfigured = true khi có url");
  assert(client.isPostSyncLeader() === false, "isPostSyncLeader = false khi không có adminToken");
}

// ---------------------------------------------------------------- 3. worker — pure helpers
section("post-sync-worker.js — url parsing + hằng số");
{
  // Boot worker: phụ thuộc PostSyncClient. Đưa 1 mock tối thiểu.
  const code = read("post-sync-worker.js");
  const mockClient = {
    isPostSyncConfigured: () => true,
    isPostSyncLeader: () => false,
    submitPostHint: async () => ({}),
    requestPostSync: async () => ({}),
    claimPostSyncJob: async () => ({ job: null }),
  };
  const sandbox = {};
  const chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    alarms: { create: () => {}, clear: async () => {}, get: async () => null },
    runtime: { sendMessage: async () => {} },
  };
  const fn = new Function(
    "window", "globalThis", "chrome", "PostSyncClient",
    `${code};return globalThis.PostSyncWorker;`
  );
  const worker = fn(undefined, sandbox, chrome, mockClient);
  assert(worker, "PostSyncWorker được export");
  for (const name of [
    "LEADER_WAKE_ALARM", "FEED_SCHEDULE_ALARM", "RECONCILE_SCHEDULE_ALARM",
    "HARD_LIMITS", "extractArticleIdentifierFromUrl",
    "maybeSubmitHintFromUrl", "bootstrap",
    "enqueueScheduledJobs", "claimAndRunOneJob", "runLeaderCycle",
    "scheduleAlarms", "clearAlarms", "checkSessionQuiet",
  ]) {
    assert(name in worker, `PostSyncWorker có ${name}`);
  }
  // URL trích xuất uuid.
  const sample = worker.extractArticleIdentifierFromUrl("https://techhub.fpt.net/p/an/11111111-2222-3333-4444-555555555555/ten-bai");
  assert(sample && sample.techhubUuid === "11111111-2222-3333-4444-555555555555", "trích xuất uuid từ URL /p/<user>/<uuid>/<slug>");
  const sample2 = worker.extractArticleIdentifierFromUrl("https://techhub.fpt.net/c/cong-dong/11111111-2222-3333-4444-555555555555/ten-bai");
  assert(sample2 && sample2.techhubUuid === "11111111-2222-3333-4444-555555555555", "trích xuất uuid từ /c/<community>/<uuid>/<slug>");
  assert(worker.extractArticleIdentifierFromUrl("https://example.com/xyz") === null, "bỏ qua URL ngoài techhub");
  assert(worker.extractArticleIdentifierFromUrl("https://techhub.fpt.net/") === null, "URL gốc techhub không có bài → null");
}

// ---------------------------------------------------------------- 4. background.js wiring
section("background.js — importScripts + hook");

const background = read("background.js");
assert(background.includes("importScripts('config.js'") && background.includes("post-sync-client.js") && background.includes("post-sync-worker.js"),
  "importScripts có post-sync-client.js và post-sync-worker.js");
assert(!background.includes("PostSyncWorker.bootstrap().catch"),
  "không bootstrap leader trên máy user");
assert(!background.includes("handleTechHubTabForHint"),
  "không tạo hint/queue khi user chỉ mở một bài TechHub");
assert(background.includes('const MY_POSTS_SYNC_ALARM = "myPostsSyncAlarm"'),
  "mỗi user có alarm đồng bộ bài cá nhân");
assert(background.includes("periodInMinutes: MY_POSTS_SYNC_INTERVAL_MINUTES"),
  "đồng bộ bài cá nhân định kỳ 20 phút");
assert(background.includes("PostSyncClient.saveMyScannedPosts(posts)"),
  "user lưu chính danh sách vừa tải qua API bảo vệ theo device");
assert(background.includes("PostSyncClient.reconcileMyScannedPosts(liveTechhubIds)"),
  "sau khi lưu đủ, user đối soát bài đã xóa qua API bảo vệ theo device");
assert(background.includes("!Array.isArray(data?.results)"),
  "không xóa bài khi TechHub trả dữ liệu sai định dạng");
assert(background.includes("if (hasNext)"),
  "không xóa bài nếu chưa tải hết sau giới hạn 50 trang");
assert(background.indexOf("PostSyncClient.reconcileMyScannedPosts(liveTechhubIds)")
    > background.indexOf("if (!persisted)"),
  "chỉ đối soát xóa sau khi toàn bộ bài đã được lưu thành công");
assert(background.includes("EngagementClient.engagementHeartbeat(userProfile.username)"),
  "đồng bộ tự tạo hoặc khôi phục device token");
assert(background.includes(".filter((post) => !post.published_at)"),
  "kết quả quét chỉ render bài chưa publish");
assert(background.includes("visiblePosts = await supabase.getOwnPosts(userProfile.username, { limit: 100 })"),
  "sau khi lưu, danh sách đọc lại tối đa 100 bài đã lọc từ posts");
assert(read("post-sync-worker.js").includes('lastMessage: `Không lưu được kết quả job #${job.id}: ${error.message}`'),
  "leader báo lỗi khi completePostSyncJob không lưu được posts");
const workerSource = read("post-sync-worker.js");
assert(workerSource.includes("try {\n      const deviceId = await getLeaderDeviceId();"),
  "khóa leader luôn được nhả nếu đăng ký device thất bại");
assert(workerSource.includes("const run = await runLeaderCycle({ manual: true });"),
  "bootstrap claim lease và chạy ngay thay vì chỉ enqueue");
assert(workerSource.includes("await chrome.storage.local.remove(POST_SYNC_LOCK_KEY);"),
  "bootstrap dọn lock mồ côi từ service worker cũ");
const adminSet = background.match(/const ADMIN_ONLY_ACTIONS = new Set\(\[([\s\S]*?)\]\);/);
assert(adminSet, "tìm thấy ADMIN_ONLY_ACTIONS");
const adminActions = new Set([...(adminSet?.[1] || "").matchAll(/"([^"]+)"/g)].map((m) => m[1]));
for (const action of [
  "postSyncGetStatus", "postSyncCheckSession", "postSyncRunLeaderTick", "postSyncEnqueueJobs",
  "postSyncListJobs", "postSyncListHints", "postSyncListRuns",
  "postSyncResubmitHint", "postSyncRetryJob", "postSyncCancelJob",
]) {
  assert(adminActions.has(action), `ADMIN_ONLY_ACTIONS có "${action}"`);
  assert(background.includes(`request.action === "${action}"`), `background xử lý "${action}"`);
}
// User action (không admin): postSyncGetState
assert(!adminActions.has("postSyncGetState"), "postSyncGetState không yêu cầu admin");
assert(background.includes(`request.action === "postSyncGetState"`), "background xử lý postSyncGetState");

// ---------------------------------------------------------------- 5. UI đồng bộ đơn giản trong Bài viết
section("UI đồng bộ cá nhân");

const html = read("popup.html");
const popupjs = read("popup.js");
assert(!html.includes('data-panel="post-sync"'), "đã bỏ menu leader Đồng bộ bài");
assert(!html.includes("post-sync-ui.js"), "popup không nạp UI leader cũ");
assert(!html.includes('id="myPostsCacheList"'), "không còn danh sách bài đồng bộ trùng lặp");
assert(html.includes('id="syncMyPostsBtn"'), "menu Bài viết có nút đồng bộ duy nhất");
assert(html.includes("Đồng bộ bài"), "nút dùng tên dễ hiểu");
assert(popupjs.includes('{ action: "syncMyPosts" }'), "nút gọi luồng đồng bộ bài cá nhân");
assert(!popupjs.includes("PostSyncUI."), "popup không còn phụ thuộc UI leader");

// ---------------------------------------------------------------- 6. Edge function contract
section("post-sync-api/index.ts — action contract");

const edge = read("supabase/functions/post-sync-api/index.ts");
const edgeActions = new Set([...edge.matchAll(/case "([a-zA-Z_]+)":/g)].map((m) => m[1]));
const requiredActions = [
  "submitPostHint", "requestPostSync",
  "saveScannedPosts", "saveMyScannedPosts", "reconcileMyScannedPosts",
  "claimPostSyncJob", "startPostSyncRun", "extendPostSyncLease",
  "completePostSyncJob", "failPostSyncJob",
  "getPostSyncStatus", "getStatus",
  "listPostSyncRuns", "listRuns",
  "listPostHints", "listHints",
  "listNewPosts", "getUserSyncStatus",
  "listJobs", "enqueueJobs",
  "resubmitHint", "retryJob", "cancelJob",
];
for (const a of requiredActions) {
  assert(edgeActions.has(a), `edge có action "${a}"`);
}
assert(edge.includes("requireAdmin"), "edge có helper requireAdmin");
assert(edge.includes("isRateLimited"), "edge có rate limit");
assert(edge.includes("const device = requireDevice(auth)"), "saveMyScannedPosts yêu cầu device token");
assert(
  edge.includes('(device.enrollment_status || "approved") !== "approved"'),
  "post-sync từ chối device pending/revoked"
);
assert(edge.includes('case "listActiveUsernames"'), "leader đọc username hợp lệ qua admin API");
assert(read("post-sync-client.js").includes('postSyncAdmin("listActiveUsernames"'), "client có action listActiveUsernames");
assert(workerSource.includes("PostSyncClient.listActiveUsernames()"), "leader không đọc trực tiếp bảng users");
assert(!workerSource.includes("supabase.getAllUsers()"), "worker đã bỏ direct read users");
assert(edge.includes("author.toLowerCase() !== device.username.toLowerCase()"),
  "server chỉ nhận bài đúng username của device");
assert(edge.includes("Bài #${conflicting.techhub_id} đã thuộc tài khoản khác"),
  "server không cho user ghi đè bài đã thuộc tài khoản khác");
assert(edge.includes('username: `eq.${device.username}`') && edge.includes('techhub_id: `in.(${ids.join(",")})`'),
  "đối soát chỉ xóa bài thuộc đúng username của device");
assert(edge.includes('if (!Array.isArray(body.liveTechhubIds))'),
  "server từ chối đối soát nếu thiếu danh sách ID đầy đủ");
assert(edge.includes('Danh sách ID bài TechHub không hợp lệ; không xóa dữ liệu.'),
  "server từ chối ID lỗi thay vì xóa nhầm bài");

// ---------------------------------------------------------------- 7. Migration 013 — tables/RPC/RLS
section("supabase/migrations/013_post_sync.sql — schema");

const mig = read("supabase/migrations/013_post_sync.sql");
assert(mig.includes("CREATE TABLE IF NOT EXISTS public.post_hints"), "tạo post_hints");
assert(mig.includes("CREATE TABLE IF NOT EXISTS public.post_sync_jobs"), "tạo post_sync_jobs");
assert(mig.includes("CREATE TABLE IF NOT EXISTS public.post_sync_runs"), "tạo post_sync_runs");
assert(mig.includes("claim_post_sync_job"), "RPC claim_post_sync_job");
assert(mig.includes("FOR UPDATE SKIP LOCKED"), "claim dùng FOR UPDATE SKIP LOCKED");
assert(mig.includes("ENABLE ROW LEVEL SECURITY"), "bật RLS");
assert(mig.includes("REVOKE ALL ON FUNCTION public.claim_post_sync_job"),
  "revoke execute claim_post_sync_job khỏi PUBLIC");
assert(mig.includes("GRANT EXECUTE ON FUNCTION public.claim_post_sync_job") && mig.includes("service_role"),
  "grant execute claim_post_sync_job cho service_role");
assert(mig.includes("verification_status"), "bổ sung cột verification_status trên posts");
assert(mig.includes("discovered_by"), "bổ sung cột discovered_by (chú thích trong plan §1.2)");

// ---------------------------------------------------------------- 7b. Hardening migration
section("Migration hardening — quyền ghi + leader lease + complete atomic");
const hardening = read("supabase/migrations/20260911100410_post_sync_hardening.sql");
assert(hardening.includes("post_sync_leader_lease"), "có singleton global leader lease");
assert(hardening.includes("start_post_sync_run") && hardening.includes("complete_post_sync_job"),
  "có RPC start/complete atomic");
assert(hardening.includes("FOR UPDATE SKIP LOCKED"), "hardening claim giữ SKIP LOCKED");
assert(hardening.includes("REVOKE INSERT, UPDATE, DELETE"), "client bị chặn quyền ghi posts");
assert(hardening.includes("ON CONFLICT (techhub_id) DO UPDATE"), "complete upsert idempotent theo techhub_id");

// ---------------------------------------------------------------- 8. Engagement integration (plan §4)
section("Tích hợp engagement — campaign filter + skip bài invalid");

const engEdge = read("supabase/functions/engagement-api/index.ts");
assert(engEdge.includes("verification_status") && engEdge.includes("eq.verified"),
  "handlePlanCampaign chỉ lấy bài verification_status = verified");
assert(engEdge.includes("cancelTasksForInvalidPosts"),
  "engagement-api có hàm hủy task trỏ vào bài không còn hợp lệ");
assert(engEdge.includes("post_unavailable") || engEdge.includes("Bài không còn mở"),
  "có ghi chú lý do hủy task");

// ---------------------------------------------------------------- 9. Silent mode / host_permissions
section("Chế độ im lặng");

assert(!background.includes("chrome.notifications"), "post-sync không dùng chrome.notifications");
assert(background.includes("MY_POSTS_SYNC_INTERVAL_MINUTES = 20"),
  "user tự đồng bộ im lặng mỗi 20 phút");
assert(background.includes("Đồng bộ bài cá nhân thất bại"),
  "lỗi đồng bộ nền chỉ ghi log, không bật thông báo");
const manifest = JSON.parse(read("manifest.json"));
assert(manifest.host_permissions.some((p) => p.includes("supabase.co")), "host_permissions đã bao gồm *.supabase.co");

// ---------------------------------------------------------------- 10. config.example.js
section("config.example.js");

const cfg = read("config.example.js");
assert(cfg.includes("POST_SYNC_API_CONFIG"), "config.example.js có POST_SYNC_API_CONFIG");
assert(cfg.includes("post-sync-api"), "POST_SYNC_API_CONFIG.url trỏ đến /functions/v1/post-sync-api");
assert(cfg.includes("module.exports") && cfg.includes("POST_SYNC_API_CONFIG"), "module.exports xuất POST_SYNC_API_CONFIG");

// ---------------------------------------------------------------- summary
console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.error("Failures:");
  for (const m of failures) console.error(` - ${m}`);
  process.exit(1);
}
