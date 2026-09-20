-- R4: Chiến dịch nhanh (năm trường + hai preset MVP) và hoàn Ultra idempotent.
-- Chạy sau 20260918043557_engagement_task_receipts.sql.
-- Tham chiếu: PLAN_PRODUCT_9_10.md mục 5.2, 5.3, 17.2, 18.5, 21 (ticket R4).

BEGIN;

-- ==================== 1. Preset vận hành do server quản ====================
-- Màn hình cơ bản chỉ còn năm quyết định; các trần kỹ thuật nằm ở đây và do
-- admin vận hành chỉnh qua settings, không nhận giá trị client tự khai.
-- An toàn: tối đa 2 hành động/user/ngày, 1 chuỗi mới/bài/ngày.
-- Cân bằng: tối đa 5 hành động/user/ngày, 3 chuỗi mới/bài/ngày.
-- Một hành động = một comment hoặc một reply (mục 17.2).
INSERT INTO public.settings (key, value, description) VALUES
  ('engagement_preset_safe_daily_actions', '2',
   'Preset An toàn: hành động tối đa mỗi user mỗi ngày'),
  ('engagement_preset_safe_threads_per_post', '1',
   'Preset An toàn: chuỗi mới tối đa mỗi bài mỗi ngày'),
  ('engagement_preset_balanced_daily_actions', '5',
   'Preset Cân bằng: hành động tối đa mỗi user mỗi ngày'),
  ('engagement_preset_balanced_threads_per_post', '3',
   'Preset Cân bằng: chuỗi mới tối đa mỗi bài mỗi ngày'),
  ('engagement_preset_min_action_gap_minutes', '10',
   'Khoảng cách tối thiểu giữa hai hành động của cùng một user (phút)'),
  ('engagement_preset_max_threads_per_batch', '50',
   'Tối đa chuỗi trong một batch chiến dịch nhanh')
ON CONFLICT (key) DO NOTHING;

-- ==================== 2. Campaign sinh từ chiến dịch nhanh ====================

ALTER TABLE public.engagement_campaigns
  ADD COLUMN IF NOT EXISTS preset VARCHAR(20);

ALTER TABLE public.engagement_campaigns
  DROP CONSTRAINT IF EXISTS engagement_campaigns_preset_check;

ALTER TABLE public.engagement_campaigns
  ADD CONSTRAINT engagement_campaigns_preset_check
    CHECK (preset IS NULL OR preset IN ('safe', 'balanced'));

-- ==================== 3. Hoàn Ultra: mốc hoàn đúng một lần ====================

ALTER TABLE public.engagement_boost_requests
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_reason VARCHAR(140);

-- ==================== 4. RPC đối soát boost ====================
-- settle_engagement_boosts:
--   - p_boost_id IS NULL: quét các boost active đã hết expires_at -> 'expired'.
--   - p_boost_id NOT NULL: admin hủy boost active đó -> 'cancelled'.
-- Hoàn 1 lượt Ultra đúng MỘT lần khi và chỉ khi: source = 'ultra', chưa từng
-- hoàn (refunded_at IS NULL) và chưa chuỗi nào mở turn đầu cho bài đó sau thời
-- điểm tạo boost. Idempotency dựa vào WHERE status = 'active': replay không
-- đụng hàng đã xử lý nên không cộng credit và không ghi event lần hai
-- (mục 18.5: hoàn credit một lần qua ledger sự kiện duy nhất).

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
      SELECT r.id, r.techhub_id, r.owner_username, r.source,
             v_new_status, v_eligible_refund, v_started;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_engagement_boosts(BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_engagement_boosts(BIGINT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_engagement_boosts(BIGINT, TEXT) TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
