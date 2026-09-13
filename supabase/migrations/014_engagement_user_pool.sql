-- 014: Pool do admin điều phối, điểm đóng góp và lượt Ultra.
-- Chạy sau 012_cross_user_engagement.sql.

BEGIN;

-- Policy phía server: user thường chỉ đọc qua engagement-api, không tự sửa.
CREATE TABLE IF NOT EXISTS public.engagement_preferences (
  username VARCHAR(100) PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  receive_post_limit INTEGER NOT NULL DEFAULT 3 CHECK (receive_post_limit BETWEEN 1 AND 10),
  discussions_per_post INTEGER NOT NULL DEFAULT 2 CHECK (discussions_per_post BETWEEN 1 AND 10),
  repeat_interval_minutes INTEGER NOT NULL DEFAULT 45 CHECK (repeat_interval_minutes BETWEEN 15 AND 1440),
  daily_contribution_cap INTEGER NOT NULL DEFAULT 20 CHECK (daily_contribution_cap BETWEEN 1 AND 100),
  contribution_points BIGINT NOT NULL DEFAULT 0 CHECK (contribution_points >= 0),
  ultra_credits INTEGER NOT NULL DEFAULT 0 CHECK (ultra_credits >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cho phép áp an toàn nếu một bản nháp 014 cũ đã từng tạo bảng này.
ALTER TABLE public.engagement_preferences
  ADD COLUMN IF NOT EXISTS contribution_points BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultra_credits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.engagement_preferences
  ALTER COLUMN daily_contribution_cap SET DEFAULT 20;
ALTER TABLE public.engagement_preferences
  DROP CONSTRAINT IF EXISTS engagement_preferences_discussions_per_post_check,
  DROP CONSTRAINT IF EXISTS engagement_preferences_daily_contribution_cap_check,
  DROP CONSTRAINT IF EXISTS engagement_preferences_contribution_points_check,
  DROP CONSTRAINT IF EXISTS engagement_preferences_ultra_credits_check;
ALTER TABLE public.engagement_preferences
  ADD CONSTRAINT engagement_preferences_discussions_per_post_check
    CHECK (discussions_per_post BETWEEN 1 AND 10),
  ADD CONSTRAINT engagement_preferences_daily_contribution_cap_check
    CHECK (daily_contribution_cap BETWEEN 1 AND 100),
  ADD CONSTRAINT engagement_preferences_contribution_points_check
    CHECK (contribution_points >= 0),
  ADD CONSTRAINT engagement_preferences_ultra_credits_check
    CHECK (ultra_credits >= 0);

CREATE INDEX IF NOT EXISTS idx_engagement_preferences_enabled
  ON public.engagement_preferences (enabled, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.engagement_reward_events (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL UNIQUE REFERENCES public.engagement_tasks (id) ON DELETE CASCADE,
  username VARCHAR(100) NOT NULL,
  points INTEGER NOT NULL DEFAULT 1 CHECK (points > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_engagement_reward_events_user_time
  ON public.engagement_reward_events (username, created_at DESC);

CREATE TABLE IF NOT EXISTS public.engagement_boost_requests (
  id BIGSERIAL PRIMARY KEY,
  techhub_id BIGINT NOT NULL REFERENCES public.posts (techhub_id) ON DELETE CASCADE,
  owner_username VARCHAR(100) NOT NULL,
  source VARCHAR(20) NOT NULL CHECK (source IN ('admin', 'ultra')),
  requested_discussions INTEGER NOT NULL DEFAULT 3 CHECK (requested_discussions BETWEEN 1 AND 50),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'expired')),
  created_by VARCHAR(100),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_engagement_boost_requests_active
  ON public.engagement_boost_requests (status, expires_at, created_at DESC);

ALTER TABLE public.engagement_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_reward_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_boost_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_preferences FROM anon, authenticated;
REVOKE ALL ON public.engagement_reward_events FROM anon, authenticated;
REVOKE ALL ON public.engagement_boost_requests FROM anon, authenticated;

INSERT INTO public.settings (key, value, description) VALUES
  ('engagement_pool_enabled', 'true', 'Admin bật/tắt pool tự động'),
  ('engagement_pool_offline_after_minutes', '30', 'Quá số phút này thì user không được đưa vào pool'),
  ('engagement_pool_receive_post_limit', '3', 'Số bài tối đa của mỗi user được đưa vào pool'),
  ('engagement_pool_discussions_per_post', '2', 'Số chuỗi thảo luận mục tiêu trên mỗi bài'),
  ('engagement_pool_repeat_interval_minutes', '45', 'Khoảng cách giữa hai chuỗi trên cùng bài'),
  ('engagement_pool_daily_contribution_cap', '20', 'Quota task được phân cho mỗi actor mỗi ngày'),
  ('engagement_pool_max_discussions_per_post', '10', 'Trần chuỗi thảo luận pool tạo cho một bài mỗi ngày'),
  ('engagement_pool_global_comment_gap_minutes', '5', 'Khoảng cách tối thiểu khi pool xếp comment'),
  ('engagement_pool_max_total_per_post', '30', 'Trần tuyệt đối comment/reply do extension tạo trên một bài'),
  ('engagement_ultra_threshold', '20', 'Số task thành công để nhận một lượt Ultra'),
  ('engagement_ultra_discussions', '5', 'Số chuỗi ưu tiên khi user dùng một lượt Ultra')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.record_engagement_reward(
  p_username TEXT, p_task_id BIGINT, p_threshold INTEGER DEFAULT 20
)
RETURNS TABLE(contribution_points BIGINT, ultra_credits INTEGER, awarded INTEGER)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_inserted INTEGER := 0;
  v_before BIGINT;
  v_after BIGINT;
  v_awarded INTEGER := 0;
BEGIN
  IF p_username IS NULL OR BTRIM(p_username) = '' OR p_task_id IS NULL THEN
    RAISE EXCEPTION 'username/task_id không hợp lệ';
  END IF;
  p_threshold := GREATEST(1, LEAST(COALESCE(p_threshold, 20), 1000));
  INSERT INTO public.engagement_preferences (username) VALUES (BTRIM(p_username))
  ON CONFLICT (username) DO NOTHING;
  INSERT INTO public.engagement_reward_events (task_id, username, points)
  VALUES (p_task_id, BTRIM(p_username), 1) ON CONFLICT (task_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  SELECT ep.contribution_points INTO v_before FROM public.engagement_preferences ep
  WHERE ep.username = BTRIM(p_username) FOR UPDATE;
  IF v_inserted > 0 THEN
    v_after := v_before + 1;
    v_awarded := (v_after / p_threshold) - (v_before / p_threshold);
    UPDATE public.engagement_preferences ep
    SET contribution_points = v_after,
        ultra_credits = ep.ultra_credits + v_awarded,
        updated_at = NOW()
    WHERE ep.username = BTRIM(p_username);
  END IF;
  RETURN QUERY SELECT ep.contribution_points, ep.ultra_credits, v_awarded
  FROM public.engagement_preferences ep WHERE ep.username = BTRIM(p_username);
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_engagement_ultra(
  p_username TEXT, p_techhub_id BIGINT, p_discussions INTEGER DEFAULT 5
)
RETURNS TABLE(boost_id BIGINT, ultra_credits INTEGER)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_owner TEXT;
  v_boost_id BIGINT;
BEGIN
  SELECT p.username INTO v_owner FROM public.posts p
  WHERE p.techhub_id = p_techhub_id AND p.status = 'open'
    AND p.verification_status = 'verified' FOR UPDATE;
  IF v_owner IS NULL OR v_owner <> BTRIM(p_username) THEN
    RAISE EXCEPTION 'Bài không thuộc user hoặc chưa đủ điều kiện';
  END IF;
  UPDATE public.engagement_preferences ep
  SET ultra_credits = ep.ultra_credits - 1, updated_at = NOW()
  WHERE ep.username = BTRIM(p_username) AND ep.ultra_credits > 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không còn lượt Ultra'; END IF;
  INSERT INTO public.engagement_boost_requests
    (techhub_id, owner_username, source, requested_discussions, created_by)
  VALUES (p_techhub_id, BTRIM(p_username), 'ultra',
    GREATEST(1, LEAST(COALESCE(p_discussions, 5), 50)), BTRIM(p_username))
  RETURNING id INTO v_boost_id;
  RETURN QUERY SELECT v_boost_id, ep.ultra_credits FROM public.engagement_preferences ep
  WHERE ep.username = BTRIM(p_username);
END;
$$;

REVOKE ALL ON FUNCTION public.record_engagement_reward(TEXT, BIGINT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_engagement_ultra(TEXT, BIGINT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_engagement_reward(TEXT, BIGINT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.redeem_engagement_ultra(TEXT, BIGINT, INTEGER) TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.engagement_preferences TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.engagement_reward_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.engagement_boost_requests TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.engagement_reward_events_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.engagement_boost_requests_id_seq TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
