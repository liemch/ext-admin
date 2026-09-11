-- 012: Hàng đợi điều phối tương tác giữa các user (cross-user engagement)
--
-- Vai trò: Supabase giữ hàng đợi + lease; extension (cookie/CSRF local) thực thi.
-- Xem PLAN_CROSS_USER_ENGAGEMENT.md mục 5–6.
--
-- Bảng:
--   engagement_devices   — device token (lưu hash) theo user/máy, thu hồi từng máy
--   engagement_campaigns — cấu hình một đợt tương tác (quota, cooldown, phạm vi bài)
--   engagement_tasks     — mỗi dòng là MỘT hành động độc lập (vote/comment/reply)
--   engagement_events    — nhật ký append-only để audit
--   discussion_threads   — một kịch bản hội thoại đã import (2–4 turn A→B→A→B)
--   discussion_turns     — từng turn, nối nhau qua depends_on + techhub_comment_id
--
-- Bảo mật: client (anon key) chỉ được SELECT. Mọi ghi điều phối đi qua
-- Edge Function `engagement-api` bằng service role. Chạy migration này TRƯỚC
-- khi deploy/sử dụng engagement-api.

BEGIN;

-- ==================== engagement_devices ====================
CREATE TABLE IF NOT EXISTS public.engagement_devices (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  username VARCHAR(100) NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  last_seen_at TIMESTAMPTZ,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_engagement_devices_user_device UNIQUE (username, device_id)
);

CREATE INDEX IF NOT EXISTS idx_engagement_devices_token
  ON public.engagement_devices (token_hash);
CREATE INDEX IF NOT EXISTS idx_engagement_devices_username
  ON public.engagement_devices (username);

-- ==================== engagement_campaigns ====================
CREATE TABLE IF NOT EXISTS public.engagement_campaigns (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'completed', 'cancelled')),
  actions TEXT[] NOT NULL DEFAULT '{vote,comment}',
  votes_per_post INTEGER NOT NULL DEFAULT 3 CHECK (votes_per_post >= 0),
  comments_per_post INTEGER NOT NULL DEFAULT 1 CHECK (comments_per_post >= 0),
  max_tasks_per_actor_daily INTEGER NOT NULL DEFAULT 3 CHECK (max_tasks_per_actor_daily > 0),
  max_per_pair_daily INTEGER NOT NULL DEFAULT 1 CHECK (max_per_pair_daily > 0),
  cooldown_minutes INTEGER NOT NULL DEFAULT 45 CHECK (cooldown_minutes >= 0),
  jitter_minutes INTEGER NOT NULL DEFAULT 10 CHECK (jitter_minutes >= 0),
  post_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_assist BOOLEAN NOT NULL DEFAULT FALSE,
  comment_source VARCHAR(20) NOT NULL DEFAULT 'template'
    CHECK (comment_source IN ('template', 'ai', 'thread')),
  created_by VARCHAR(100),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_engagement_campaigns_status
  ON public.engagement_campaigns (status);

-- ==================== discussion_threads ====================
CREATE TABLE IF NOT EXISTS public.discussion_threads (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  campaign_id BIGINT REFERENCES public.engagement_campaigns (id) ON DELETE SET NULL,
  techhub_id BIGINT NOT NULL,
  techhub_uuid VARCHAR(100),
  author_username VARCHAR(100) NOT NULL,
  visitor_username VARCHAR(100) NOT NULL,
  actor_a_username VARCHAR(100) NOT NULL,
  actor_b_username VARCHAR(100) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'blocked', 'completed', 'cancelled')),
  current_turn_index INTEGER NOT NULL DEFAULT 1,
  total_turns INTEGER NOT NULL DEFAULT 2,
  last_error TEXT,
  created_by VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discussion_threads_post
  ON public.discussion_threads (techhub_id);
CREATE INDEX IF NOT EXISTS idx_discussion_threads_status
  ON public.discussion_threads (status);
CREATE INDEX IF NOT EXISTS idx_discussion_threads_campaign
  ON public.discussion_threads (campaign_id);

-- ==================== discussion_turns ====================
-- NOTE: task_id không đặt FK lúc tạo để tránh vòng tham chiếu với
-- engagement_tasks; FK được gắn ở cuối migration.
CREATE TABLE IF NOT EXISTS public.discussion_turns (
  id BIGSERIAL PRIMARY KEY,
  thread_id BIGINT NOT NULL REFERENCES public.discussion_threads (id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL CHECK (turn_index >= 1),
  actor_key VARCHAR(2) NOT NULL CHECK (actor_key IN ('A', 'B', 'C')),
  actor_username VARCHAR(100) NOT NULL,
  content TEXT NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'queued', 'claimed', 'succeeded', 'failed', 'skipped', 'blocked', 'cancelled')),
  depends_on_turn_id BIGINT REFERENCES public.discussion_turns (id) ON DELETE SET NULL,
  parent_techhub_comment_id BIGINT,
  techhub_comment_id BIGINT,
  task_id BIGINT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_discussion_turns_thread_turn UNIQUE (thread_id, turn_index)
);

