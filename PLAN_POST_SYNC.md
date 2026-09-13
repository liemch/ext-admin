# Implementation Plan — Đồng bộ bài viết TechHub

## Quyết định hiện hành — đồng bộ cá nhân đơn giản

Từ bản hiện hành, luồng mặc định không còn phụ thuộc máy admin leader, hint hay
hàng đợi quét:

- Mỗi user đăng nhập TechHub tự tải danh sách bài theo chính username của mình.
- User bấm **Đồng bộ bài** trong menu **Bài viết**; service worker cũng chạy im
  lặng mỗi 20 phút khi Chrome đang hoạt động.
- Extension gửi từng lô tối đa 200 bài đến `post-sync-api.saveMyScannedPosts` bằng
  device token. Server lấy chủ sở hữu từ device token, chỉ nhận bài có tác giả
  trùng khớp, rồi upsert vào `posts` và đánh dấu `verified`.
- UI leader/queue đã được gỡ khỏi popup. Các bảng, action và worker leader bên
  dưới được giữ để tương thích dữ liệu cũ và công cụ bảo trì, nhưng không còn là
  đường chạy mặc định của extension.
- Sau khi tải đủ toàn bộ các trang và lưu thành công, server đối chiếu danh sách
  ID còn tồn tại rồi xóa khỏi `posts` các bài của chính user đã biến mất trên
  TechHub. Nếu bất kỳ trang nào lỗi, sai định dạng hoặc vượt giới hạn 50 trang,
  lượt quét dừng trước bước xóa để tránh mất dữ liệu do kết quả không đầy đủ.

Phần còn lại của tài liệu mô tả kiến trúc leader trước đây và chỉ còn giá trị
tham khảo/bảo trì.

## 1. Kết quả cần đạt

Hệ thống tự phát hiện và cập nhật bài viết của các user đã đăng ký mà không yêu cầu từng user quét danh sách bài, không tạo request trùng lên TechHub và không bắt admin vận hành thủ công mỗi ngày.

Khi hoàn thành:

- User đang dùng TechHub gửi tín hiệu bài mới mà không phát sinh lượt quét feed.
- Một máy admin làm sync leader để xác minh hint, quét feed và đối soát theo username.
- User không mở extension vẫn được phát hiện bài mới qua feed discovery.
- Campaign chỉ chọn được bài đã xác minh.
- Admin xem được nguồn phát hiện, thời gian cập nhật, request count và lỗi từng lượt.
- Background chạy im lặng; không notification và không tự mở tab.

Plan này chỉ triển khai đồng bộ bài. Queue vote/comment/reply đã thuộc [PLAN_CROSS_USER_ENGAGEMENT.md](PLAN_CROSS_USER_ENGAGEMENT.md).

## 2. Quyết định kiến trúc

### 2.1 Tách function riêng

Tạo Edge Function thứ tư:

```text
supabase/functions/post-sync-api/index.ts
```

Không tiếp tục đưa logic sync vào `engagement-api`. `post-sync-api` quản lý hint, sync job, lease, run history và quyền admin. Việc gọi TechHub vẫn chạy trong extension leader vì cookie/CSRF chỉ có trên máy admin.

### 2.2 Tạo migration mới

Tạo `supabase/migrations/013_post_sync.sql`. Không sửa migration 012 đã chạy.
Sau rollout ban đầu, áp dụng thêm migration `20260911100410_post_sync_hardening.sql` để khóa quyền ghi cache, giới hạn bảng điều phối ở service role, bổ sung global leader lease và các RPC claim/start/complete atomic.

### 2.3 Ba nguồn phát hiện

Theo thứ tự ưu tiên:

1. `post_hint`: tín hiệu nhẹ từ hoạt động tự nhiên của user.
2. `feed_discovery`: leader quét feed chung mỗi 60 phút.
3. `user_reconcile`: leader đối soát từng username mỗi 12–24 giờ.

“7 ngày” là cửa sổ dữ liệu và điều kiện dừng pagination, không phải số request.

## 3. Thành phần cần thêm

