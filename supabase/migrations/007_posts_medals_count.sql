-- Lưu số medal trên bài để tính điểm (1 medal = 6 điểm).
-- Chạy sau 006_root_self_discussion.sql.

BEGIN;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS medals_count INTEGER NOT NULL DEFAULT 0;

COMMIT;
