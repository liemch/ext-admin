# Edge Function `engagement-api`

Điều phối tương tác giữa các user (cross-user engagement). Extension giữ
cookie/CSRF TechHub nên vẫn là nơi **thực thi**; function này giữ **hàng đợi,
lease, campaign và kịch bản thảo luận**.

## Triển khai

```bash
# 1. Áp migration 012 trước (SQL Editor hoặc CLI)
supabase db query --linked --file supabase/migrations/012_cross_user_engagement.sql

# 2. Deploy (dùng chung ADMIN_TOKEN với admin-api)
supabase secrets set ADMIN_TOKEN="<token-đã-có>"
supabase functions deploy engagement-api --no-verify-jwt
```

`ADMIN_TOKEN` chỉ nằm trên máy admin (`config.js`). User thường không cần
token nào: extension tự sinh **device token** theo máy, server chỉ lưu hash
SHA-256 trong `engagement_devices` để khóa/thu hồi từng máy.

## Cấu hình extension (`config.js`)

```javascript
const ENGAGEMENT_API_CONFIG = {
  url: "https://<project-ref>.supabase.co/functions/v1/engagement-api",
};
```

Máy admin thêm `adminToken` (giống `ADMIN_API_CONFIG.token`) để tạo
campaign / import kịch bản / xem vận hành:

```javascript
const ENGAGEMENT_API_CONFIG = {
  url: "https://<project-ref>.supabase.co/functions/v1/engagement-api",
  adminToken: "your-admin-token", // CHỈ máy admin
};
```

## Actions

| Action | Quyền | Việc |
|---|---|---|
| `heartbeat` | device | Đăng ký máy mới, báo online, tự xếp hàng turn tới hạn |
| `claimTask` | device | Claim atomic 1 task (lease 5 phút, mỗi actor giữ 1 task) |
| `completeTask` | device | Ghi kết quả TechHub + interaction, mở turn kế tiếp |
| `failTask` | device | Phân loại retry / vĩnh viễn / `session_required` |
| `releaseMyClaims` | device | Trả claim về queue (đổi tài khoản) |
| `clearSessionRequired` | device | Mở lại task chờ phiên sau khi đăng nhập lại |
| `getStatus` | device/admin | Tiến độ actor cho UI |
| `importThreads` | admin | Validate + lưu kịch bản JSON (`dryRun` để kiểm tra) |
| `planCampaign` | admin | Tạo campaign + sinh task vote/comment công bằng |
| `pauseCampaign` / `resumeCampaign` / `cancelCampaign` | admin | Điều khiển campaign |
| `getCampaigns` / `getThreads` / `listTasks` | admin | Theo dõi |
| `updateTurn` / `retryTurn` | admin | Sửa / chạy lại turn |
| `getOpsStats` / `cleanupEvents` / `setKillSwitch` / `revokeDevice` | admin | Vận hành |

## Luồng claim → thực thi

1. Worker gọi `heartbeat` (đăng ký máy nếu mới).
2. Worker gọi `claimTask` → nhận đúng 1 task + lease.
3. Worker đọc trạng thái thật trên TechHub rồi vote/comment/reply.
4. Thành công → `completeTask` (kèm `techhubResultId`); lỗi → `failTask`
   (kèm `httpStatus`, `content` đã thử để retry dùng lại).
5. Task hết lease tự về queue; `idempotency_key` ngăn tạo trùng.

## Ghi chú an toàn

- Bảng `engagement_*` / `discussion_*` bật RLS, anon chỉ SELECT.
  Mọi ghi điều phối đi qua function này bằng service role.
- RPC `claim_engagement_task` / `release_actor_claims` bị `REVOKE` khỏi
  `anon`/`authenticated` — chỉ service role được gọi.
- Giới hạn tốc độ 120 request/phút/caller (env `ENGAGEMENT_RATE_LIMIT`).
- Thiết bị bị thu hồi (`revoked`) hoặc tài khoản bị khóa → 403 ngay.
- Không log cookie/CSRF/token ra console hay events.
- Vote kiểm tra trạng thái reaction trước khi toggle (idempotent).
- 401/403 từ TechHub → task `session_required`, worker dừng im lặng cho
  tới khi người dùng mở extension và đăng nhập lại.
