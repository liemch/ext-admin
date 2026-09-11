# post-sync-api — Edge Function đồng bộ bài viết

Edge Function thứ tư, tách riêng khỏi `engagement-api` theo
[PLAN_POST_SYNC.md](../../../PLAN_POST_SYNC.md). Quản lý hint, sync job, lease,
run history và quyền admin. Việc gọi TechHub vẫn chạy trên máy admin (leader)
vì cookie/CSRF chỉ tồn tại trong trình duyệt.

## Deploy

```bash
supabase functions deploy post-sync-api --no-verify-jwt
supabase secrets set ADMIN_TOKEN="<dùng-chung-với-admin-api>"
```

`ADMIN_TOKEN` dùng chung với `admin-api` và `engagement-api` (cùng một giá trị,
dễ vận hành).

## Phân quyền

- `Authorization: Bearer <device-token>` → device action: `submitPostHint` +
  `listNewPosts` (chỉ trả về bài `verification_status = verified` của chính device).
  Device phải đã đăng ký qua `engagement-api` (bảng `engagement_devices`) và chưa bị thu hồi.
- `Authorization: Bearer <ADMIN_TOKEN>` → admin/leader action (enqueue, claim,
  complete, fail, read trạng thái, …).
- Không nhận cookie/CSRF và không log token.

## Actions

### Device

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
