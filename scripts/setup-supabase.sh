#!/usr/bin/env bash
# =============================================================
#  My Angel — Setup Supabase MỘT LẦN DUY NHẤT
#
#  Script này làm toàn bộ phần Supabase:
#    1. Đăng nhập + link project (lấy ref tự động từ config.js nếu có)
#    2. Sinh PROXY_TOKEN (cho nvidia-proxy) và ADMIN_TOKEN (cho admin-api + engagement-api)
#    3. Set secrets: NVIDIA_API_KEY (key MỚI), PROXY_TOKEN, ADMIN_TOKEN
#    4. Deploy 5 edge functions: nvidia-proxy, admin-api, engagement-api, post-sync-api, publishing-api
#    5. Áp migration 011 (chặn anon tự cấp is_admin / xóa user),
#       012 (hàng đợi tương tác giữa các user),
#       013 (đồng bộ bài viết — hints/feed/reconcile),
#       20260911100410 (hardening quyền ghi + global leader lease + RPC atomic),
#       014 (preferences + pool tương tác tự cân bằng),
#       015 (mở rộng quota chuỗi), 016 (moderator + khóa cột đặc quyền),
#       20260917020158 (device enrollment + consent versioned),
#       20260917025828 (discussion script drafts + immutable revisions)
#       20260918043557 (actor approvals + execution receipts)
#       20260918120000 (chiến dịch nhanh preset + hoàn Ultra idempotent),
#       20260918130000 (kho bài AI + revision bất biến + lịch đăng)
#    6. Test 5 function bằng curl
#    7. In sẵn 2 khối config.js: một cho máy admin, một cho user thường
#
#  Yêu cầu: Supabase CLI
#    macOS:  brew install supabase/tap/supabase
#    Linux:  npm i -g supabase
# =============================================================
set -euo pipefail

CYAN=$'\033[36m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
step() { printf '\n%s==> %s%s\n' "$CYAN" "$1" "$RESET"; }
info() { printf '    %s\n' "$1"; }
ok()   { printf '    %s✓ %s%s\n' "$GREEN" "$1" "$RESET"; }
warn() { printf '    %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }
die()  { printf '    %s✗ %s%s\n' "$RED" "$1" "$RESET" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ---------- 0. Kiểm tra môi trường ----------
step "Kiểm tra môi trường"
command -v supabase >/dev/null 2>&1 \
  || die "Chưa cài Supabase CLI — xem đầu file này"
command -v openssl >/dev/null 2>&1 \
  || die "Thiếu openssl"
[ -f supabase/functions/nvidia-proxy/index.ts ] \
  || die "Không tìm thấy supabase/functions — chạy script từ trong repo"
ok "Supabase CLI $(supabase --version 2>/dev/null | head -1)"

# ---------- 1. Đăng nhập ----------
if supabase projects list >/dev/null 2>&1; then
  ok "Đã đăng nhập Supabase"
else
  step "Đăng nhập Supabase (mở trình duyệt)"
  supabase login
  supabase projects list >/dev/null 2>&1 || die "Đăng nhập chưa thành công"
  ok "Đã đăng nhập"
fi

# ---------- 2. Link project ----------
PROJECT_REF=""
if [ -f config.js ]; then
  PROJECT_REF="$(grep -oE 'https://[a-z0-9]+\.supabase\.co' config.js | head -1 | sed -E 's|https://([a-z0-9]+)\.supabase\.co.*|\1|')"
fi
if [ -z "$PROJECT_REF" ]; then
  printf '    Project ref (phần đầu của https://<ref>.supabase.co): '
  read -r PROJECT_REF
fi
[ -n "$PROJECT_REF" ] || die "Thiếu project ref"

step "Link project: $PROJECT_REF"
supabase link --project-ref "$PROJECT_REF"
ok "Đã link"

# ---------- 3. Sinh token ----------
step "Sinh token"
PROXY_TOKEN="$(openssl rand -hex 24)"
ADMIN_TOKEN="$(openssl rand -hex 24)"
info "PROXY_TOKEN = $PROXY_TOKEN   (nvidia-proxy — chỉ máy admin cần)"
info "ADMIN_TOKEN = $ADMIN_TOKEN   (admin-api    — CHỈ máy admin, tuyệt đối không gửi cho user thường)"

# ---------- 4. NVIDIA key mới ----------
step "Nhập NVIDIA API key MỚI"
warn "Key cũ từng nằm trong repo public → coi như đã lộ. Revoke key cũ tại:"
warn "https://build.nvidia.com/settings/api-keys rồi nhập key mới ở đây."
printf '    NVIDIA_API_KEY (nvapi-..., gõ xong Enter): '
read -rs NVIDIA_API_KEY
echo
case "$NVIDIA_API_KEY" in
  nvapi-*) ok "Đã nhận key (dạng nvapi-...)" ;;
  "")      die "Bỏ trống — chạy lại script khi đã có key mới" ;;
  *)       warn "Key không bắt đầu bằng nvapi- — vẫn tiếp tục, nếu AI lỗi thì kiểm tra lại" ;;
