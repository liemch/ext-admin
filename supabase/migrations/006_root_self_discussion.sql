-- Đổi AI tự thảo luận sang comment gốc trên chính bài viết (không reply).
-- Chạy sau 005_ai_discussion.sql.

BEGIN;

ALTER TABLE public.discussion_drafts
  ALTER COLUMN source_comment_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_discussion_drafts_post_created
  ON public.discussion_drafts (username, techhub_id, created_at DESC);

UPDATE public.settings
SET description = 'Bật/tắt AI tự tạo comment gốc trên chính bài viết',
    updated_at = NOW()
WHERE key = 'enable_ai_discussion';

UPDATE public.settings
SET description = 'Thiết lập cũ; số lượng mục tiêu hiện được cấu hình theo job trong extension',
    updated_at = NOW()
WHERE key = 'ai_discussion_max_per_run';

COMMIT;
