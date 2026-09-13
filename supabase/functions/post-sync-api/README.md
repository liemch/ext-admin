# post-sync-api — Edge Function đồng bộ bài viết

Edge Function thứ tư, tách riêng khỏi `engagement-api` theo
[PLAN_POST_SYNC.md](../../../PLAN_POST_SYNC.md). Luồng hiện hành cho phép mỗi user
tự lấy bài của chính mình từ TechHub rồi lưu an toàn bằng device token. Các action
hint, sync job, lease và run history vẫn được giữ để tương thích/bảo trì, nhưng
không còn là đường chạy mặc định trong popup.

## Deploy

```bash
supabase functions deploy post-sync-api --no-verify-jwt
supabase secrets set ADMIN_TOKEN="<dùng-chung-với-admin-api>"
```

`ADMIN_TOKEN` dùng chung với `admin-api` và `engagement-api` (cùng một giá trị,
dễ vận hành).

## Phân quyền

- `Authorization: Bearer <device-token>` → device action: `saveMyScannedPosts`,
  `reconcileMyScannedPosts`, `submitPostHint` và `listNewPosts` (chỉ ghi/đọc/xóa
  bài của chính device).
  Device phải đã đăng ký qua `engagement-api` (bảng `engagement_devices`) và chưa bị thu hồi.
- `Authorization: Bearer <ADMIN_TOKEN>` → admin action. Các action leader
  (`claim/start/extend/complete/fail`) đồng thời cần `deviceId` và
  `leaderDeviceToken` của thiết bị đã đăng ký trong `engagement_devices`; server
  dùng singleton lease để chỉ cho một leader chạy tại một thời điểm.
- Không nhận cookie/CSRF và không log token.

## Actions

### Device

- `saveMyScannedPosts` — Nhận tối đa 200 bài mỗi lô. Server lấy username từ
  device token, bỏ payload sai tác giả, chặn ghi đè bài thuộc user khác và upsert
  các bài hợp lệ vào `posts` với `verification_status = verified`.

- `reconcileMyScannedPosts` — Chỉ gọi sau khi client đã tải đầy đủ mọi trang.
  Server tự lấy username từ device token và xóa các dòng `posts` của đúng user
  không còn trong danh sách ID TechHub. Danh sách rỗng hợp lệ và sẽ xóa toàn bộ
  bài của user; vì vậy client dừng trước action này nếu response TechHub bất thường.

- `submitPostHint` — Gửi tín hiệu bài mới từ hoạt động tự nhiên.

  ```json
  {
    "action": "submitPostHint",
    "identifier": { "techhubUuid": "...", "url": "..." },
    "source": "article_page",
    "observedAt": "2026-09-11T00:00:00Z",
    "metadata": { "title": "...", "publishedAt": null }
  }
  ```

  Server lấy username từ device token, **không tin** username trong body.

### Admin (enqueue)

- `requestPostSync` — Xếp hàng quét, không chờ quét xong.
  - `{ "scope": "feed", "communitySlug": "cai-tien-moi-ngay" }`
  - `{ "scope": "user", "username": "user01" }`
  - `{ "scope": "due_users" }`
- `saveScannedPosts` — Admin quét tay và upsert ngay kết quả vào `posts`; không
  đi qua cooldown/hàng đợi leader.

### Leader

- `claimPostSyncJob` — Claim một job tới hạn.
- `startPostSyncRun` — Bắt đầu run, ghi số trang đầu tiên.
- `extendPostSyncLease` — Gia hạn lease khi job đang chạy lâu.
- `completePostSyncJob` — Hoàn thành, upsert bài, ghi run.
- `failPostSyncJob` — Báo lỗi, phân loại retry/session_required/permanent.

### Admin đọc

- `getPostSyncStatus` (alias `getStatus`) — Tổng quan hệ thống (queue, leader hoạt động, request 24h, bài mới).
- `listPostSyncRuns` (alias `listRuns`) — Lịch sử run.
- `listPostHints` (alias `listHints`) — Danh sách hint (lọc theo status/username).
- `listNewPosts` — Bài mới N ngày; device chỉ xem được bài của chính mình.
- `listJobs` — Danh sách hàng đợi job theo status/phân trang.
- `enqueueJobs` — Chủ động xếp feed discovery + due_users (dùng bởi leader bootstrap).
- `resubmitHint` — Đẩy lại một hint bị lỗi thành job `verify_hint` mới.
- `retryJob` — Reset một job lỗi về `pending` để chạy lại.
- `cancelJob` — Hủy một job đang `pending` / `retry_wait` / `session_required`.
- `getUserSyncStatus` — Trạng thái đồng bộ của một user.