```text
post-sync-client.js
post-sync-worker.js
post-sync-ui.js
supabase/functions/post-sync-api/index.ts
supabase/functions/post-sync-api/README.md
supabase/migrations/013_post_sync.sql
scripts/test-post-sync.mjs
```

Các file cần sửa:

- `background.js`: import module, route message, bắt URL bài và đăng ký alarm.
- `popup.html`: menu admin “Đồng bộ bài viết”; trạng thái cache trong “Bài viết của tôi”.
- `popup.css`: style trạng thái sync, run và bài mới.
- `popup.js`: user mở panel chỉ đọc cache, không quét TechHub.
- `config.example.js`: thêm `POST_SYNC_API_CONFIG`.
- `scripts/setup-supabase.sh`: deploy function thứ tư, chạy migration 013 và migration hardening, rồi in config mới.
- `README.md` và `supabase/README.md`: hướng dẫn setup và vận hành.

## 4. Luồng nghiệp vụ

### 4.1 User gửi post hint

User extension không gọi endpoint danh sách bài. Nguồn hint được phép:

- `article_page`: user mở URL một bài TechHub; extension lấy URL/UUID/ID và metadata công khai trong DOM nếu có.
- `post_created`: extension quan sát được điều hướng tới bài vừa tạo.
- `existing_response`: chức năng khác đã có article payload và tái sử dụng payload đó.

Chrome `webRequest` không đọc response body của trang theo cách ổn định. Không monkey-patch `window.fetch`. Nếu DOM chỉ có URL/UUID thì gửi hint tối thiểu; leader xác minh sau.

```text
User mở/đăng bài
  → background nhận tabs.onUpdated hoặc dữ liệu sẵn có
  → xác nhận URL thuộc TechHub article
  → debounce cùng URL trong 30 phút
  → post-sync-api.submitPostHint
  → tạo verify_hint job nếu chưa có
```

Hint không tự tạo campaign và chưa được coi là bài chính thức.

### 4.2 Leader xác minh hint

```text
Admin leader claim verify_hint
  → lấy article detail bằng session TechHub local
  → kiểm tra ID/UUID/username
  → upsert posts
  → complete job và mark hint verified
```

Nếu username trong hint khác tác giả thật, đánh dấu `rejected/author_mismatch`.

### 4.3 Feed discovery

Leader tái sử dụng `fetchTechHubCommunityArticles()` hiện có:

- Cửa sổ `now - 7 days` tới `now`.
- Lọc tác giả có trong `users` và không bị khóa.
- Dừng khi gặp bài cũ hơn 7 ngày hoặc cursor đã xử lý.
- Upsert bài với `discovered_by = feed`.
- Chỉ một job feed active cho cùng community.
- Chạy mỗi 60 phút, làm fallback khi user không gửi hint.

### 4.4 Reconcile theo username

Leader tái sử dụng `fetchTechHubArticles(username, page)`:

- Chỉ chọn user có `next_check_at <= now()`.
- Mặc định mỗi 24 giờ; cấu hình cho phép 12–24 giờ.
- Dừng pagination khi gặp bài cũ hơn 7 ngày.
- Concurrency tối đa 2–3 user.
- Delay 1–2 giây và jitter.
- Quét tay một user cách lượt gần nhất tối thiểu 10 phút.

Riêng nút **Quét bài** trên máy admin là thao tác đồng bộ trực tiếp: extension
đã tải đủ danh sách từ TechHub sẽ gửi các lô bài qua action admin
`saveScannedPosts` để upsert `posts` ngay. Luồng này không đi qua cooldown hoặc
hàng đợi leader; hàng đợi `user_reconcile` chỉ dùng cho đồng bộ nền.
Popup không render toàn bộ payload quét: danh sách chính chỉ đọc tối đa 100 bài
có `published_at IS NULL`; bài đã publish vẫn có thể được lưu phục vụ cache và
nghiệp vụ đồng bộ khác nhưng không xuất hiện trong danh sách này.

### 4.5 Campaign đọc dữ liệu sync

`engagement-api.planCampaign` chỉ nhận bài thỏa:

