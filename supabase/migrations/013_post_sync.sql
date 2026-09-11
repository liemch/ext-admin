-- 013: Hệ thống đồng bộ bài viết (post sync) — hint + feed discovery + reconcile
--
-- Vai trò: Phát hiện và cập nhật bài viết của user đã đăng ký một cách tự động
-- mà không yêu cầu từng user quét feed. Leader (máy admin) xác minh hint, quét
-- feed chung và đối soát theo username. Xem PLAN_POST_SYNC.md.
--
-- Bảng mới:
--   post_hints           — tín hiệu nhẹ từ hoạt động tự nhiên của user
--   post_sync_jobs       — hàng đợi công việc sync (verify_hint / feed / reconcile)
--   post_sync_sources    — nguồn quét (community / user) kèm cursor + lịch
--   post_sync_runs       — lịch sử từng lần chạy (số request, số bài mới/...)
--
-- Cột mới trên posts:
--   verification_status, first_seen_at, last_seen_at, last_verified_at,
--   discovered_by, sync_run_id, sync_error
--
-- Bảo mật: bật RLS cho mọi bảng mới; client không ghi trực tiếp; mọi ghi
-- đi qua Edge Function `post-sync-api` bằng service role.

BEGIN;

-- ==================== Bổ sung cột cho bảng posts ====================
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20) NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified','verified','stale','rejected')),
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS discovered_by VARCHAR(30) NOT NULL DEFAULT 'legacy'
    CHECK (discovered_by IN ('post_hint','feed_discovery','user_reconcile','legacy')),
  ADD COLUMN IF NOT EXISTS sync_run_id BIGINT,
  ADD COLUMN IF NOT EXISTS sync_error TEXT;

-- last_seen_at đã được thêm ở migration 010_posts_community.sql — không thêm lại.

