\set ON_ERROR_STOP on
BEGIN;

-- R4: đối soát hoàn Ultra idempotent (PLAN_PRODUCT_9_10 mục 18.5, ticket R4).
-- Chạy trên project DEV: psql -f scripts/test-r4-ultra-refund.sql

INSERT INTO public.users (username, full_name)
VALUES ('r4_owner', 'R4 Owner'), ('r4_visitor', 'R4 Visitor')
ON CONFLICT (username) DO NOTHING;
INSERT INTO public.posts (techhub_id, username, title, verification_status, status)
VALUES (987654323, 'r4_owner', 'R4 fixture refund', 'verified', 'open'),
       (987654324, 'r4_owner', 'R4 fixture started', 'verified', 'open');

-- User có 1 lượt Ultra; dùng lượt cho hai bài (một bài sẽ có chuỗi bắt đầu).
INSERT INTO public.engagement_preferences (username, ultra_credits)
VALUES ('r4_owner', 2)
ON CONFLICT (username) DO UPDATE SET ultra_credits = 2;

WITH redeem AS (
  SELECT public.redeem_engagement_ultra('r4_owner', 987654323, 3) AS r
)
SELECT 1 FROM redeem WHERE (r).boost_id IS NOT NULL;
WITH redeem2 AS (
  SELECT public.redeem_engagement_ultra('r4_owner', 987654324, 3) AS r
)
SELECT 1 FROM redeem2 WHERE (r).boost_id IS NOT NULL;

-- Bài 987654324 có chuỗi đã mở turn đầu => boost này KHÔNG được hoàn.
INSERT INTO public.discussion_threads
  (name, techhub_id, author_username, visitor_username, actor_a_username, actor_b_username)
VALUES ('r4-started', 987654324, 'r4_owner', 'r4_visitor', 'r4_visitor', 'r4_owner');
INSERT INTO public.discussion_turns (thread_id, turn_index, actor_key, actor_username, content)
SELECT id, 1, 'A', 'r4_visitor', 'Turn dau' FROM public.discussion_threads
WHERE name = 'r4-started';

-- Force hết hạn để quét settle.
UPDATE public.engagement_boost_requests
SET expires_at = NOW() - INTERVAL '1 minute'
WHERE owner_username = 'r4_owner' AND status = 'active';

DO $$
DECLARE
  v_refund_boost BIGINT;
  v_start_boost BIGINT;
  v_credits_after_first INTEGER;
BEGIN
  SELECT id INTO v_refund_boost FROM public.engagement_boost_requests
  WHERE owner_username = 'r4_owner' AND techhub_id = 987654323;
  SELECT id INTO v_start_boost FROM public.engagement_boost_requests
  WHERE owner_username = 'r4_owner' AND techhub_id = 987654324;

  -- Lần settle đầu: hoàn đúng 1 lượt cho boost chưa có chuỗi, không hoàn cho
  -- boost đã có chuỗi bắt đầu.
  PERFORM public.settle_engagement_boosts(NULL, NULL);

  IF (SELECT ultra_credits FROM public.engagement_preferences WHERE username='r4_owner') <> 1 THEN
    RAISE EXCEPTION 'refund must add exactly one credit (expected 1)';
  END IF;
  IF (SELECT COUNT(*) FROM public.engagement_events
      WHERE event='ultra_refunded' AND detail->>'owner_username' = 'r4_owner') <> 1 THEN
    RAISE EXCEPTION 'must log exactly one ultra_refunded event';
  END IF;
  IF (SELECT status FROM public.engagement_boost_requests WHERE id=v_start_boost) <> 'expired' THEN
    RAISE EXCEPTION 'started-thread boost must expire without refund';
  END IF;
  IF (SELECT refunded_at FROM public.engagement_boost_requests WHERE id=v_start_boost) IS NOT NULL THEN
    RAISE EXCEPTION 'boost with started thread must not be refunded';
  END IF;

  v_credits_after_first := (SELECT ultra_credits FROM public.engagement_preferences WHERE username='r4_owner');

  -- Replay settle: không đổi số dư, không thêm event (idempotent).
  PERFORM public.settle_engagement_boosts(NULL, NULL);
  PERFORM public.settle_engagement_boosts(v_refund_boost, 'retry_manual');

  IF (SELECT ultra_credits FROM public.engagement_preferences WHERE username='r4_owner') <> v_credits_after_first THEN
    RAISE EXCEPTION 'replay settle must not change balance a second time';
  END IF;
  IF (SELECT COUNT(*) FROM public.engagement_events
      WHERE event='ultra_refunded' AND detail->>'owner_username' = 'r4_owner') <> 1 THEN
    RAISE EXCEPTION 'replay settle must not log a second refund event';
  END IF;

  -- Admin hủy một boost active mới: hoàn đúng một lần.
  PERFORM public.redeem_engagement_ultra('r4_owner', 987654323, 2);
  SELECT id INTO v_refund_boost FROM public.engagement_boost_requests
  WHERE owner_username='r4_owner' AND status='active' AND techhub_id=987654323;
  PERFORM public.settle_engagement_boosts(v_refund_boost, 'admin_cancelled');
  IF (SELECT status FROM public.engagement_boost_requests WHERE id=v_refund_boost) <> 'cancelled' THEN
    RAISE EXCEPTION 'admin cancel must mark boost cancelled';
  END IF;
  IF (SELECT ultra_credits FROM public.engagement_preferences WHERE username='r4_owner') <> v_credits_after_first + 1 THEN
    RAISE EXCEPTION 'admin cancel must refund exactly one credit';
  END IF;
  -- Hủy lại boost đã xử lý: không đổi gì.
  PERFORM public.settle_engagement_boosts(v_refund_boost, 'admin_cancelled');
  IF (SELECT ultra_credits FROM public.engagement_preferences WHERE username='r4_owner') <> v_credits_after_first + 1 THEN
    RAISE EXCEPTION 'cancel replay must not change balance a second time';
  END IF;

  -- anon/authenticated không được gọi RPC hoàn Ultra.
  IF has_function_privilege('anon', 'public.settle_engagement_boosts(BIGINT, TEXT)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.settle_engagement_boosts(BIGINT, TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon/authenticated must not execute settle_engagement_boosts';
  END IF;
END $$;

ROLLBACK;
SELECT 'R4 quick campaign + Ultra refund DB contract passed' AS result;
