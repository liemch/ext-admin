// scripts/test-publishing.mjs — Kiểm thử offline cho Publishing (R5,
// PLAN_PRODUCT_9_10.md mục 6.1–6.4, 17.3, 19.1, 21).
//
// Chạy: node scripts/test-publishing.mjs
// Không cần Supabase/TechHub: chỉ kiểm tra tính nhất quán giữa
//   publishing-client.js, publishing-ui.js, background.js, popup.html,
//   supabase/functions/publishing-api/index.ts và migration
//   20260918130000_content_library_scheduling.sql.

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

const migration = read("supabase/migrations/20260918130000_content_library_scheduling.sql");
const api = read("supabase/functions/publishing-api/index.ts");
const client = read("publishing-client.js");
const ui = read("publishing-ui.js");
const background = read("background.js");
const html = read("popup.html");
const popup = read("popup.js");
const cfg = read("config.example.js");

// ---------------------------------------------------------------- 1. migration
section("Migration kho bài và lịch");

for (const table of [
  "content_presets",
  "content_items",
  "content_revisions",
  "content_revision_approvals",
  "publishing_schedules",
]) {
  assert(migration.includes(`CREATE TABLE IF NOT EXISTS public.${table}`), `tạo bảng ${table}`);
  assert(
    migration.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`),
    `bật RLS ${table}`
  );
  assert(
    migration.includes(`REVOKE ALL ON public.${table} FROM PUBLIC, anon, authenticated`),
    `client không ghi trực tiếp ${table}`
  );
}
// Preset "Cải tiến mỗi ngày" không hardcode trong worker (mục 6.1).
assert(
  migration.includes("('Cải tiến mỗi ngày', 35, ARRAY[178, 368, 274]::BIGINT[], 'markdown'") ||
    migration.includes("Cải tiến mỗi ngày"),
  "seed preset Cải tiến mỗi ngày (community 35, terms 178/368/274)"
);
assert(
  !api.includes("community_id: 35") && !api.includes("community: 35"),
  "publishing-api không hardcode community 35"
);
// Chống trùng kho bằng content_hash (R5: nhập batch lặp không nhân đôi kho).
assert(
  migration.includes("CONSTRAINT uq_content_items_hash UNIQUE (content_hash)"),
  "content_hash UNIQUE chống nhập trùng"
);
// Revision bất biến + reserve một-một (R5 nghiệm thu).
assert(
  migration.includes("CONSTRAINT uq_content_revisions_item_number UNIQUE (content_item_id, revision_number)"),
  "revision đánh số duy nhất theo content item"
);
assert(
  migration.includes("uq_publishing_schedules_active_revision") &&
    migration.includes("WHERE status IN ('active', 'paused')"),
  "một revision chỉ reserve cho một lịch còn hiệu lực (hai admin đua nhau)"
);
assert(
  migration.includes("uq_publishing_schedules_active_item_user"),
  "không gán trùng item cho cùng user ở hai lịch còn hiệu lực"
);
assert(
  migration.includes("CONSTRAINT uq_content_revision_approvals UNIQUE (revision_id, target_username)"),
  "approval theo (revision, target user) — chỉ user được gán duyệt được"
);
// Trạng thái biên tập tách trạng thái chạy (mục 6.3).
assert(
  migration.includes("CHECK (status IN ('draft', 'review', 'approved', 'rejected', 'archived'))"),
  "content_items có đủ trạng thái biên tập"
);
assert(
  migration.includes("CHECK (status IN ('active', 'paused', 'completed', 'cancelled'))"),
  "publishing_schedules chỉ chứa trạng thái lịch"
);
assert(
  migration.includes("timezone VARCHAR(60) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh'"),
  "timezone mặc định Asia/Ho_Chi_Minh"
);
assert(
  migration.includes("('publishing_batch_max_items', '20'") &&
    migration.includes("('publishing_batch_max_bytes', '1048576'"),
  "giới hạn batch pilot 20 bài / 1 MB nằm trong settings"
);
assert(
  migration.includes("('publishing_max_schedules_per_user_day', '1'"),
  "pilot mặc định 1 lịch/user/ngày nằm trong settings"
);

// ---------------------------------------------------------------- 2. publishing-api
section("publishing-api contract");

for (const action of [
  "listContentPresets",
  "saveContentPreset",
  "createContentDraft",
  "importContentBatch",
  "updateContentDraft",
  "approveContent",
  "rejectContent",
  "archiveContent",
  "listContentLibrary",
  "getContentItem",
  "scheduleContent",
  "updateSchedule",
  "pauseSchedule",
  "resumeSchedule",
  "cancelSchedule",
  "listSchedules",
  "getMyPublishingStatus",
  "decideContentApproval",
]) {
  assert(api.includes(`case "${action}"`), `publishing-api có action ${action}`);
}
// All-or-nothing import (mục 17.3 bước 3).
assert(
  api.includes("Batch có lỗi nên chưa nhập gì") &&
    api.includes("không item nào bị bỏ âm thầm"),
  "import batch lỗi thì không nhập gì, báo rõ từng item"
);
assert(
  api.includes("dryRun === true") && api.includes("dryRun: true"),
  "import hỗ trợ dry-run để Kiểm tra trước"
);
assert(
  api.includes("DUPLICATE_CONTENT"),
  "hash trùng được báo là lỗi DUPLICATE_CONTENT, không bỏ âm thầm"
);
// Duyệt tạo revision bất biến (mục 17.3 bước 4, 19.1).
assert(
  api.includes("handleApproveContent") &&
    api.includes("revision_number: nextNumber") &&
    api.includes("current_revision_id: revision.id"),
  "duyệt tạo revision bất biến và gán current_revision_id"
);
assert(
  api.includes("Chỉ bài đã duyệt mới được phân lịch"),
  "chỉ bài approved mới được phân lịch"
);
assert(
  api.includes("APPROVAL_REQUIRED"),
  "lịch bài chưa duyệt trả APPROVAL_REQUIRED"
);
// Schedule trỏ revision, không đọc draft đang chỉnh (R5 nghiệm thu).
assert(
  api.includes("content_revision_id: revisionId") &&
    api.includes('select: "id,title,body,description,preset_name,featured,main_image,revision_number"'),
  "getMyPublishingStatus đọc snapshot revision, không đọc draft"
);
// Quiet hours chặn trước khi lưu (mục 19.1).
assert(
  api.includes("QUIET_HOURS_CONFLICT") &&
    api.includes("Giờ đăng nằm trong giờ yên lặng"),
  "lịch trong giờ yên lặng bị chặn trước khi lưu"
);
// Pilot 1 bài/user/ngày.
assert(
  api.includes("publishing_max_schedules_per_user_day") &&
    api.includes("pilot tối đa"),
  "phân lịch tôn trọng trần 1 bài/user/ngày của pilot"
);
// Hai admin reserve cùng revision: unique index + lỗi rõ ràng (R5 nghiệm thu).
assert(
  api.includes("uq_publishing_schedules_active_revision") &&
    api.includes("REVISION_ALREADY_SCHEDULED"),
  "hai admin reserve cùng revision chỉ một người thành công"
);
// Username từ device, không tin body (mục 6.4).
assert(
  api.includes("schedule.target_username !== device.username") &&
    api.includes("SCHEDULE_NOT_OWNED"),
  "user chỉ quyết định lịch của chính mình"
);
assert(
  api.includes("requireDevice(auth)"),
  "action device yêu cầu thiết bị đã duyệt"
);
// Server không nhận cookie/CSRF (mục 6.2) — chỉ xét code, không xét comment.
assert(
  !/headers\.get\(["']cookie|csrfToken|x-csrf|credentials.*include/i.test(api),
  "publishing-api không đọc/gửi cookie hoặc CSRF TechHub"
);
// Hash gồm đủ trường (mục 19.1).
assert(
  api.includes("computeContentHash") &&
    api.includes("communityId") && api.includes("termIds") && api.includes("bodyType"),
  "content hash gồm title/body/description/community/terms/body_type"
);
// Không lưu dữ liệu nhạy cảm vào revision.
assert(
  api.includes("approved_by") && api.includes("decided_at") && api.includes("device_id"),
  "approval có audit actor/time/device"
);

// ---------------------------------------------------------------- 3. client + background
section("publishing-client và background");

assert(
  client.includes("PUBLISHING_API_CONFIG") && client.includes("publishing-api"),
  "client đọc PUBLISHING_API_CONFIG trỏ /functions/v1/publishing-api"
);
assert(
  client.includes('const PUBLISHING_DEVICE_KEY = "engagementDevice"'),
  "client dùng chung device cache với engagement (không enrollment riêng)"
);
assert(
  client.includes("publishingAdmin") && client.includes("publishingUser"),
  "client tách đường admin (ADMIN_TOKEN) và user (device token)"
);
assert(
  client.includes("DEVICE_ENROLLMENT_REQUIRED"),
  "client báo rõ khi thiết bị chưa enrollment"
);
assert(
  background.includes("'publishing-client.js'"),
  "background importScripts publishing-client.js (thứ tự cuối, sau worker cũ)"
);
assert(
  background.includes('"publishingGetMyStatus"') === false ||
    !background.slice(
      background.indexOf("const ADMIN_ONLY_ACTIONS"),
      background.indexOf("const MODERATOR_ACTIONS")
    ).includes('"publishingGetMyStatus"'),
  "publishingGetMyStatus không nằm trong ADMIN_ONLY_ACTIONS (user thường dùng được)"
);
for (const action of [
  "publishingListPresets",
  "publishingImportBatch",
  "publishingApproveContent",
  "publishingScheduleContent",
  "publishingListSchedules",
]) {
  assert(
    background.includes(`"${action}"`) &&
      background.includes("PUBLISHING_ADMIN_ACTIONS.has(request.action)") &&
      background.includes("PublishingClient.publishingAdmin(apiAction"),
    `background nối ${action} sang publishing-api`
  );
}
// Map action phải khớp tên action phía server cho toàn bộ 16 action admin.
const adminMapMatch = background.match(/const PUBLISHING_ACTION_MAP = \{([\s\S]*?)\};/);
assert(adminMapMatch, "background có map action publishing");
if (adminMapMatch) {
  for (const [extAction, apiAction] of [
    ["publishingListPresets", "listContentPresets"],
    ["publishingImportBatch", "importContentBatch"],
    ["publishingApproveContent", "approveContent"],
    ["publishingScheduleContent", "scheduleContent"],
    ["publishingListSchedules", "listSchedules"],
    ["publishingCancelSchedule", "cancelSchedule"],
  ]) {
    assert(
      adminMapMatch[1].includes(`"${extAction}: "${apiAction}"`.replace('"', "")) ||
        adminMapMatch[1].includes(`${extAction}: "${apiAction}"`),
      `map ${extAction} → ${apiAction}`
    );
  }
}
assert(
  background.includes('PublishingClient.publishingUser("getMyPublishingStatus"') &&
    background.includes('PublishingClient.publishingUser("decideContentApproval"'),
  "background nối action user publishing"
);

