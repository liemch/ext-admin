-- Upgrade nếu đã chạy 001 bản cũ (không có kind / parent_comment_id / settings auto-reply)
-- An toàn khi chạy lại (IF NOT EXISTS / ON CONFLICT)

BEGIN;

ALTER TABLE public.comment_templates
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'comment';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'comment_templates_kind_check'
  ) THEN
    ALTER TABLE public.comment_templates
      ADD CONSTRAINT comment_templates_kind_check
      CHECK (kind IN ('comment', 'reply'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_comment_templates_kind
  ON public.comment_templates (kind, is_active);

ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS parent_comment_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_interactions_reply_unique
  ON public.interactions (username, parent_comment_id)
  WHERE interaction_type = 'reply' AND parent_comment_id IS NOT NULL;

INSERT INTO public.settings (key, value, description)
VALUES
  ('enable_auto_reply', 'false'::jsonb, 'Bật/tắt tự trả lời comment trên bài của mình'),
  ('auto_reply_max_per_run', '5'::jsonb, 'Số reply tối đa mỗi lần chạy auto-reply'),
  ('enable_ai_reply', 'false'::jsonb, 'Placeholder phase 2: AI reply (chưa dùng)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.comment_templates (content, is_active, kind)
SELECT t.content, TRUE, 'reply'
FROM (
  VALUES
    ('Cảm ơn bạn đã góp ý!'),
    ('Thanks bạn nhiều nha 🙏'),
    ('Mình ghi nhận nhé, cảm ơn!'),
    ('Cảm ơn feedback của bạn 💯'),
    ('Hay quá, cảm ơn bạn đã comment!'),
    ('Mình sẽ xem thêm, cảm ơn bạn!'),
    ('Appreciate bạn đã chia sẻ ✨'),
    ('Cảm ơn bạn đã ủng hộ bài viết!')
) AS t(content)
WHERE NOT EXISTS (
  SELECT 1 FROM public.comment_templates WHERE kind = 'reply' LIMIT 1
);

COMMIT;
