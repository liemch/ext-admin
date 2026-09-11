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
      { actor: "B", content: "Chuẩn em, xử lý impact cao trước." },
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
assert(result.threads[0].turns.length === 4, "thread 1 có 4 turn");
assert(result.threads[0].actors.A === "visitor", "actors.A = visitor");
assert(result.threads[0].actors.B === "author", "actors.B = author");

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
expectError([{ turns: [{ actor: "A", content: "một" }] }], "2 đến 4", "từ chối 1 turn");
expectError(
  [{ turns: [1, 2, 3, 4, 5].map(() => ({ actor: "A", content: "x" })) }],
  "2 đến 4",
  "từ chối 5 turn"
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
for (const id of ["sessionBanner", "engagementEnabled", "threadJsonInput", "campaignsList", "threadsList", "tasksList", "devicesList", "killSwitchToggle"]) {
  assert(htmlIds.has(id), `popup.html có #${id}`);
}
assert(html.includes("discussion-import.js"), "popup.html nạp discussion-import.js");
assert(html.includes("engagement-ui.js"), "popup.html nạp engagement-ui.js");
assert(!html.includes("crossInteractionEnabled"), "đã gỡ switch tương tác chéo cũ khỏi HTML");

// ------------------------------------------------- 4. background ↔ edge action
section("Nhất quán background.js ↔ engagement-api");

const background = read("background.js");
const edge = read("supabase/functions/engagement-api/index.ts");
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

// ------------------------------------------------- summary
console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.error("Failures:");
  for (const message of failures) console.error(` - ${message}`);
  process.exit(1);
}