```text
verification_status = verified
last_verified_at IS NOT NULL
status = open
published_at nằm trong phạm vi campaign
author không bị khóa
```

Bài bị đánh dấu `closed`, `deleted` hoặc `rejected` làm task chưa chạy chuyển `cancelled/skipped` kèm reason.

## 5. Migration 013

### 5.1 Bổ sung `posts`

Thêm:

```text
verification_status  unverified|verified|stale|rejected
first_seen_at
last_seen_at
last_verified_at
discovered_by        hint|feed|user_reconcile|legacy
sync_run_id
sync_error
```

Index: `(username, published_at desc)`, `(verification_status, published_at desc)`, `(last_verified_at)`.

Backfill: bài hiện có đủ ID, UUID và username được gán `verified/legacy`; bài thiếu định danh giữ `unverified`.

### 5.2 `post_hints`

```text
id, username, device_id
identifier_key       id:<id> | uuid:<uuid> | url:<normalized-url>
techhub_id, techhub_uuid, url, title_hint, published_at_hint
source, status, attempt_count, next_retry_at, last_error
observed_at, verified_at, created_at, updated_at
```

Unique `(username, identifier_key)`. Hint trùng chỉ cập nhật thời gian/metadata còn thiếu, không tạo job active thứ hai.

### 5.3 `post_sync_jobs`

```text
id
type                 verify_hint|feed_discovery|user_reconcile
status               pending|claimed|running|retry_wait|succeeded|failed|session_required|cancelled
source_id, hint_id, username, payload
scheduled_at, claimed_at, claimed_by_device, lease_until
attempt_count, max_attempts
idempotency_key unique
last_http_status, last_error, created_at, updated_at
```

Idempotency scope:

```text
verify:<hint_id>
feed:<community>:<time_bucket>
user:<username>:<date_bucket>
```

### 5.4 `post_sync_sources`

```text
id, type community|user, source_key
enabled, cursor
last_checked_at, next_check_at, last_success_at
last_error, interval_minutes, created_at, updated_at
```

Unique `(type, source_key)`.

### 5.5 `post_sync_runs`

```text
id, job_id, source_id, leader_device_id
started_at, finished_at
outcome succeeded|partial|failed|session_required
request_count, page_count
new_count, updated_count, unchanged_count, rejected_count
last_cursor, http_status, error_summary, created_at
```

### 5.6 RPC claim atomic

Tạo `claim_post_sync_job(admin_device_id, lease_seconds)`:

1. Trả job hết lease về `pending/retry_wait`.
2. Nếu device đang giữ job còn lease, trả lại đúng job đó.
3. Chọn job đến hạn theo priority `verify_hint → feed_discovery → user_reconcile`.
4. Dùng `FOR UPDATE SKIP LOCKED`.
5. Lease tối thiểu 60 giây, mặc định 10 phút.

Thu quyền execute khỏi `PUBLIC`, `anon`, `authenticated`; chỉ service role gọi.

### 5.7 RLS

- Bật RLS cho mọi bảng mới.
- Client không ghi trực tiếp.
- Device gửi hint qua API; server lấy username từ device token, không tin username trong body.
- Admin đọc/điều khiển sync qua API bằng `ADMIN_TOKEN`.

## 6. `post-sync-api`

### 6.1 Xác thực

- Device action dùng device token trong `engagement_devices`.
- Admin action dùng `ADMIN_TOKEN`.
- Leader action yêu cầu admin token và device chưa revoke.
- API không nhận cookie/CSRF và không log token.

### 6.2 Actions

`submitPostHint` — device:

```json
{
  "action": "submitPostHint",
  "deviceId": "...",
  "identifier": { "techhubUuid": "...", "url": "..." },
  "source": "article_page",
  "observedAt": "2026-09-11T00:00:00Z",
  "metadata": { "title": "...", "publishedAt": null }
}
```

Response: `hintId`, `status`, `createdJob`.

`requestPostSync` — admin:

```json
{ "scope": "feed", "communitySlug": "cai-tien-moi-ngay" }
{ "scope": "user", "username": "user01" }
{ "scope": "due_users" }
```

