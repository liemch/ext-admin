-- Tối ưu kho mẫu thảo luận theo bài và trạng thái pending/used/posting.
-- Chạy sau 007_posts_medals_count.sql.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_discussion_drafts_queue
  ON public.discussion_drafts (username, techhub_id, status, created_at ASC);

COMMIT;
