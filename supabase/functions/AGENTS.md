# Hướng dẫn cho agent trong `supabase/functions/`

Áp dụng `../../AGENTS.md` và `../AGENTS.md`.

## Contract Edge Function

Mỗi function là một Deno entrypoint độc lập. Giữ action name, request/response
shape và status code tương thích với client extension. Nếu đổi contract, cập nhật
README của function, client, worker/background và test offline trong cùng task.

- Xác thực bearer token trước action đặc quyền.
- `ADMIN_TOKEN` dùng chung cho `admin-api`, `engagement-api`, `post-sync-api`;
  không trả token về response hoặc log.
- Dùng service-role chỉ ở server. Không đưa service-role key vào extension.
- Validate và giới hạn mọi input, pagination, batch size, concurrency và rate.
- Lỗi trả message đủ vận hành nhưng không chứa secret, cookie, raw auth header
  hoặc dữ liệu nhạy cảm.
- Claim/complete/fail phải chịu được retry. Kiểm tra owner/lease trước mutation.
- 401/403 từ TechHub được phân loại thành `session_required`; worker dừng im lặng
  tới khi user chủ động đăng nhập lại.
- CORS phải phù hợp Chrome Extension và request `OPTIONS` phải được xử lý.

## Deploy và smoke test

Deploy riêng function đã đổi:

```bash
supabase functions deploy <function-name> --no-verify-jwt --project-ref <ref>
supabase functions list --project-ref <ref>
```

Không set/rotate secret nếu code không yêu cầu. Smoke test ưu tiên action đọc như
`getStatus`; không in bearer token vào terminal output hay lưu header ngoài file
tạm có permission `0600`. Xóa file tạm sau kiểm tra.

Chạy test contract liên quan trước deploy:

```bash
node scripts/test-engagement.mjs
node scripts/test-post-sync.mjs
git diff --check
```