Chỉ enqueue, không chờ quét xong.

Leader actions:

- `claimPostSyncJob`
- `startPostSyncRun`
- `extendPostSyncLease`
- `completePostSyncJob`
- `failPostSyncJob`

Read actions admin:

- `getPostSyncStatus`
- `listPostSyncRuns`
- `listPostHints`
- `listNewPosts`
- `getUserSyncStatus`

Server tự upsert normalized articles khi complete; client không tự quyết trạng thái verified.

## 7. Extension worker

### 7.1 Config

```javascript
const POST_SYNC_API_CONFIG = {
  url: "https://<project-ref>.supabase.co/functions/v1/post-sync-api",
  adminToken: ""
};
```

Máy admin điền `adminToken`; user thường để trống.

### 7.2 Alarm

```text
postSyncLeaderWake          mỗi 5 phút trên máy admin
postSyncFeedSchedule        enqueue khi feed đến hạn
postSyncReconcileSchedule   enqueue due_users khi đến hạn
```

Mọi admin device có thể thức dậy nhưng API chỉ cho một device claim. Worker xử lý tối đa một job mỗi wake để phù hợp MV3.
Khi service worker khởi động trên máy leader, worker dọn local lock mồ côi, enqueue và claim ngay một lượt để lease/online được ghi nhận; alarm 5 phút tiếp tục là cơ chế dự phòng.

### 7.3 Silent operation

- Không Chrome notification.
- Không tự mở tab để refresh session.
- Không popup/alert khi panel đóng.
- 401/403 lưu `session_required` và dừng claim mới.
- Khi admin mở panel mới kiểm tra session và hiện nút đăng nhập lại.

### 7.4 Lock local

Lưu local lock có TTL trong `chrome.storage.local`. Server lease vẫn là nguồn sự thật; local lock chỉ ngăn hai handler cùng extension chạy chồng.

## 8. UI

### 8.1 User — “Bài viết của tôi”

- Chỉ đọc cache Supabase.
- Hiển thị comment, vote, `last_verified_at`, `verified/stale`.
- Không có nút quét feed.
- Gửi hint im lặng khi nhận diện bài của chính user.
- Switch tham gia thảo luận thuộc engagement, độc lập với sync.

### 8.2 Admin — menu “Đồng bộ bài viết”

- Luồng mặc định chỉ có một nút **Đồng bộ ngay**: kiểm tra phiên TechHub, xếp job feed và cho máy leader xử lý ngay. UI dùng trạng thái tiếng Việt dễ hiểu; leader/lease/queue, nguồn và lịch sử được đưa vào phần nâng cao.

Tổng quan:

- Leader hiện tại, online/offline, lease expiry.
- Nút **Nhận leader & chạy ngay** cho phép admin claim lease và xử lý một job tức thời; yêu cầu **Quét user** cũng kích hoạt lượt này sau khi enqueue thành công.
- Queue pending/running/retry/session_required.
- Feed discovery gần nhất/kế tiếp và request count 24 giờ.

Bài mới:

- Lọc 7 ngày, username, nguồn `hint/feed/reconcile`.
- Nhãn `new/updated/verified/stale/rejected`.
- Link mở bài TechHub.

Quét:

- Chọn community.
- Chọn một username hoặc `due_users`.
- Nút “Quét 7 ngày” chỉ enqueue.
- Hiện cooldown và thời điểm có thể chạy lại.

Lịch sử:

- Run time, duration, request/page count.
- New/updated/unchanged/rejected.
- HTTP status và error summary.

## 9. Request budget

| Nguồn | Lịch | Request dự kiến |
|---|---|---:|
| Post hint | Theo hoạt động tự nhiên | 0 lượt quét feed trên máy user |
| Verify hint | Khi có bài mới | Khoảng 1 request/bài |
| Feed discovery | Mỗi 60 phút | Khoảng 1–3 request/lượt |
| User reconcile | Mỗi 24 giờ | Tối thiểu khoảng 30 request/lượt |

Hard limits:

```text
max_requests_per_run = 50
max_pages_per_source = 5
max_concurrency = 3
request_delay_ms = 1500
manual_user_scan_cooldown_minutes = 10
```