esac

# ---------- 5. Set secrets ----------
step "Đặt secrets"
supabase secrets set \
  NVIDIA_API_KEY="$NVIDIA_API_KEY" \
  PROXY_TOKEN="$PROXY_TOKEN" \
  ADMIN_TOKEN="$ADMIN_TOKEN"
ok "Đã set NVIDIA_API_KEY, PROXY_TOKEN, ADMIN_TOKEN"

# ---------- 6. Deploy edge functions ----------
step "Deploy edge functions"
supabase functions deploy nvidia-proxy   --no-verify-jwt
supabase functions deploy admin-api     --no-verify-jwt
supabase functions deploy engagement-api --no-verify-jwt
supabase functions deploy post-sync-api --no-verify-jwt
supabase functions deploy publishing-api --no-verify-jwt
ok "Đã deploy nvidia-proxy + admin-api + engagement-api + post-sync-api + publishing-api"

# ---------- 7. Migration 011 + 012 ----------
step "Áp migration 011 (chặn anon sửa is_admin / xóa user)"
apply_migration() {
  local MIG="$1"
  if supabase db query --help >/dev/null 2>&1; then
    if supabase db query --linked --file "$MIG"; then
      ok "Đã áp dụng $MIG"
    else
      warn "CLI không chạy được SQL — mở Dashboard > SQL Editor và chạy nội dung file: $MIG"
    fi
  else
    warn "CLI không có lệnh 'db query' — mở Dashboard > SQL Editor và chạy nội dung file: $MIG"
  fi
}
apply_migration "supabase/migrations/011_restrict_users_writes.sql"
step "Áp migration 012 (hàng đợi tương tác giữa các user)"
apply_migration "supabase/migrations/012_cross_user_engagement.sql"
step "Áp migration 013 (đồng bộ bài viết — post-sync)"
apply_migration "supabase/migrations/013_post_sync.sql"
step "Áp migration hardening post-sync (quyền ghi + leader lease + RPC atomic)"
apply_migration "supabase/migrations/20260911100410_post_sync_hardening.sql"
step "Áp migration 014 (preferences + pool tương tác tự cân bằng)"
apply_migration "supabase/migrations/014_engagement_user_pool.sql"
step "Áp migration 015 (mở rộng quota chuỗi thảo luận)"
apply_migration "supabase/migrations/015_expand_discussion_thread_quota.sql"
step "Áp migration 016 (moderator + khóa cột đặc quyền users)"
apply_migration "supabase/migrations/016_add_moderator_role.sql"
step "Áp migration identity/consent (device enrollment + user opt-in)"
apply_migration "supabase/migrations/20260917020158_identity_consent_enrollment.sql"
step "Áp migration discussion draft/revision"
apply_migration "supabase/migrations/20260917025828_discussion_script_drafts.sql"
step "Áp migration approval/receipt cho chuỗi thảo luận"
apply_migration "supabase/migrations/20260918043557_engagement_task_receipts.sql"
step "Áp migration chiến dịch nhanh + hoàn Ultra (R4)"
apply_migration "supabase/migrations/20260918120000_quick_campaign_presets_ultra_refund.sql"
step "Áp migration R5 (kho bài + lịch)"
apply_migration "supabase/migrations/20260918130000_content_library_scheduling.sql"
step "Sửa kiểu trả về RPC hoàn Ultra (R4)"
apply_migration "supabase/migrations/20260920025941_fix_ultra_refund_result_types.sql"

