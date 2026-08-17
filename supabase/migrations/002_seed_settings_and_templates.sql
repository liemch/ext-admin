-- Seed tối thiểu cho DB riêng
-- Chạy SAU 001_init_schema.sql
-- Nhớ đổi YOUR_TECHHUB_USERNAME trước khi Run

BEGIN;

INSERT INTO public.settings (key, value, description)
VALUES
  ('max_comments', '9'::jsonb, 'Ngưỡng comment; job/extension có thể bỏ qua bài vượt ngưỡng'),
  ('push_ultra', 'false'::jsonb, 'Bật/tắt ưu tiên push bài is_ultra'),
  ('exceed_max_1_users', '""'::jsonb, 'CSV usernames được vượt ngưỡng tối đa 1 bài'),
  ('exceed_max_3_users', '""'::jsonb, 'CSV usernames được vượt ngưỡng tối đa 3 bài'),
  ('enable_auto_reply', 'false'::jsonb, 'Bật/tắt tự trả lời comment trên bài của mình'),
  ('auto_reply_max_per_run', '5'::jsonb, 'Số reply tối đa mỗi lần chạy auto-reply'),
  ('enable_ai_reply', 'false'::jsonb, 'Placeholder phase 2: AI reply (chưa dùng)')
ON CONFLICT (key) DO UPDATE
SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  updated_at = NOW();

-- Template comment (push / cross comment)
INSERT INTO public.comment_templates (content, is_active, kind)
SELECT t.content, TRUE, 'comment'
FROM (
  VALUES
    ('Bài viết rất hay và hữu ích'),
    ('Tuyệt vời quá 👏'),
    ('Thông tin rất giá trị 💎'),
    ('Quá xuất sắc 🌟'),
    ('Bài viết rất chất lượng 💯'),
    ('10 điểm không có nhưng 🔟'),
    ('Đỉnh của chóp 🏔️'),
    ('Rất đáng đọc 📖'),
    ('Hay thật sự 🤩'),
    ('Đọc cuốn quá 👁️'),
    ('Nội dung rất hay 📝'),
    ('Quá tuyệt vời ✨'),
    ('Like mạnh cho bài viết ❤️'),
    ('Rất thích bài viết này 😍'),
    ('Bài viết có tâm quá ❤️‍🔥'),
    ('Chất lượng thật sự 🏆'),
    ('Không thể chê vào đâu được 👌'),
    ('Tuyệt cú mèo 🐱'),
    ('Rất truyền cảm hứng 🌈'),
    ('Cảm ơn vì đã chia sẻ!')
) AS t(content)
WHERE NOT EXISTS (
  SELECT 1 FROM public.comment_templates WHERE kind = 'comment' LIMIT 1
);

-- Template reply (auto-reply trên bài của mình)
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

INSERT INTO public.users (full_name, username, is_admin, is_locked, last_update)
VALUES ('Admin', 'YOUR_TECHHUB_USERNAME', TRUE, FALSE, NOW())
ON CONFLICT (username) DO UPDATE
SET is_admin = TRUE, last_update = NOW();

COMMIT;
