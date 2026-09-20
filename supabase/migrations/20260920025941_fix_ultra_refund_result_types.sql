-- Keep the R4 RPC return columns aligned with its declared TEXT types.
-- The source columns are VARCHAR, and PL/pgSQL RETURN QUERY does not cast them implicitly.
BEGIN;

CREATE OR REPLACE FUNCTION public.settle_engagement_boosts(
  p_boost_id BIGINT DEFAULT NULL,
  p_cancel_reason TEXT DEFAULT NULL
)
RETURNS TABLE(
  boost_id BIGINT,
  techhub_id BIGINT,
  owner_username TEXT,
  source TEXT,
  new_status TEXT,
  refunded BOOLEAN,
  started_threads INTEGER
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  r RECORD;
  v_started INTEGER;
  v_new_status TEXT;
  v_eligible_refund BOOLEAN;
  v_reason TEXT;
  v_updated INTEGER;
BEGIN
  FOR r IN
    SELECT b.id, b.techhub_id, b.owner_username, b.source, b.refunded_at,
           b.refund_reason, b.created_at
    FROM public.engagement_boost_requests b
    WHERE b.status = 'active'
      AND (
        (p_boost_id IS NOT NULL AND b.id = p_boost_id)
        OR (p_boost_id IS NULL AND b.expires_at < NOW())
      )
    ORDER BY b.created_at ASC
    FOR UPDATE
  LOOP
    -- "Chưa mở turn đầu" = chưa có chuỗi nào (có turn 1) cho bài này sau khi
    -- boost được tạo. Chuỗi đã hủy không tính là đã bắt đầu.
    SELECT COUNT(*) INTO v_started
    FROM public.discussion_threads t
    JOIN public.discussion_turns dt
      ON dt.thread_id = t.id AND dt.turn_index = 1
    WHERE t.techhub_id = r.techhub_id
      AND t.created_at >= r.created_at
      AND t.status <> 'cancelled';

    v_new_status := CASE WHEN p_boost_id IS NOT NULL THEN 'cancelled' ELSE 'expired' END;
    v_eligible_refund :=
      r.source = 'ultra' AND v_started = 0 AND r.refunded_at IS NULL;
    v_reason := LEFT(
      COALESCE(
        NULLIF(BTRIM(p_cancel_reason), ''),
        CASE WHEN p_boost_id IS NOT NULL THEN 'admin_cancelled_no_thread'
             ELSE 'expired_no_thread' END
      ), 140);

    UPDATE public.engagement_boost_requests b
    SET status = v_new_status,
        updated_at = NOW(),
        refunded_at = CASE WHEN v_eligible_refund THEN NOW() ELSE r.refunded_at END,
        refund_reason = CASE WHEN v_eligible_refund THEN v_reason ELSE r.refund_reason END
    WHERE b.id = r.id AND b.status = 'active';
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated = 0 THEN
      CONTINUE;  -- RACE: batch khác đã xử lý; không hoàn lần hai.
    END IF;

    IF v_eligible_refund THEN
      INSERT INTO public.engagement_preferences (username)
      VALUES (r.owner_username)
      ON CONFLICT (username) DO NOTHING;
      UPDATE public.engagement_preferences ep
      SET ultra_credits = ep.ultra_credits + 1, updated_at = NOW()
      WHERE ep.username = r.owner_username;
      -- Ledger sự kiện duy nhất cho mỗi lần hoàn (chỉ chạy sau khi chiếm
      -- được chuyển trạng thái active -> expired/cancelled).
      INSERT INTO public.engagement_events (actor_username, event, detail)
      VALUES (
        r.owner_username,
        'ultra_refunded',
        jsonb_build_object(
          'boost_id', r.id,
          'techhub_id', r.techhub_id,
          'owner_username', r.owner_username,
          'reason', v_reason,
          'started_threads', v_started
        )
      );
    END IF;

    RETURN QUERY
      SELECT r.id, r.techhub_id, r.owner_username::TEXT, r.source::TEXT,
             v_new_status, v_eligible_refund, v_started;
  END LOOP;
END;
$$;

COMMIT;
NOTIFY pgrst, 'reload schema';