# ---------- 8. Test ----------
BASE="https://${PROJECT_REF}.supabase.co/functions/v1"
step "Kiểm tra function"
if command -v curl >/dev/null 2>&1; then
  CODE1="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/nvidia-proxy" \
    -H 'Content-Type: application/json' -d '{}')"
  info "nvidia-proxy không token  → HTTP $CODE1 (mong đợi 401)"
  CODE2="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/admin-api" \
    -H 'Content-Type: application/json' -d '{"action":"getUsersOverview"}')"
  info "admin-api không token    → HTTP $CODE2 (mong đợi 401)"
  CODE3="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/engagement-api" \
    -H 'Content-Type: application/json' -d '{"action":"getStatus"}')"
  info "engagement-api không token → HTTP $CODE3 (mong đợi 401)"
  CODE4="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/post-sync-api" \
    -H 'Content-Type: application/json' -d '{"action":"getStatus"}')"
  info "post-sync-api không token  → HTTP $CODE4 (mong đợi 401)"
  CODE5="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/publishing-api" \
    -H 'Content-Type: application/json' -d '{"action":"listContentPresets"}')"
  info "publishing-api không token → HTTP $CODE5 (mong đợi 401)"
  info "admin-api có ADMIN_TOKEN → kết quả (cắt 120 ký tự đầu):"
  curl -s -X POST "$BASE/admin-api" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"action":"getUsersOverview"}' | head -c 120
  echo
  ok "Kiểm tra xong (nếu 2 dòng đầu không phải 401 → token chưa ăn, xem logs: supabase functions logs admin-api)"
else
  warn "Không có curl — bỏ qua bước test"
fi

# ---------- 9. In config ----------
step "Cấu hình config.js — dán đúng khối dưới đây"
cat <<EOF

${BOLD}── 1) MÁY CỦA ANH (admin) — config.js, KHÔNG chia sẻ file này ──${RESET}

const ADMIN_API_CONFIG = {
  url: "$BASE/admin-api",
  token: "$ADMIN_TOKEN",
};

const ENGAGEMENT_API_CONFIG = {
  url: "$BASE/engagement-api",
  adminToken: "$ADMIN_TOKEN",
};

// Post-sync: máy này làm leader (quét feed, verify hint, đối soát bài).
// User thường KHÔNG điền adminToken.
const POST_SYNC_API_CONFIG = {
  url: "$BASE/post-sync-api",
  adminToken: "$ADMIN_TOKEN",
};

// Kho bài AI + duyệt revision + phân lịch (R5). Thiết bị user dùng đúng
// device token đã enrollment ở engagement-api, không đăng ký riêng.
const PUBLISHING_API_CONFIG = {
  url: "$BASE/publishing-api",
  adminToken: "$ADMIN_TOKEN",
};

const NVIDIA_CONFIG = {
  mode: "proxy",
  proxyUrl: "$BASE/nvidia-proxy",
  proxyToken: "$PROXY_TOKEN",
  apiKey: "",
  model: "nvidia/nemotron-3.5-lightning-30b-a3b",
  maxTokens: 256,
  temperature: 1,
  topP: 0.95,
  enableThinking: false,
};

${BOLD}── 2) CONFIG GỬI CHO USER THƯỜNG — không chứa token nào ──${RESET}

const SUPABASE_CONFIG = {
  url: "https://$PROJECT_REF.supabase.co",
  anonKey: "<anon-key>",
  tableName: "users",
};

const ADMIN_API_CONFIG = { url: "", token: "" };

// Hàng đợi tương tác chéo — máy user chỉ cần url. Thiết bị mới cần mã mời
// hoặc admin duyệt; server chỉ lưu hash token. KHÔNG gửi adminToken cho user:
const ENGAGEMENT_API_CONFIG = {
  url: "$BASE/engagement-api",
  adminToken: "",
};

// Đồng bộ bài viết — máy user chỉ cần url để gửi hint khi mở bài;
// KHÔNG điền adminToken (chỉ máy admin làm leader).
const POST_SYNC_API_CONFIG = {
  url: "$BASE/post-sync-api",
  adminToken: "",
};

// Kho bài + "Bài sắp đăng của tôi" — máy user chỉ cần url (dùng device token
// đã enrollment); KHÔNG điền adminToken (chỉ máy admin nhập kho/duyệt/phân lịch).
const PUBLISHING_API_CONFIG = {
  url: "$BASE/publishing-api",
  adminToken: "",
};

// AI chỉ dành cho admin — user thường để trống:
const NVIDIA_CONFIG = { mode: "direct", apiKey: "" };

EOF

warn "Sửa config.js theo khối (1) rồi reload extension (chrome://extensions)."
warn "Lưu token ở nơi an toàn: đổi token bất kỳ lúc nào = chạy lại script (cập nhật lại config.js)."
ok "Hoàn tất setup Supabase."