Chạm budget chuyển run thành `partial`, lưu cursor và enqueue continuation. Không reset từ trang đầu.

## 10. Retry và lỗi

| Trường hợp | Xử lý |
|---|---|
| 401/403 | `session_required`, dừng leader, không mở tab |
| 429 | Dùng `Retry-After` hoặc exponential backoff |
| 5xx/network | Retry tối đa `max_attempts`, giữ cursor |
| Leader mất kết nối | Lease hết hạn, leader khác tiếp tục |
| Hint sai author | `rejected/author_mismatch`, không retry |
| Bài không tồn tại | `rejected/not_found`; bài từng verified chuyển deleted |
| Bài thiếu ngày | Giữ unverified, không đưa vào campaign |
| Chạm request budget | `partial`, tạo continuation job |

Backoff: 5 phút → 15 phút → 1 giờ → 6 giờ; 429 ưu tiên header server.

## 11. Thứ tự code

### Phase 1 — Database và API nền

1. Migration 013, migration hardening và các RPC claim/start/complete.
2. `post-sync-api`: auth, hint, enqueue, claim, complete/fail.
3. Test RLS, ownership và claim concurrency.

### Phase 2 — Leader worker

1. `post-sync-client.js`.
2. `post-sync-worker.js` với local lock/server lease.
3. Verify hint bằng article detail.
4. Feed discovery 7 ngày.
5. User reconcile và pagination stop.

### Phase 3 — UI và hint

1. Menu admin “Đồng bộ bài viết”.
2. User đọc cache và thời gian verified.
3. Hint từ URL/DOM/dữ liệu sẵn có.
4. Silent session handling.

### Phase 4 — Tích hợp engagement

1. Planner chỉ dùng bài verified.
2. Cancel/skip task của bài đóng/xóa.
3. Hiển thị nguồn và độ mới khi chọn bài campaign.

### Phase 5 — Deploy

1. Chạy migration 013, sau đó `20260911100410_post_sync_hardening.sql`.
2. Deploy `post-sync-api`.
3. Cập nhật config admin/user.
4. Reload máy admin, xác nhận leader.
5. Rollout nhóm user nhỏ rồi mở toàn bộ.

## 12. Kiểm thử bắt buộc

Unit:

- Chuẩn hóa article payload/URL và `identifier_key`.
- Dừng pagination đúng mốc 7 ngày.
- Merge hint trùng.
- Backoff và request budget.

Database/API:

- Hai leader claim đồng thời chỉ một máy nhận job.
- Lease hết hạn được reclaim.
- Device không submit hint cho username khác.
- Anon không ghi được bảng sync.
- Complete idempotent không tạo bài/run trùng.

Extension:

- User mở bài gửi tối đa một hint trong 30 phút.
- Mở “Bài viết của tôi” không gọi endpoint danh sách TechHub.
- Hai admin online chỉ một leader gọi TechHub.
- Restart service worker tiếp tục từ cursor.
- 401/403 không notification và không tự mở tab.

End-to-end:

1. User A mở bài mới → hint → leader verify → bài vào cache.
2. User không mở extension → feed phát hiện trong tối đa 60 phút.
3. Reconcile 30 user không vượt concurrency/budget.
4. Bài verified xuất hiện trong campaign; bài unverified không xuất hiện.

## 13. Definition of Done

- Migration 013 và migration hardening áp thành công; advisor không có lỗi bảo mật nghiêm trọng mới.
- `post-sync-api` deploy; test auth/RLS/claim pass.
- User thường không còn quét toàn bộ bài TechHub.
- Feed discovery/reconcile ghi đủ run metrics.
- Hint không gửi cookie/CSRF và không tạo request feed mới.
- Failover leader hoạt động sau khi lease hết hạn.
- Request budget được enforce ở API và worker.
- UI admin xem được leader, queue, bài mới và run history.
- Campaign chỉ dùng bài verified.
- Không notification hoặc tab tự mở khi session hết hạn.
- README và setup script có migration 013, migration hardening, function thứ tư và config mới.
