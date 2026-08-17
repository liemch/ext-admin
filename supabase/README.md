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
| `users` | Profile đã sync + `is_admin` |
| `posts` | Bài đã quét + `is_ultra` |
| `settings` | `enable_auto_reply`, `enable_ai_reply`, `auto_reply_max_per_run`, … |
| `comment_templates` | Template `kind=comment` hoặc `kind=reply` |
| `interactions` | Dedup comment/like/reply |
| `reply_drafts` | Draft AI gen trước khi reply |
| `discussion_drafts` | Draft AI gen cho comment thảo luận độc lập |

## Setup project mới

1. Tạo project Supabase → lấy URL + anon key
2. SQL Editor → Run `migrations/001` → `002` → (`003` nếu upgrade) → `004_ai_reply_drafts.sql` → `005_ai_discussion.sql` → `006_root_self_discussion.sql` → `007_posts_medals_count.sql`
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
SELECT username, is_admin FROM users;
SELECT count(*) FROM reply_drafts;
SELECT count(*) FROM discussion_drafts;
```
