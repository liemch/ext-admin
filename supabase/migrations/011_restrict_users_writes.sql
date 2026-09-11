-- 011: Chặn anon tự cấp admin / tự xóa user
--
-- Vấn đề: anon key nằm trong extension (và từng nằm trong repo public).
-- Với RLS mở hoàn toàn như 001, ai có anon key cũng PATCH được
-- is_admin = true cho chính mình hoặc DELETE user tùy ý → hệ thống phân
-- quyền menu chỉ còn là UI.
--
-- Giải pháp: các thao tác quản lý user chuyển qua edge function admin-api
-- (service role + ADMIN_TOKEN chỉ có trên máy quản trị viên). Sau đó thu
-- lại quyền ghi của anon trên bảng users:
--   Giữ:       SELECT (gate check phân quyền), INSERT (user mới tự đăng ký)
--   Giữ (cột): UPDATE full_name, email, avatar, last_update (sync hoạt động)
--   Chặn:      UPDATE is_admin / is_locked, DELETE
--
-- ⚠️ CHẠY SAU KHI đã deploy admin-api (scripts/setup-supabase.sh làm sẵn),
--    nếu không menu Người dùng sẽ báo lỗi.
--
-- Hoàn tác (nếu cần): GRANT UPDATE, DELETE ON public.users TO anon;

BEGIN;

REVOKE DELETE ON public.users FROM anon;
REVOKE UPDATE ON public.users FROM anon;
GRANT UPDATE (full_name, email, avatar, last_update) ON public.users TO anon;

-- Reload schema cache của PostgREST để quyền mới có hiệu lực ngay
NOTIFY pgrst, 'reload schema';

COMMIT;