CREATE INDEX IF NOT EXISTS idx_discussion_turns_thread
  ON public.discussion_turns (thread_id, turn_index);
CREATE INDEX IF NOT EXISTS idx_discussion_turns_actor_status
  ON public.discussion_turns (actor_username, status);

-- ==================== engagement_tasks ====================
CREATE TABLE IF NOT EXISTS public.engagement_tasks (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT REFERENCES public.engagement_campaigns (id) ON DELETE SET NULL,
  discussion_turn_id BIGINT REFERENCES public.discussion_turns (id) ON DELETE SET NULL,
  actor_username VARCHAR(100) NOT NULL,
  target_username VARCHAR(100),
  techhub_id BIGINT NOT NULL,
  techhub_uuid VARCHAR(100),
  action VARCHAR(10) NOT NULL CHECK (action IN ('vote', 'comment', 'reply')),
  status VARCHAR(12) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'succeeded', 'failed', 'skipped', 'cancelled')),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  claimed_by_device TEXT,
  lease_until TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  last_http_status INTEGER,
  session_required BOOLEAN NOT NULL DEFAULT FALSE,
  source_comment_id BIGINT,
  parent_techhub_comment_id BIGINT,
  content TEXT,
  techhub_result_id BIGINT,
  result_detail JSONB,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_engagement_tasks_actor_status_sched
  ON public.engagement_tasks (actor_username, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_engagement_tasks_status_sched
  ON public.engagement_tasks (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_engagement_tasks_campaign
  ON public.engagement_tasks (campaign_id);
CREATE INDEX IF NOT EXISTS idx_engagement_tasks_post
  ON public.engagement_tasks (techhub_id);
CREATE INDEX IF NOT EXISTS idx_engagement_tasks_pair
  ON public.engagement_tasks (actor_username, target_username, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_tasks_lease
  ON public.engagement_tasks (status, lease_until);
CREATE INDEX IF NOT EXISTS idx_engagement_tasks_turn
  ON public.engagement_tasks (discussion_turn_id);

-- Gắn FK turns.task_id sau khi cả hai bảng đã tồn tại.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_discussion_turns_task'
  ) THEN
    ALTER TABLE public.discussion_turns
      ADD CONSTRAINT fk_discussion_turns_task
      FOREIGN KEY (task_id) REFERENCES public.engagement_tasks (id) ON DELETE SET NULL;
  END IF;
END
$$;

-- ==================== engagement_events ====================
CREATE TABLE IF NOT EXISTS public.engagement_events (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT REFERENCES public.engagement_tasks (id) ON DELETE CASCADE,
  campaign_id BIGINT REFERENCES public.engagement_campaigns (id) ON DELETE SET NULL,
  thread_id BIGINT REFERENCES public.discussion_threads (id) ON DELETE SET NULL,
  actor_username VARCHAR(100),
  event VARCHAR(30) NOT NULL,
  http_status INTEGER,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_engagement_events_task
  ON public.engagement_events (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_events_campaign
  ON public.engagement_events (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_events_created
  ON public.engagement_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_events_event
  ON public.engagement_events (event, created_at DESC);

-- ==================== Atomic claim (lease) ====================
-- 1. Trả các task treo (hết lease) về queue.
-- 2. Mỗi actor chỉ giữ 1 task đang claim — nếu đã có thì trả lại task đó
--    (idempotent, gia hạn lease) thay vì phát task mới.
-- 3. Claim đúng 1 task pending tới hạn, SKIP LOCKED để 2 máy không tranh nhau.
CREATE OR REPLACE FUNCTION public.claim_engagement_task(
  p_actor TEXT,
  p_device_id TEXT,
  p_lease_seconds INTEGER DEFAULT 300,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS SETOF public.engagement_tasks
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing public.engagement_tasks%ROWTYPE;
BEGIN
  -- 1. Thu hồi lease đã hết hạn (toàn hàng đợi, giới hạn để câu lệnh nhẹ).
  UPDATE public.engagement_tasks
  SET status = 'pending',
      claimed_at = NULL,
      claimed_by_device = NULL,
      lease_until = NULL,
      updated_at = p_now
  WHERE id IN (
    SELECT id FROM public.engagement_tasks
    WHERE status = 'claimed' AND lease_until IS NOT NULL AND lease_until < p_now
    ORDER BY lease_until ASC
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  );

  -- 2. Actor đã giữ 1 task thì trả lại task đó (gia hạn lease, không tăng attempt).
  SELECT * INTO v_existing
  FROM public.engagement_tasks
  WHERE actor_username = p_actor
    AND status = 'claimed'
    AND lease_until IS NOT NULL AND lease_until >= p_now
  ORDER BY claimed_at DESC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    UPDATE public.engagement_tasks
    SET lease_until = p_now + make_interval(secs => GREATEST(p_lease_seconds, 60)),
        claimed_by_device = p_device_id,
        updated_at = p_now
    WHERE id = v_existing.id;
    RETURN QUERY SELECT * FROM public.engagement_tasks WHERE id = v_existing.id;
    RETURN;
  END IF;

  -- 3. Claim task mới: tới hạn, không chờ đăng nhập, campaign còn active.
  -- (Task của thread thảo luận có campaign_id NULL vẫn được phát bình thường.)
  RETURN QUERY
  WITH candidate AS (
    SELECT t.id
    FROM public.engagement_tasks t
    WHERE t.actor_username = p_actor
      AND t.status = 'pending'
      AND t.scheduled_at <= p_now
      AND COALESCE(t.session_required, FALSE) = FALSE
      AND (
        t.campaign_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.engagement_campaigns c
          WHERE c.id = t.campaign_id AND c.status = 'active'
        )
      )
    ORDER BY t.scheduled_at ASC, t.id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.engagement_tasks t
  SET status = 'claimed',
      claimed_at = p_now,
      claimed_by_device = p_device_id,
      lease_until = p_now + make_interval(secs => GREATEST(p_lease_seconds, 60)),
      attempt_count = t.attempt_count + 1,
      updated_at = p_now
  FROM candidate
  WHERE t.id = candidate.id
  RETURNING t.*;
END;
$$;

-- RPC claim/release CHỈ engagement-api (service role) được gọi. Anon key nằm
-- trong extension nên phải chặn gọi trực tiếp, kẻo máy lạ claim task hộ actor khác.
REVOKE ALL ON FUNCTION public.claim_engagement_task(TEXT, TEXT, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_engagement_task(TEXT, TEXT, INTEGER, TIMESTAMPTZ)
  TO service_role;

-- Trả task đang claim của actor về queue (dùng khi đổi tài khoản TechHub).
CREATE OR REPLACE FUNCTION public.release_actor_claims(
  p_actor TEXT,
  p_device_id TEXT DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  WITH released AS (
    UPDATE public.engagement_tasks
    SET status = 'pending',
        claimed_at = NULL,
        claimed_by_device = NULL,
        lease_until = NULL,
        updated_at = p_now
    WHERE actor_username = p_actor
      AND status = 'claimed'
      AND (p_device_id IS NULL OR claimed_by_device IS NULL OR claimed_by_device = p_device_id)
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM released;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.release_actor_claims(TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_actor_claims(TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;

-- ==================== RLS: anon chỉ đọc ====================
ALTER TABLE public.engagement_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discussion_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discussion_turns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "engagement_read" ON public.engagement_devices;
CREATE POLICY "engagement_read" ON public.engagement_devices
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "engagement_read" ON public.engagement_campaigns;
CREATE POLICY "engagement_read" ON public.engagement_campaigns
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "engagement_read" ON public.engagement_tasks;
CREATE POLICY "engagement_read" ON public.engagement_tasks
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "engagement_read" ON public.engagement_events;
CREATE POLICY "engagement_read" ON public.engagement_events
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "engagement_read" ON public.discussion_threads;
CREATE POLICY "engagement_read" ON public.discussion_threads
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "engagement_read" ON public.discussion_turns;
CREATE POLICY "engagement_read" ON public.discussion_turns
  FOR SELECT TO anon, authenticated USING (true);

-- Không tạo policy INSERT/UPDATE/DELETE cho anon/authenticated:
-- mọi ghi điều phối đi qua engagement-api (service role, bypass RLS).
GRANT SELECT ON public.engagement_devices TO anon, authenticated;
GRANT SELECT ON public.engagement_campaigns TO anon, authenticated;
GRANT SELECT ON public.engagement_tasks TO anon, authenticated;
GRANT SELECT ON public.engagement_events TO anon, authenticated;
GRANT SELECT ON public.discussion_threads TO anon, authenticated;
GRANT SELECT ON public.discussion_turns TO anon, authenticated;

-- ==================== Seed settings ====================
INSERT INTO public.settings (key, value, description) VALUES
  ('engagement_kill_switch', 'false', 'Kill switch toàn hệ thống: true = dừng phát task mới'),
  ('engagement_default_interval_minutes', '15', 'Chu kỳ thức dậy mặc định của worker tương tác chéo'),
  ('engagement_default_tasks_per_wake', '1', 'Số task tối đa mỗi lần thức dậy (MVP = 1)'),
  ('engagement_default_daily_cap', '3', 'Số bài tối đa mỗi actor mỗi ngày (MVP = 3)'),
  ('engagement_default_cooldown_minutes', '45', 'Cooldown mặc định mỗi cặp actor–tác giả (phút)'),
  ('engagement_lease_seconds', '300', 'Thời hạn lease khi claim task (giây)')
ON CONFLICT (key) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
