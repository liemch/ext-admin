-- Harden post-sync after the initial 013 rollout.
-- This migration is intentionally additive: 013 may already be deployed.

BEGIN;

-- The extension anon key may read the posts cache, but only Edge Functions may
-- mutate posts or the coordination tables. The old FOR ALL policy from 001
-- would otherwise allow a client to self-mark a post as verified.
DROP POLICY IF EXISTS "ext_posts_all" ON public.posts;
DROP POLICY IF EXISTS "ext_posts_read" ON public.posts;
CREATE POLICY "ext_posts_read" ON public.posts
  FOR SELECT TO anon, authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.posts FROM anon, authenticated;
GRANT SELECT ON public.posts TO anon, authenticated;

DROP POLICY IF EXISTS "post_sync_read" ON public.post_hints;
DROP POLICY IF EXISTS "post_sync_read" ON public.post_sync_jobs;
DROP POLICY IF EXISTS "post_sync_read" ON public.post_sync_sources;
DROP POLICY IF EXISTS "post_sync_read" ON public.post_sync_runs;
REVOKE ALL ON public.post_hints, public.post_sync_jobs,
  public.post_sync_sources, public.post_sync_runs FROM anon, authenticated;

-- Engagement coordination is also API-only. Users receive their own status
-- through engagement-api using a device token.
DROP POLICY IF EXISTS "engagement_read" ON public.engagement_devices;
DROP POLICY IF EXISTS "engagement_read" ON public.engagement_campaigns;
DROP POLICY IF EXISTS "engagement_read" ON public.engagement_tasks;
DROP POLICY IF EXISTS "engagement_read" ON public.engagement_events;
DROP POLICY IF EXISTS "engagement_read" ON public.discussion_threads;
DROP POLICY IF EXISTS "engagement_read" ON public.discussion_turns;
REVOKE ALL ON public.engagement_devices, public.engagement_campaigns,
  public.engagement_tasks, public.engagement_events,
  public.discussion_threads, public.discussion_turns FROM anon, authenticated;

-- One global post-sync leader. A leader renews this singleton lease whenever it
-- claims, even when the queue is empty, so another admin machine stays idle.
CREATE TABLE IF NOT EXISTS public.post_sync_leader_lease (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  device_id TEXT,
  lease_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.post_sync_leader_lease (singleton)
VALUES (TRUE)
ON CONFLICT (singleton) DO NOTHING;
ALTER TABLE public.post_sync_leader_lease ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.post_sync_leader_lease FROM PUBLIC, anon, authenticated;

-- A restart/reclaim must reuse the unfinished run instead of creating another.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY started_at, id) AS rn
  FROM public.post_sync_runs
  WHERE finished_at IS NULL AND job_id IS NOT NULL
)
UPDATE public.post_sync_runs r
SET finished_at = NOW(),
    outcome = 'failed',
    error_summary = COALESCE(r.error_summary, 'duplicate_unfinished_run_closed_by_migration')
FROM ranked x
WHERE r.id = x.id AND x.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_post_sync_runs_unfinished_job
  ON public.post_sync_runs (job_id)
  WHERE finished_at IS NULL AND job_id IS NOT NULL;

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
  v_leader public.post_sync_leader_lease%ROWTYPE;
  v_lease_secs INTEGER;
