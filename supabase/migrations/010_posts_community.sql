-- Lưu bài quét theo chuyên mục để không phải gọi lại TechHub mỗi lần xem.
-- Chạy sau 009_reply_draft_queue.sql.

BEGIN;

ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS community_slug VARCHAR(120);
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS community_name TEXT;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_posts_community
  ON public.posts (community_slug, published_at DESC);

COMMIT;

NOTIFY pgrst, 'reload schema';
