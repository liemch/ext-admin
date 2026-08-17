-- Phase 2: lưu draft reply do AI gen (audit / tái dùng)
-- Chạy sau 001-003

BEGIN;

CREATE TABLE IF NOT EXISTS public.reply_drafts (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  techhub_id BIGINT NOT NULL,
  parent_comment_id BIGINT NOT NULL,
  comment_author VARCHAR(100),
  comment_body TEXT,
  reply_body TEXT NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'nvidia',
  model TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'used',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reply_drafts_lookup
  ON public.reply_drafts (username, parent_comment_id);

ALTER TABLE public.reply_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ext_reply_drafts_all" ON public.reply_drafts;
CREATE POLICY "ext_reply_drafts_all" ON public.reply_drafts
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.reply_drafts TO anon, authenticated;
GRANT ALL ON SEQUENCE public.reply_drafts_id_seq TO anon, authenticated;

INSERT INTO public.settings (key, value, description)
VALUES
  ('enable_ai_reply', 'true'::jsonb, 'Dùng NVIDIA AI để gen nội dung auto-reply'),
  ('ai_reply_fallback_template', 'true'::jsonb, 'Nếu AI lỗi thì fallback sang template reply')
ON CONFLICT (key) DO UPDATE
SET
  description = EXCLUDED.description,
  updated_at = NOW();

COMMIT;
