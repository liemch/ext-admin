# Hướng dẫn cho agent trong `supabase/`

Áp dụng thêm `../AGENTS.md`. Đọc `supabase/README.md` và README của function liên
quan trước khi đổi schema hay API.

## Migration

- Chỉ thêm migration mới với số tiếp theo; không sửa migration đã chạy production,
  trừ khi task đang sửa lỗi trước khi migration đó được phát hành rộng rãi.
- Migration phải chạy trong transaction khi PostgreSQL cho phép và an toàn khi
  người vận hành chạy lại sau một lần rollback.
- Dùng kiểu rõ ràng. Cột `settings.value` là `jsonb`: số/boolean phải cast
  `::jsonb`, chuỗi phải là JSON string hợp lệ, ví dụ `'"value"'::jsonb`.
- Tạo index cho đường truy vấn/claim chính. Giữ claim atomic, lease có thời hạn
  và idempotency key cho queue.
- Bật RLS cho bảng public mới. Mặc định anon/authenticated chỉ được quyền tối
  thiểu; mọi ghi đặc quyền đi qua Edge Function bằng service role. Revoke RPC
  nội bộ khỏi anon/authenticated.
- Cuối migration có thay đổi schema dùng `NOTIFY pgrst, 'reload schema'` khi cần.

Sau khi sửa, chạy `git diff --check` và rà tất cả grant/policy/RPC. Khi test trên
remote, dùng project dev và báo rõ câu lệnh đã chạy; không tự áp migration lên
production nếu task không yêu cầu.

## Thứ tự phát hành

Đọc dependency của thay đổi để chọn thứ tự. Thông thường deploy function tương
thích ngược, áp migration, rồi gọi endpoint read-only để smoke test. Nếu function
đòi bảng mới ngay khi khởi động, áp migration trước. Không chạy `db push` mù khi
lịch sử migration remote chưa được xác nhận.

