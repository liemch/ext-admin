\set ON_ERROR_STOP on
BEGIN;

-- R5: kho bài, revision bất biến và phân lịch (PLAN_PRODUCT_9_10 mục 19.1, 21).
-- Chạy trên project DEV: psql -f scripts/test-r5-content-scheduling.sql

INSERT INTO public.users (username, full_name)
VALUES ('r5_admin', 'R5 Admin'), ('r5_user', 'R5 User'), ('r5_user2', 'R5 User2')
ON CONFLICT (username) DO NOTHING;

-- ---- 1. Nhập batch lặp không nhân đôi kho (hash UNIQUE) ----
INSERT INTO public.content_presets (name, community_id, term_ids, body_type)
VALUES ('R5 preset', 35, ARRAY[178]::BIGINT[], 'markdown')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.content_items
  (preset_id, title, body, description, content_hash, status, created_by)
SELECT p.id, 'R5 bài kiểm tra', 'Nội dung R5.', '', repeat('a', 64), 'review', 'r5_admin'
FROM public.content_presets p WHERE p.name = 'R5 preset';

DO $$
DECLARE v_count INTEGER;
BEGIN
  BEGIN
    INSERT INTO public.content_items
      (preset_id, title, body, description, content_hash, status, created_by)
    SELECT p.id, 'R5 bài kiểm tra', 'Nội dung R5.', '', repeat('a', 64), 'review', 'r5_admin'
    FROM public.content_presets p WHERE p.name = 'R5 preset';
    RAISE EXCEPTION 'duplicate content accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  SELECT COUNT(*) INTO v_count FROM public.content_items
  WHERE content_hash = repeat('a', 64);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'duplicate import must not double the library';
  END IF;
END $$;

-- ---- 2. Duyệt tạo revision bất biến; sửa draft không đổi bản đã duyệt ----
DO $$
DECLARE
  v_item BIGINT;
  v_preset BIGINT;
  v_revision BIGINT;
  v_title_before TEXT;
BEGIN
  SELECT id INTO v_preset FROM public.content_presets WHERE name = 'R5 preset';
  SELECT id INTO v_item FROM public.content_items WHERE content_hash = repeat('a', 64);

  INSERT INTO public.content_revisions
    (content_item_id, revision_number, preset_id, preset_name, title, body,
     community_id, term_ids, body_type, content_hash, approved_by)
  VALUES
    (v_item, 1, v_preset, 'R5 preset', 'R5 bài kiểm tra', 'Nội dung R5.',
     35, ARRAY[178]::BIGINT[], 'markdown', repeat('a', 64), 'r5_admin')
  RETURNING id INTO v_revision;

  UPDATE public.content_items
  SET status = 'approved', current_revision_id = v_revision,
      approved_by = 'r5_admin', approved_at = NOW()
  WHERE id = v_item;

  -- Admin sửa draft sau khi duyệt: chỉ đổi bản nháp đang chỉnh.
  UPDATE public.content_items
  SET title = 'R5 bài đã sửa', body = 'Nội dung đã sửa.', updated_at = NOW()
  WHERE id = v_item;

  SELECT title INTO v_title_before FROM public.content_revisions WHERE id = v_revision;
  IF v_title_before <> 'R5 bài kiểm tra' THEN
    RAISE EXCEPTION 'editing draft must not change the approved revision';
  END IF;
  IF (SELECT current_revision_id FROM public.content_items WHERE id = v_item) <> v_revision THEN
    RAISE EXCEPTION 'current_revision_id must keep pointing at the approved snapshot';
  END IF;

  -- Revision bất biến: duy nhất theo (item, số revision).
  BEGIN
    INSERT INTO public.content_revisions
      (content_item_id, revision_number, preset_id, preset_name, title, body,
       community_id, term_ids, body_type, content_hash, approved_by)
    VALUES
      (v_item, 1, v_preset, 'R5 preset', 'trùng số', 'x',
       35, ARRAY[178]::BIGINT[], 'markdown', repeat('b', 64), 'r5_admin');
    RAISE EXCEPTION 'duplicate revision number accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

-- ---- 3. Hai admin reserve cùng revision: chỉ một người thành công ----
DO $$
DECLARE
  v_item BIGINT;
  v_preset BIGINT;
  v_rev1 BIGINT;
  v_rev2 BIGINT;
  v_schedule BIGINT;
