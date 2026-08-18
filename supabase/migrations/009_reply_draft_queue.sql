-- Tối ưu kho mẫu reply theo bài và trạng thái pending/used/posting.
-- Chạy sau 008_discussion_draft_queue.sql.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_reply_drafts_queue
  ON public.reply_drafts (username, techhub_id, status, created_at ASC);

COMMIT;