CREATE INDEX IF NOT EXISTS idx_posts_verification_published
  ON public.posts (verification_status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_username_published
  ON public.posts (username, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_last_verified
  ON public.posts (last_verified_at);

-- Backfill: bài hiện có đủ id, uuid, username được xem là verified/legacy.
UPDATE public.posts
SET
  verification_status = 'verified',
  discovered_by = 'legacy',
  last_verified_at = COALESCE(last_verified_at, created_at, NOW()),
  first_seen_at = COALESCE(first_seen_at, created_at, NOW())
WHERE techhub_id IS NOT NULL
  AND techhub_uuid IS NOT NULL
  AND username IS NOT NULL
  AND (verification_status = 'unverified' OR last_verified_at IS NULL);

-- ==================== post_hints ====================
CREATE TABLE IF NOT EXISTS public.post_hints (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  device_id TEXT NOT NULL,
  identifier_key VARCHAR(200) NOT NULL,
  techhub_id BIGINT,
  techhub_uuid VARCHAR(100),
  url TEXT,
  title_hint TEXT,
  published_at_hint TIMESTAMPTZ,
  source VARCHAR(30) NOT NULL CHECK (source IN ('article_page','post_created','existing_response')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','job_created','verified','rejected','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_post_hints_user_identifier UNIQUE (username, identifier_key)
);

CREATE INDEX IF NOT EXISTS idx_post_hints_status ON public.post_hints (status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_post_hints_username ON public.post_hints (username);
CREATE INDEX IF NOT EXISTS idx_post_hints_observed ON public.post_hints (observed_at DESC);

-- ==================== post_sync_jobs ====================
CREATE TABLE IF NOT EXISTS public.post_sync_jobs (
  id BIGSERIAL PRIMARY KEY,
  type VARCHAR(30) NOT NULL CHECK (type IN ('verify_hint','feed_discovery','user_reconcile')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','claimed','running','retry_wait','succeeded','failed','session_required','cancelled')),
  source_id BIGINT,
  hint_id BIGINT REFERENCES public.post_hints (id) ON DELETE SET NULL,
  username VARCHAR(100),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  claimed_by_device TEXT,
  lease_until TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  idempotency_key TEXT NOT NULL UNIQUE,
  cursor JSONB,
  last_http_status INTEGER,
  last_error TEXT,
  continuation_of BIGINT REFERENCES public.post_sync_jobs (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_sync_jobs_claim
  ON public.post_sync_jobs (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_post_sync_jobs_type_status
  ON public.post_sync_jobs (type, status);
CREATE INDEX IF NOT EXISTS idx_post_sync_jobs_lease
  ON public.post_sync_jobs (status, lease_until);
CREATE INDEX IF NOT EXISTS idx_post_sync_jobs_hint ON public.post_sync_jobs (hint_id);
CREATE INDEX IF NOT EXISTS idx_post_sync_jobs_username ON public.post_sync_jobs (username);

-- ==================== post_sync_sources ====================
CREATE TABLE IF NOT EXISTS public.post_sync_sources (
  id BIGSERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL CHECK (type IN ('community','user')),
  source_key VARCHAR(200) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  cursor JSONB,
  last_checked_at TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  interval_minutes INTEGER NOT NULL DEFAULT 60,
  request_count_24h INTEGER NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_post_sync_sources_type_key UNIQUE (type, source_key)
);

CREATE INDEX IF NOT EXISTS idx_post_sync_sources_due
  ON public.post_sync_sources (enabled, next_check_at);

-- ==================== post_sync_runs ====================
CREATE TABLE IF NOT EXISTS public.post_sync_runs (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT REFERENCES public.post_sync_jobs (id) ON DELETE SET NULL,
  source_id BIGINT REFERENCES public.post_sync_sources (id) ON DELETE SET NULL,
  leader_device_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  outcome VARCHAR(20) CHECK (outcome IN ('succeeded','partial','failed','session_required')),
  request_count INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  last_cursor JSONB,
  http_status INTEGER,
  error_summary TEXT,
  budget_exhausted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_sync_runs_job ON public.post_sync_runs (job_id);
CREATE INDEX IF NOT EXISTS idx_post_sync_runs_source_started
  ON public.post_sync_runs (source_id, started_at DESC);

-- Gắn FK posts.sync_run_id sau khi bảng post_sync_runs đã tồn tại.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_posts_sync_run'
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT fk_posts_sync_run
      FOREIGN KEY (sync_run_id) REFERENCES public.post_sync_runs (id) ON DELETE SET NULL;
  END IF;
END
$$;

-- ==================== Atomic claim RPC ====================
-- Quy trình:
--   1. Thu hồi các job đã hết lease về pending/retry_wait.
--   2. Nếu device đang giữ job còn lease, trả lại chính job đó (gia hạn).
--   3. Chọn job tới hạn theo priority: verify_hint -> feed_discovery -> user_reconcile.
--   4. Dùng FOR UPDATE SKIP LOCKED để hai leader không tranh cùng job.
CREATE OR REPLACE FUNCTION public.claim_post_sync_job(
  p_admin_device_id TEXT,
  p_lease_seconds INTEGER DEFAULT 600,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS SETOF public.post_sync_jobs
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing public.post_sync_jobs%ROWTYPE;
  v_lease_secs INTEGER;
BEGIN
  v_lease_secs := GREATEST(p_lease_seconds, 60);

  -- 1. Thu hồi lease đã hết.
  UPDATE public.post_sync_jobs
  SET status = CASE
        WHEN status = 'claimed' THEN 'pending'::VARCHAR(20)
        WHEN status = 'running' THEN 'retry_wait'::VARCHAR(20)
        ELSE status
      END,
      claimed_at = NULL,
      claimed_by_device = NULL,
      lease_until = NULL,
      updated_at = p_now
  WHERE id IN (
    SELECT id FROM public.post_sync_jobs
    WHERE status IN ('claimed','running')
      AND lease_until IS NOT NULL AND lease_until < p_now
    ORDER BY lease_until ASC
    LIMIT 200
    FOR UPDATE SKIP LOCKED
  );

  -- 2. Thiết bị đã giữ job còn hiệu lực → trả lại job đó, gia hạn lease.
  SELECT * INTO v_existing
  FROM public.post_sync_jobs
  WHERE claimed_by_device = p_admin_device_id
    AND status IN ('claimed','running')
    AND lease_until IS NOT NULL AND lease_until >= p_now
  ORDER BY claimed_at DESC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    UPDATE public.post_sync_jobs
    SET lease_until = p_now + make_interval(secs => v_lease_secs),
        updated_at = p_now
    WHERE id = v_existing.id;
    RETURN QUERY SELECT * FROM public.post_sync_jobs WHERE id = v_existing.id;
    RETURN;
  END IF;

  -- 3. Claim job mới theo thứ tự ưu tiên, chỉ lấy job đến hạn.
  RETURN QUERY
  WITH candidate AS (
    SELECT j.id
    FROM public.post_sync_jobs j
    WHERE j.status IN ('pending','retry_wait')
      AND j.scheduled_at <= p_now
    ORDER BY
      CASE j.type
        WHEN 'verify_hint'     THEN 1
        WHEN 'feed_discovery'  THEN 2
        WHEN 'user_reconcile'  THEN 3
        ELSE 9
      END ASC,
      j.scheduled_at ASC,
      j.id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.post_sync_jobs j
  SET status = 'claimed',
      claimed_at = p_now,
      claimed_by_device = p_admin_device_id,
      lease_until = p_now + make_interval(secs => v_lease_secs),
      started_at = COALESCE(j.started_at, p_now),
      attempt_count = j.attempt_count + 1,
      updated_at = p_now
  FROM candidate
  WHERE j.id = candidate.id
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_post_sync_job(TEXT, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_post_sync_job(TEXT, INTEGER, TIMESTAMPTZ)
  TO service_role;

-- Thu hồi claim của device (khi admin đăng xuất / đổi máy).
CREATE OR REPLACE FUNCTION public.release_post_sync_claims(
  p_device_id TEXT,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  WITH released AS (
    UPDATE public.post_sync_jobs
    SET status = CASE
          WHEN status = 'claimed' THEN 'pending'::VARCHAR(20)
          WHEN status = 'running' THEN 'retry_wait'::VARCHAR(20)
          ELSE status
        END,
        claimed_at = NULL,
        claimed_by_device = NULL,
        lease_until = NULL,
        updated_at = p_now
    WHERE claimed_by_device = p_device_id
      AND status IN ('claimed','running')
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM released;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.release_post_sync_claims(TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_post_sync_claims(TEXT, TIMESTAMPTZ)
  TO service_role;

-- ==================== RLS ====================
ALTER TABLE public.post_hints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_sync_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_sync_runs ENABLE ROW LEVEL SECURITY;

-- Anon/authenticated chỉ được đọc; mọi ghi đi qua Edge Function (service role, bypass RLS).
DROP POLICY IF EXISTS "post_sync_read" ON public.post_hints;
CREATE POLICY "post_sync_read" ON public.post_hints
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "post_sync_read" ON public.post_sync_jobs;
CREATE POLICY "post_sync_read" ON public.post_sync_jobs
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "post_sync_read" ON public.post_sync_sources;
CREATE POLICY "post_sync_read" ON public.post_sync_sources
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "post_sync_read" ON public.post_sync_runs;
CREATE POLICY "post_sync_read" ON public.post_sync_runs
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.post_hints TO anon, authenticated;
GRANT SELECT ON public.post_sync_jobs TO anon, authenticated;
GRANT SELECT ON public.post_sync_sources TO anon, authenticated;
GRANT SELECT ON public.post_sync_runs TO anon, authenticated;

-- ==================== Seed settings ====================
INSERT INTO public.settings (key, value, description) VALUES
  ('post_sync_feed_interval_minutes', '60', 'Chu kỳ quét feed discovery (phút)'),
  ('post_sync_reconcile_interval_minutes', '1440', 'Chu kỳ đối soát theo username (phút, mặc định 24 giờ)'),
  ('post_sync_lease_seconds', '600', 'Thời gian lease một job sync (giây, tối thiểu 60)'),
  ('post_sync_max_requests_per_run', '50', 'Số request tối đa cho một run'),
  ('post_sync_max_pages_per_source', '5', 'Số trang tối đa quét trong một run'),
  ('post_sync_max_concurrency', '3', 'Số user reconcile đồng thời tối đa'),
  ('post_sync_request_delay_ms', '1500', 'Delay giữa các request (ms)'),
  ('post_sync_manual_user_cooldown_minutes', '10', 'Cooldown quét tay một user (phút)'),
  ('post_sync_default_community', 'cai-tien-moi-ngay', 'Community mặc định cho feed discovery')
ON CONFLICT (key) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
