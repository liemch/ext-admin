# Edge Function `engagement-api`

Điều phối tương tác giữa các user (cross-user engagement). Extension giữ
cookie/CSRF TechHub nên vẫn là nơi **thực thi**; function này giữ **hàng đợi,
lease, pool tự cân bằng, campaign tương thích và kịch bản thảo luận**.

## Triển khai

```bash
# 1. Áp migration 012, 014, 015, 016 rồi identity/consent
supabase db query --linked --file supabase/migrations/012_cross_user_engagement.sql
supabase db query --linked --file supabase/migrations/014_engagement_user_pool.sql
supabase db query --linked --file supabase/migrations/20260917020158_identity_consent_enrollment.sql

# 2. Deploy (dùng chung ADMIN_TOKEN với admin-api)
supabase secrets set ADMIN_TOKEN="<token-đã-có>"
supabase functions deploy engagement-api --no-verify-jwt
```

`ADMIN_TOKEN` chỉ nằm trên máy admin (`config.js`). Extension tự sinh **device
token** theo máy, server chỉ lưu hash SHA-256. Device mới ở trạng thái pending
cho tới khi admin duyệt hoặc user dùng mã mời một lần đã gắn với username.

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
| `requestEnrollment` / `enrollDevice` | device mới | Gửi yêu cầu duyệt hoặc dùng mã mời một lần |
| `getIdentityState` / `updateConsent` / `disconnectDevice` | device | Xem quyền, opt-in/pause và thu hồi chính thiết bị |
| `heartbeat` | device approved | Báo online và tự xếp hàng turn tới hạn khi consent còn hiệu lực |
| `redeemUltra` | device | Dùng một lượt Ultra cho bài verified thuộc chính user |
| `submitOwnThreads` | device | Nhập JSON 2–3 turn cho bài verified của mình; server tự chọn visitor online |
| `claimTask` | device | Claim atomic 1 task (lease 5 phút, mỗi actor giữ 1 task) |
| `completeTask` | device | Ghi kết quả TechHub + interaction, mở turn kế tiếp |
| `failTask` | device | Phân loại retry / vĩnh viễn / `session_required` |
| `getPoolSettings` / `setPoolSettings` | admin | Đọc/sửa quota và cooldown chung |
| `setUserPolicy` | admin | Bật/tắt quyền tham gia riêng một user |
| `pushComments` | admin | Tạo yêu cầu ưu tiên comment cho một bài verified |
| `releaseMyClaims` | device | Trả claim về queue (đổi tài khoản) |
| `clearSessionRequired` | device | Mở lại task chờ phiên sau khi đăng nhập lại |
| `getStatus` | device/admin | Tiến độ actor cho UI |
| `importThreads` | admin | Validate + lưu kịch bản JSON (`dryRun` để kiểm tra) |
| `planCampaign` | admin | Tạo campaign + sinh task vote/comment công bằng |
| `pauseCampaign` / `resumeCampaign` / `cancelCampaign` | admin | Điều khiển campaign |
| `getCampaigns` / `getThreads` / `listTasks` | admin | Theo dõi |
| `updateTurn` / `retryTurn` | admin | Sửa / chạy lại turn |
| `getOpsStats` / `cleanupEvents` / `setKillSwitch` / `revokeDevice` | admin | Vận hành |
| `createEnrollmentInvitation` / `listEnrollmentRequests` / `approveDevice` | admin | Duyệt danh tính thiết bị |

## Luồng claim → thực thi

1. Device được duyệt bằng mã mời hoặc bởi admin; user chủ động bật consent.
2. Worker gọi `heartbeat`.
3. Heartbeat chỉ bổ sung pool khi có ít nhất 2 user khác nhau cùng còn trong
   `users`, đang online/bật tham gia và mỗi người có bài `open + verified` trong
   `posts`. Bài ngoài danh sách thành viên và task tự tương tác đều bị loại.
4. Worker gọi `claimTask` → nhận đúng 1 task + lease.
5. Worker đọc trạng thái thật trên TechHub rồi vote/comment/reply.
6. Thành công → `completeTask` (kèm `techhubResultId`) và cộng điểm đúng một lần; lỗi → `failTask`.
7. Admin tạo nội dung bằng prompt ChatGPT/Gemini, nhập JSON 2–3 turn; server chỉ mở turn kế tiếp khi có comment ID thật.
   (kèm `httpStatus`, `content` đã thử để retry dùng lại).
8. Task hết lease tự về queue; `idempotency_key` ngăn tạo trùng.

## Ghi chú an toàn

- Bảng policy/reward/boost bật RLS và thu toàn bộ quyền `anon`/`authenticated`.
  Mọi ghi điều phối đi qua function này bằng service role.
- RPC `claim_engagement_task` / `release_actor_claims` bị `REVOKE` khỏi
  `anon`/`authenticated` — chỉ service role được gọi.
- Giới hạn tốc độ 120 request/phút/caller (env `ENGAGEMENT_RATE_LIMIT`).
- Device pending/revoked, consent thiếu/hết phiên bản hoặc tài khoản bị khóa → không claim.
- Không log cookie/CSRF/token ra console hay events.
- Vote kiểm tra trạng thái reaction trước khi toggle (idempotent).
- 401/403 từ TechHub → task `session_required`, worker dừng im lặng cho
  tới khi người dùng mở extension và đăng nhập lại.