BEGIN
  SELECT id INTO v_preset FROM public.content_presets WHERE name = 'R5 preset';
  SELECT id INTO v_item FROM public.content_items WHERE content_hash = repeat('a', 64);
  SELECT current_revision_id INTO v_rev1 FROM public.content_items WHERE id = v_item;

  -- Duyệt lại sau khi sửa draft → revision 2 (bản mới, hash mới).
  INSERT INTO public.content_revisions
    (content_item_id, revision_number, preset_id, preset_name, title, body,
     community_id, term_ids, body_type, content_hash, approved_by)
  VALUES
    (v_item, 2, v_preset, 'R5 preset', 'R5 bài đã sửa', 'Nội dung đã sửa.',
     35, ARRAY[178]::BIGINT[], 'markdown', repeat('b', 64), 'r5_admin')
  RETURNING id INTO v_rev2;

  UPDATE public.content_items
  SET status = 'approved', current_revision_id = v_rev2,
      content_hash = repeat('b', 64), updated_at = NOW()
  WHERE id = v_item;

  -- Admin A phân rev1 cho r5_user.
  INSERT INTO public.publishing_schedules
    (content_item_id, content_revision_id, target_username, scheduled_at, created_by)
  VALUES
    (v_item, v_rev1, 'r5_user', NOW() + INTERVAL '1 day', 'r5_admin')
  RETURNING id INTO v_schedule;

  -- Admin B phân cùng rev1 cho user khác → chỉ một người giữ rev1.
  BEGIN
    INSERT INTO public.publishing_schedules
      (content_item_id, content_revision_id, target_username, scheduled_at, created_by)
    VALUES
      (v_item, v_rev1, 'r5_user2', NOW() + INTERVAL '2 days', 'r5_admin');
    RAISE EXCEPTION 'second admin reserved the same revision';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- Cùng item cho cùng user ở lịch thứ hai còn hiệu lực → chặn.
  BEGIN
    INSERT INTO public.publishing_schedules
      (content_item_id, content_revision_id, target_username, scheduled_at, created_by)
    VALUES
      (v_item, v_rev2, 'r5_user', NOW() + INTERVAL '3 days', 'r5_admin');
    RAISE EXCEPTION 'same item scheduled twice for the same user';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- Hủy lịch đầu thì item+user được phân lại (bản rev2 mới).
  UPDATE public.publishing_schedules SET status = 'cancelled', updated_at = NOW()
  WHERE id = v_schedule;
  INSERT INTO public.publishing_schedules
    (content_item_id, content_revision_id, target_username, scheduled_at, created_by)
  VALUES
    (v_item, v_rev2, 'r5_user', NOW() + INTERVAL '3 days', 'r5_admin');

  -- Lịch đã terminal (cancelled/completed) không giữ lại revision.
  INSERT INTO public.publishing_schedules
    (content_item_id, content_revision_id, target_username, scheduled_at, created_by)
  VALUES
    (v_item, v_rev1, 'r5_user2', NOW() + INTERVAL '2 days', 'r5_admin');
END $$;

-- ---- 4. Approval của user theo (revision, target) — upsert idempotent ----
DO $$
DECLARE
  v_revision BIGINT;
BEGIN
  SELECT current_revision_id INTO v_revision FROM public.content_items
  WHERE content_hash = repeat('a', 64);

  INSERT INTO public.content_revision_approvals (revision_id, target_username, decision, decided_at, device_id)
  VALUES (v_revision, 'r5_user', 'approved', NOW(), 'r5-device');

  -- Upsert đổi quyết định không tạo dòng thứ hai.
  INSERT INTO public.content_revision_approvals (revision_id, target_username, decision, decided_at, device_id)
  VALUES (v_revision, 'r5_user', 'rejected', NOW(), 'r5-device')
  ON CONFLICT (revision_id, target_username)
  DO UPDATE SET decision = EXCLUDED.decision, decided_at = EXCLUDED.decided_at,
                device_id = EXCLUDED.device_id, updated_at = NOW();

  IF (SELECT COUNT(*) FROM public.content_revision_approvals
      WHERE revision_id = v_revision AND target_username = 'r5_user') <> 1 THEN
    RAISE EXCEPTION 'approval upsert must keep one row per (revision, user)';
  END IF;
  IF (SELECT decision FROM public.content_revision_approvals
      WHERE revision_id = v_revision AND target_username = 'r5_user') <> 'rejected' THEN
    RAISE EXCEPTION 'approval upsert must update the decision';
  END IF;
END $$;

-- ---- 5. anon/authenticated không đọc/ghi được kho và lịch ----
DO $$
BEGIN
  IF has_table_privilege('anon', 'public.content_items', 'SELECT')
     OR has_table_privilege('authenticated', 'public.publishing_schedules', 'INSERT')
     OR has_table_privilege('anon', 'public.content_revisions', 'SELECT')
     OR has_table_privilege('authenticated', 'public.content_revision_approvals', 'UPDATE') THEN
    RAISE EXCEPTION 'client can bypass publishing-api';
  END IF;
END $$;

ROLLBACK;
SELECT 'R5 content library + scheduling DB contract passed' AS result;
