-- AI tự thảo luận: lưu nội dung comment do AI tạo
-- Chạy sau 004_ai_reply_drafts.sql

BEGIN;

CREATE TABLE IF NOT EXISTS public.discussion_drafts (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  techhub_id BIGINT NOT NULL,
  source_comment_id BIGINT,
  source_comment_body TEXT,
  discussion_body TEXT NOT NULL,
  model TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'used',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_discussion_drafts_source_unique
  ON public.discussion_drafts (username, source_comment_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_interactions_discussion_unique
  ON public.interactions (username, parent_comment_id)
  WHERE interaction_type = 'discussion' AND parent_comment_id IS NOT NULL;

ALTER TABLE public.discussion_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ext_discussion_drafts_all" ON public.discussion_drafts;
CREATE POLICY "ext_discussion_drafts_all" ON public.discussion_drafts
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.discussion_drafts TO anon, authenticated;
GRANT ALL ON SEQUENCE public.discussion_drafts_id_seq TO anon, authenticated;

INSERT INTO public.settings (key, value, description)
VALUES
  ('enable_ai_discussion', 'false'::jsonb, 'Bật/tắt AI tự tạo comment gốc trên chính bài viết'),
  ('ai_discussion_max_per_run', '1'::jsonb, 'Số comment thảo luận tối đa mỗi lần chạy')
ON CONFLICT (key) DO UPDATE
SET description = EXCLUDED.description, updated_at = NOW();

COMMIT;