BEGIN
  IF NULLIF(BTRIM(p_admin_device_id), '') IS NULL THEN
    RAISE EXCEPTION 'device id is required';
  END IF;
  v_lease_secs := LEAST(3600, GREATEST(COALESCE(p_lease_seconds, 600), 60));

  SELECT * INTO v_leader
  FROM public.post_sync_leader_lease
  WHERE singleton = TRUE
  FOR UPDATE;

  IF v_leader.device_id IS NOT NULL
     AND v_leader.device_id <> p_admin_device_id
     AND v_leader.lease_until IS NOT NULL
     AND v_leader.lease_until >= p_now THEN
    RETURN;
  END IF;

  UPDATE public.post_sync_leader_lease
  SET device_id = p_admin_device_id,
      lease_until = p_now + make_interval(secs => v_lease_secs),
      updated_at = p_now
  WHERE singleton = TRUE;

  UPDATE public.post_sync_jobs
  SET status = CASE
        WHEN status = 'claimed' THEN 'pending'::VARCHAR(20)
        ELSE 'retry_wait'::VARCHAR(20)
      END,
      claimed_at = NULL,
      claimed_by_device = NULL,
      lease_until = NULL,
      updated_at = p_now
  WHERE id IN (
    SELECT id
    FROM public.post_sync_jobs
    WHERE status IN ('claimed', 'running')
      AND lease_until IS NOT NULL
      AND lease_until < p_now
    ORDER BY lease_until
    LIMIT 200
    FOR UPDATE SKIP LOCKED
  );

  SELECT * INTO v_existing
  FROM public.post_sync_jobs
  WHERE claimed_by_device = p_admin_device_id
    AND status IN ('claimed', 'running')
    AND lease_until >= p_now
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

  RETURN QUERY
  WITH candidate AS (
    SELECT j.id
    FROM public.post_sync_jobs j
    WHERE j.status IN ('pending', 'retry_wait')
      AND j.scheduled_at <= p_now
      AND j.attempt_count < j.max_attempts
    ORDER BY CASE j.type
        WHEN 'verify_hint' THEN 1
        WHEN 'feed_discovery' THEN 2
        WHEN 'user_reconcile' THEN 3
        ELSE 9 END,
      j.scheduled_at, j.id
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

CREATE OR REPLACE FUNCTION public.start_post_sync_run(
  p_job_id BIGINT,
  p_source_id BIGINT,
  p_device_id TEXT,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_job public.post_sync_jobs%ROWTYPE;
  v_run_id BIGINT;
BEGIN
  SELECT * INTO v_job
  FROM public.post_sync_jobs
  WHERE id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'job % not found', p_job_id; END IF;
  IF v_job.claimed_by_device IS DISTINCT FROM p_device_id
     OR v_job.status NOT IN ('claimed', 'running')
     OR v_job.lease_until IS NULL OR v_job.lease_until < p_now THEN
    RAISE EXCEPTION 'job % is not leased by device %', p_job_id, p_device_id;
  END IF;

  SELECT id INTO v_run_id
  FROM public.post_sync_runs
  WHERE job_id = p_job_id AND finished_at IS NULL
  ORDER BY id
  LIMIT 1;
  IF v_run_id IS NULL THEN
    INSERT INTO public.post_sync_runs (job_id, source_id, leader_device_id, started_at)
    VALUES (p_job_id, p_source_id, p_device_id, p_now)
    RETURNING id INTO v_run_id;
  END IF;
  UPDATE public.post_sync_jobs
  SET status = 'running', started_at = COALESCE(started_at, p_now), updated_at = p_now
  WHERE id = p_job_id;
  RETURN v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.start_post_sync_run(BIGINT, BIGINT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_post_sync_run(BIGINT, BIGINT, TEXT, TIMESTAMPTZ)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_post_sync_job(
  p_job_id BIGINT,
  p_run_id BIGINT,
  p_device_id TEXT,
  p_metrics JSONB,
  p_articles JSONB,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_job public.post_sync_jobs%ROWTYPE;
  v_existing public.posts%ROWTYPE;
  v_raw JSONB;
  v_id BIGINT;
  v_uuid TEXT;
  v_username TEXT;
  v_published TIMESTAMPTZ;
  v_discovered_by TEXT;
  v_verification TEXT;
  v_changed BOOLEAN;
  v_new INTEGER := 0;
  v_updated INTEGER := 0;
  v_unchanged INTEGER := 0;
  v_request_count INTEGER := GREATEST(0, COALESCE((p_metrics->>'requestCount')::INTEGER, 0));
  v_page_count INTEGER := GREATEST(0, COALESCE((p_metrics->>'pageCount')::INTEGER, 0));
  v_rejected_count INTEGER := GREATEST(0, COALESCE((p_metrics->>'rejectedCount')::INTEGER, 0));
  v_cursor JSONB := CASE
    WHEN p_metrics ? 'lastCursor' AND p_metrics->>'lastCursor' IS NOT NULL
      THEN p_metrics->'lastCursor'
    ELSE NULL END;
  v_budget_exhausted BOOLEAN := COALESCE((p_metrics->>'budgetExhausted')::BOOLEAN, FALSE);
  v_http_status INTEGER := COALESCE((p_metrics->>'httpStatus')::INTEGER, 200);
  v_max_requests INTEGER;
  v_max_pages INTEGER;
  v_interval INTEGER;
  v_continuation_id BIGINT;
  v_outcome TEXT;
BEGIN
  SELECT * INTO v_job FROM public.post_sync_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'job % not found', p_job_id; END IF;

  IF v_job.status = 'succeeded' THEN
    RETURN jsonb_build_object('ok', TRUE, 'duplicate', TRUE, 'jobId', p_job_id,
      'runId', p_run_id, 'outcome', 'succeeded');
  END IF;
  IF v_job.claimed_by_device IS DISTINCT FROM p_device_id
     OR v_job.status <> 'running'
     OR v_job.lease_until IS NULL OR v_job.lease_until < p_now THEN
    RAISE EXCEPTION 'job % is not actively leased by device %', p_job_id, p_device_id;
  END IF;
  IF p_run_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.post_sync_runs
    WHERE id = p_run_id AND job_id = p_job_id AND finished_at IS NULL
  ) THEN
    RAISE EXCEPTION 'active run is required for job %', p_job_id;
  END IF;

  SELECT COALESCE((value #>> '{}')::INTEGER, 50) INTO v_max_requests
  FROM public.settings WHERE key = 'post_sync_max_requests_per_run';
  SELECT COALESCE((value #>> '{}')::INTEGER, 5) INTO v_max_pages
  FROM public.settings WHERE key = 'post_sync_max_pages_per_source';
  v_max_requests := COALESCE(v_max_requests, 50);
  v_max_pages := COALESCE(v_max_pages, 5);
  IF v_request_count > v_max_requests OR v_page_count > v_max_pages THEN
    RAISE EXCEPTION 'reported budget exceeds server limit (% requests, % pages)',
      v_max_requests, v_max_pages;
  END IF;

  v_discovered_by := CASE v_job.type
    WHEN 'verify_hint' THEN 'post_hint'
    WHEN 'feed_discovery' THEN 'feed_discovery'
    ELSE 'user_reconcile' END;

  FOR v_raw IN SELECT value FROM jsonb_array_elements(COALESCE(p_articles, '[]'::JSONB))
  LOOP
    v_id := NULLIF(v_raw->>'techhub_id', '')::BIGINT;
    v_uuid := NULLIF(BTRIM(v_raw->>'techhub_uuid'), '');
    v_username := NULLIF(BTRIM(v_raw->>'username'), '');
    v_published := NULLIF(v_raw->>'published_at', '')::TIMESTAMPTZ;
    IF v_id IS NULL OR v_id <= 0 OR v_uuid IS NULL OR v_username IS NULL THEN
      v_rejected_count := v_rejected_count + 1;
      CONTINUE;
    END IF;
    IF v_job.type = 'verify_hint' AND v_job.username IS NOT NULL
       AND v_job.username <> v_username THEN
      RAISE EXCEPTION 'verified author % does not match hint owner %', v_username, v_job.username;
    END IF;

    v_verification := CASE WHEN v_published IS NULL THEN 'unverified' ELSE 'verified' END;
    SELECT * INTO v_existing FROM public.posts WHERE techhub_id = v_id FOR UPDATE;
    IF FOUND THEN
      v_changed := v_existing.techhub_uuid IS DISTINCT FROM v_uuid
        OR v_existing.username IS DISTINCT FROM v_username
        OR v_existing.title IS DISTINCT FROM NULLIF(v_raw->>'title', '')
        OR v_existing.status IS DISTINCT FROM COALESCE(NULLIF(v_raw->>'status', ''), 'open')
        OR v_existing.url IS DISTINCT FROM NULLIF(v_raw->>'url', '')
        OR v_existing.published_at IS DISTINCT FROM v_published
        OR v_existing.verification_status IS DISTINCT FROM v_verification;
      IF v_changed THEN v_updated := v_updated + 1;
      ELSE v_unchanged := v_unchanged + 1;
      END IF;
    ELSE
      v_new := v_new + 1;
    END IF;

    INSERT INTO public.posts (
      techhub_id, techhub_uuid, username, title, status, url,
      votes_score, comments_count, medals_count, feed_score,
      published_at, community_slug, community_name,
      first_seen_at, last_seen_at, last_verified_at,
      verification_status, discovered_by, sync_run_id, sync_error
    ) VALUES (
      v_id, v_uuid, v_username, NULLIF(v_raw->>'title', ''),
      COALESCE(NULLIF(v_raw->>'status', ''), 'open'), NULLIF(v_raw->>'url', ''),
      COALESCE(NULLIF(v_raw->>'votes_score', '')::DOUBLE PRECISION, 0),
      COALESCE(NULLIF(v_raw->>'comments_count', '')::INTEGER, 0),
      COALESCE(NULLIF(v_raw->>'medals_count', '')::INTEGER, 0),
      COALESCE(NULLIF(v_raw->>'feed_score', '')::DOUBLE PRECISION, 0),
      v_published, NULLIF(v_raw->>'community_slug', ''), NULLIF(v_raw->>'community_name', ''),
      p_now, p_now, CASE WHEN v_verification = 'verified' THEN p_now ELSE NULL END,
      v_verification, v_discovered_by, p_run_id, NULL
    )
    ON CONFLICT (techhub_id) DO UPDATE SET
      techhub_uuid = EXCLUDED.techhub_uuid,
      username = EXCLUDED.username,
      title = EXCLUDED.title,
      status = EXCLUDED.status,
      url = EXCLUDED.url,
      votes_score = EXCLUDED.votes_score,
      comments_count = EXCLUDED.comments_count,
      medals_count = EXCLUDED.medals_count,
      feed_score = EXCLUDED.feed_score,
      published_at = EXCLUDED.published_at,
      community_slug = EXCLUDED.community_slug,
      community_name = EXCLUDED.community_name,
      first_seen_at = COALESCE(posts.first_seen_at, EXCLUDED.first_seen_at),
      last_seen_at = EXCLUDED.last_seen_at,
      last_verified_at = CASE WHEN EXCLUDED.verification_status = 'verified'
        THEN EXCLUDED.last_verified_at ELSE posts.last_verified_at END,
      verification_status = EXCLUDED.verification_status,
      discovered_by = EXCLUDED.discovered_by,
      sync_run_id = EXCLUDED.sync_run_id,
      sync_error = NULL;
  END LOOP;

  IF v_job.type = 'verify_hint' AND v_job.hint_id IS NOT NULL THEN
    UPDATE public.post_hints
    SET status = 'verified', verified_at = p_now, last_error = NULL, updated_at = p_now
    WHERE id = v_job.hint_id;
  END IF;

  v_outcome := CASE WHEN v_budget_exhausted THEN 'partial' ELSE 'succeeded' END;
  UPDATE public.post_sync_runs
  SET finished_at = p_now, outcome = v_outcome,
      request_count = v_request_count, page_count = v_page_count,
      new_count = v_new, updated_count = v_updated,
      unchanged_count = v_unchanged, rejected_count = v_rejected_count,
      last_cursor = v_cursor, http_status = v_http_status,
      error_summary = NULL, budget_exhausted = v_budget_exhausted
  WHERE id = p_run_id AND job_id = p_job_id AND finished_at IS NULL;

  IF v_job.source_id IS NOT NULL THEN
    SELECT COALESCE((value #>> '{}')::INTEGER,
      CASE WHEN v_job.type = 'feed_discovery' THEN 60 ELSE 1440 END)
    INTO v_interval FROM public.settings
    WHERE key = CASE WHEN v_job.type = 'feed_discovery'
      THEN 'post_sync_feed_interval_minutes' ELSE 'post_sync_reconcile_interval_minutes' END;
    v_interval := COALESCE(v_interval,
      CASE WHEN v_job.type = 'feed_discovery' THEN 60 ELSE 1440 END);
    UPDATE public.post_sync_sources
    SET last_checked_at = p_now,
        last_success_at = CASE WHEN v_budget_exhausted THEN last_success_at ELSE p_now END,
        next_check_at = CASE WHEN v_budget_exhausted THEN p_now + INTERVAL '2 minutes'
          ELSE p_now + make_interval(mins => v_interval) END,
        cursor = v_cursor,
        last_error = NULL,
        request_count_24h = CASE
          WHEN window_started_at IS NULL OR window_started_at < p_now - INTERVAL '24 hours'
            THEN v_request_count
          ELSE request_count_24h + v_request_count END,
        window_started_at = CASE
          WHEN window_started_at IS NULL OR window_started_at < p_now - INTERVAL '24 hours'
            THEN p_now ELSE window_started_at END,
        updated_at = p_now
    WHERE id = v_job.source_id;
  END IF;

  IF v_budget_exhausted AND v_cursor IS NOT NULL THEN
    INSERT INTO public.post_sync_jobs (
      type, status, source_id, hint_id, username, payload, scheduled_at,
      max_attempts, idempotency_key, continuation_of
    ) VALUES (
      v_job.type, 'pending', v_job.source_id, v_job.hint_id, v_job.username,
      COALESCE(v_job.payload, '{}'::JSONB) || jsonb_build_object('cursor', v_cursor, 'continuation', TRUE),
      p_now + INTERVAL '2 minutes', v_job.max_attempts,
      v_job.idempotency_key || ':cont:' || COALESCE(v_cursor->>'page', 'next'), p_job_id
    )
    ON CONFLICT (idempotency_key) DO UPDATE SET
      scheduled_at = LEAST(post_sync_jobs.scheduled_at, EXCLUDED.scheduled_at),
      updated_at = p_now
    RETURNING id INTO v_continuation_id;
  END IF;

  UPDATE public.post_sync_jobs
  SET status = 'succeeded', completed_at = p_now, cursor = v_cursor,
      last_http_status = v_http_status, last_error = NULL,
      claimed_by_device = NULL, lease_until = NULL, updated_at = p_now
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'ok', TRUE, 'duplicate', FALSE, 'jobId', p_job_id, 'runId', p_run_id,
    'outcome', v_outcome, 'newCount', v_new, 'updatedCount', v_updated,
    'unchangedCount', v_unchanged, 'rejectedCount', v_rejected_count,
    'continuationJobId', v_continuation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_post_sync_job(BIGINT, BIGINT, TEXT, JSONB, JSONB, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_post_sync_job(BIGINT, BIGINT, TEXT, JSONB, JSONB, TIMESTAMPTZ)
  TO service_role;

INSERT INTO public.settings (key, value, description)
VALUES ('engagement_enabled', 'true'::JSONB,
  'Admin controls engagement globally; users cannot opt in or out')
ON CONFLICT (key) DO UPDATE
SET value = COALESCE(settings.value, EXCLUDED.value),
    description = EXCLUDED.description;

COMMIT;

NOTIFY pgrst, 'reload schema';
