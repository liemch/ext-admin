-- 016: Thêm vai trò moderator và khóa các cột đặc quyền khi user tự đăng ký.
--
-- Admin tiếp tục quản lý is_admin/is_moderator/is_locked qua admin-api bằng
-- service role. Client anon chỉ được tạo/cập nhật các cột profile an toàn.

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_moderator BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_is_moderator
  ON public.users (is_moderator);

REVOKE INSERT, UPDATE, DELETE ON public.users FROM anon, authenticated;

GRANT INSERT (full_name, username, email, avatar, last_update, created_at)
  ON public.users TO anon, authenticated;

GRANT UPDATE (full_name, email, avatar, last_update)
  ON public.users TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
