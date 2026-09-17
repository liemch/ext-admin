# Setup DB — My Angel

## Mục tiêu extension

1. **Capture session** TechHub (cookie/CSRF) trong background
2. **Quét bài** của user → lưu bảng `posts`
3. **Push comment** vào bài khi cần (template `kind=comment`)
4. **Auto-reply** comment trên bài của mình
   - Phase 1: template `kind=reply`
   - Phase 2: NVIDIA AI đọc nội dung bài + chuỗi hội thoại → lưu `reply_drafts` → reply
5. **AI tự thảo luận** đọc nội dung bài + các comment gốc trước → tạo comment gốc mới trên bài của mình
   - Đếm riêng từng bài, chạy tới số lượng mục tiêu
   - Mỗi lượt cách ngẫu nhiên 1–5 phút, không reply comment
6. **Hẹn xóa bài** qua `DELETE /articles/{uuid}/`

## Bảng

| Bảng | Vai trò |
|------|---------|
| `users` | Profile đã sync + `is_admin` / `is_moderator` / `is_locked` |
| `posts` | Bài đã quét + `is_ultra` |
| `settings` | `enable_auto_reply`, `enable_ai_reply`, `auto_reply_max_per_run`, … |
| `comment_templates` | Template `kind=comment` hoặc `kind=reply` |
| `interactions` | Dedup comment/like/reply |
| `reply_drafts` | Draft AI gen trước khi reply |
| `discussion_drafts` | Draft AI gen cho comment thảo luận độc lập |
| `engagement_devices` | Máy đã đăng ký (hash device token, `revoked` để thu hồi) |
| `device_enrollment_invitations` | Mã mời một lần, gắn username và hết hạn sau 24 giờ |
| `user_consents` / `user_consent_events` | Consent versioned hiện tại và audit thay đổi/pause/disconnect |
| `engagement_campaigns` | Campaign vote/comment + phạm vi bài + quota |
| `engagement_tasks` | Task hàng đợi (lease, `idempotency_key`, `session_required`) |
| `engagement_events` | Nhật ký claim/succeed/fail/retry (dọn định kỳ) |
| `engagement_preferences` | Policy admin, điểm đóng góp và số lượt Ultra của từng user (migration 014) |
| `engagement_reward_events` | Sổ điểm idempotent, mỗi task thành công chỉ ghi một lần |
| `engagement_boost_requests` | Yêu cầu ưu tiên bài do admin Push hoặc user đổi Ultra |
| `discussion_threads` / `discussion_turns` | Kịch bản thảo luận A/B 2–3 turn + dependency |
| `post_hints` | Gợi ý bài từ user mở/đăng bài (lightweight signal; leader verify sau) |
| `post_sync_jobs` | Hàng đợi verify_hint / feed_discovery / user_reconcile (lease + idempotency) |
| `post_sync_runs` | Lịch sử chạy từng lượt (request count, số bài mới/cập nhật, lỗi) |
| `post_sync_sources` | Nguồn quét (community/user) — lưu con trỏ trang, thời gian kế tiếp |

Cột bổ sung trên `posts` (migration 013): `verification_status` (unverified/verified/stale/rejected), `discovered_by` (post_hint/feed_discovery/user_reconcile/legacy), `first_seen_at`, `last_verified_at`, `sync_run_id`, `sync_error`. Migration `20260911100410_post_sync_hardening.sql` khóa quyền ghi từ client và bổ sung global leader lease cùng RPC hoàn tất atomic.

## Edge Functions

| Function | Việc | Bảo vệ |
|---|---|---|
| `nvidia-proxy` | Proxy AI NVIDIA — key nằm trong secret, không nằm trong extension | `PROXY_TOKEN` |
| `admin-api` | Quản lý user (danh sách / cấp-thu quyền / khóa / xóa) qua service role, bypass RLS sau migration 011 | `ADMIN_TOKEN` — **chỉ máy admin được giữ** |
| `engagement-api` | Pool tương tác tự cân bằng + hàng đợi lease; campaign/kịch bản cũ giữ tương thích — chỉ phân bổ bài `verification_status = verified` | `ADMIN_TOKEN` cho admin; máy user dùng device token tự sinh |
| `post-sync-api` | Mỗi user tự đồng bộ bài TechHub của mình vào `posts`, đồng thời dọn bài đã xóa sau một lượt quét đầy đủ; giữ API leader cũ để tương thích/bảo trì | Device token cho `saveMyScannedPosts` + `reconcileMyScannedPosts` + `listNewPosts`, khóa theo username; `ADMIN_TOKEN` cho action quản trị cũ |

Deploy + set secrets + áp migration 011 → 016 và hardening post-sync một phát:
`bash scripts/setup-supabase.sh`. Không dùng lệnh này để deploy một thay đổi nhỏ
trên project đang hoạt động vì script sinh lại token.

## Setup project mới

1. Tạo project Supabase → lấy URL + anon key
2. SQL Editor → Run `migrations/001` → `002` → (`003` nếu upgrade) → `004_ai_reply_drafts.sql` → `005_ai_discussion.sql` → `006_root_self_discussion.sql` → `007_posts_medals_count.sql` → `008_discussion_draft_queue.sql` → `009_reply_draft_queue.sql` → `010` (community) → `011_restrict_users_writes.sql` → `012_cross_user_engagement.sql` → `013_post_sync.sql` → `20260911100410_post_sync_hardening.sql` → `014_engagement_user_pool.sql` → `015_expand_discussion_thread_quota.sql` → `016_add_moderator_role.sql` → `20260917020158_identity_consent_enrollment.sql`
3. Sửa `YOUR_TECHHUB_USERNAME` trong `002` → Run
4. Điền `NVIDIA_CONFIG.apiKey` trong `config.js` (lấy tại https://build.nvidia.com/settings/api-keys)
5. Reload extension

## TechHub / NVIDIA API

- `GET /api/v1/articles/?username=` — quét bài
- `GET /api/v1/articles/{uuid}/` — lấy nội dung đầy đủ của bài
- `GET /api/v1/articles/{uuid}/comments/?sort=new` — list comment
- `POST /api/v1/comments/` — `{ article, body, ancestry? }`
- `DELETE /api/v1/articles/{uuid}/` — xóa bài
- `POST https://integrate.api.nvidia.com/v1/chat/completions` — gen reply

## Kiểm tra

```sql
SELECT key, value FROM settings ORDER BY key;
SELECT kind, count(*) FROM comment_templates WHERE is_active GROUP BY kind;
SELECT username, is_admin, is_moderator, is_locked FROM users;
SELECT count(*) FROM reply_drafts;
SELECT count(*) FROM discussion_drafts;
SELECT status, count(*) FROM engagement_tasks GROUP BY status;
SELECT username, revoked, last_seen_at FROM engagement_devices ORDER BY last_seen_at DESC;
SELECT verification_status, discovered_by, count(*) FROM posts GROUP BY 1,2 ORDER BY 1,2;
SELECT status, type, count(*) FROM post_sync_jobs GROUP BY 1,2 ORDER BY 1,2;
SELECT source, status, count(*) FROM post_hints GROUP BY 1,2 ORDER BY 1,2;
```