// ---------------------------------------------------------------- 4. UI + HTML
section("popup.html và publishing-ui.js");

assert(
  /class="nav-item admin-only"[\s\S]{0,200}data-panel="publishing"/.test(html),
  "menu Kho bài chỉ hiện với admin"
);
assert(
  html.includes('class="panel hidden admin-only" data-panel="publishing"'),
  "panel Kho bài bị khóa với user thường"
);
assert(
  popup.includes('"publishing"'),
  "popup.js đăng ký panel publishing vào ADMIN_ONLY_PANELS"
);
for (const id of [
  "contentPromptTopic",
  "contentPromptAudience",
  "contentPromptCount",
  "contentPromptStructure",
  "contentPromptCopyBtn",
  "contentBatchJson",
  "contentBatchFile",
  "contentValidateBtn",
  "contentImportBtn",
  "contentBatchErrors",
  "contentStatusFilter",
  "contentRefreshBtn",
  "contentLibraryList",
  "contentEditorBox",
  "contentEditTitle",
  "contentEditBody",
  "contentEditPreset",
  "contentEditPreviewBtn",
  "contentEditSaveBtn",
  "scheduleContentSelect",
  "scheduleTargetUsername",
  "scheduleAtInput",
  "scheduleLatePolicy",
  "scheduleCreateBtn",
  "schedulesList",
]) {
  assert(html.includes(`id="${id}"`), `popup có ${id}`);
}
// User: Bài sắp đăng của tôi (mục 17.3).
for (const id of [
  "myPublishingList",
  "myPublishingRefreshBtn",
  "myPublishingMessage",
]) {
  assert(html.includes(`id="${id}"`), `popup có ${id} (Bài sắp đăng của tôi)`);
}
assert(
  html.includes("<h2>Bài sắp đăng của tôi</h2>") &&
    html.includes("Chấp nhận / Từ chối từng bản"),
  "user thấy bản sắp đăng kèm lựa chọn Chấp nhận / Từ chối"
);
assert(
  html.includes('<script src="publishing-ui.js"></script>') &&
    html.indexOf("publishing-ui.js") > html.indexOf("popup.js"),
  "publishing-ui.js nạp sau popup.js (dùng chung helper)"
);
assert(
  html.includes('id="myPublishingList"') &&
    html.indexOf('id="myPublishingList"') < html.indexOf('id="myPostsList"'),
  "card Bài sắp đăng nằm trong menu Bài viết, trước danh sách dài"
);
// UI hành vi.
assert(
  ui.includes("action: \"publishingImportBatch\"") && ui.includes("dryRun"),
  "UI tách Kiểm tra (dry-run) và Nhập kho"
);
assert(
  ui.includes("renderSanitizedMarkdown") && ui.includes("replace(/&/g, \"&amp;\")"),
  "preview Markdown escape HTML trước khi render (sanitize)"
);
assert(
  ui.includes("data-content-approve") && ui.includes("data-content-reject"),
  "kho bài có nút Duyệt / Từ chối"
);
assert(
  ui.includes("data-schedule-reschedule") &&
    ui.includes("data-schedule-pause") &&
    ui.includes("data-schedule-cancel"),
  "lịch tuần có Đổi giờ / Tạm dừng / Hủy"
);
assert(
  ui.includes("data-my-approve") && ui.includes("data-my-reject"),
  "user có nút Chấp nhận / Từ chối bản sắp đăng"
);
assert(
  ui.includes("action: \"publishingDecideApproval\""),
  "UI gửi quyết định qua publishingDecideApproval"
);
assert(
  ui.includes("Bản đã duyệt (nếu có) không đổi"),
  "UI nói rõ sửa draft không đổi bản đã duyệt"
);
assert(
  ui.includes("file.size > 1024 * 1024"),
  "UI chặn file JSON lớn hơn 1 MB"
);
assert(
  ui.includes("Math.min(20, Math.max(1") && ui.includes("tối đa 20 bài"),
  "UI giới hạn prompt 20 bài/batch"
);

// ---------------------------------------------------------------- 5. config
section("config.example.js");

assert(cfg.includes("PUBLISHING_API_CONFIG"), "config.example.js có PUBLISHING_API_CONFIG");
assert(cfg.includes("publishing-api"), "url trỏ /functions/v1/publishing-api");
assert(
  cfg.includes("module.exports") && cfg.includes("PUBLISHING_API_CONFIG"),
  "module.exports xuất PUBLISHING_API_CONFIG"
);
assert(!cfg.includes("your-publishing-token"), "không thêm secret giả vào config mẫu");

// ---------------------------------------------------------------- summary
console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.error("Failures:");
  for (const m of failures) console.error(` - ${m}`);
  process.exit(1);
}
