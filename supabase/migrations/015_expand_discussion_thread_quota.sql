-- 015: Cho phép admin cấu hình 30–40 (tối đa 50) chuỗi độc lập cho mỗi bài.
-- Mỗi chuỗi vẫn chỉ gồm 2 hoặc 3 turn theo contract discussion_threads.

BEGIN;

ALTER TABLE public.engagement_preferences
  ALTER COLUMN discussions_per_post SET DEFAULT 40,
  DROP CONSTRAINT IF EXISTS engagement_preferences_discussions_per_post_check;

ALTER TABLE public.engagement_preferences
  ADD CONSTRAINT engagement_preferences_discussions_per_post_check
    CHECK (discussions_per_post BETWEEN 1 AND 50);

INSERT INTO public.settings (key, value, description)
VALUES (
  'engagement_pool_discussions_per_post',
  '40',
  'Số chuỗi thảo luận độc lập trên mỗi bài (mỗi chuỗi 2–3 turn, tối đa 50)'
)
ON CONFLICT (key) DO UPDATE
SET description = EXCLUDED.description,
    updated_at = NOW();

COMMIT;
NOTIFY pgrst, 'reload schema';
