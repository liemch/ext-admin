-- R1: device enrollment, versioned user consent and ownership boundaries.
-- Existing devices remain approved so the schema rollout is compatible, but
-- consent is deliberately not backfilled: every user must opt in explicitly.

BEGIN;

ALTER TABLE public.engagement_devices
  ADD COLUMN IF NOT EXISTS enrollment_status TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by VARCHAR(100),
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

UPDATE public.engagement_devices
SET enrollment_status = CASE WHEN revoked THEN 'revoked' ELSE 'approved' END,
    approved_at = CASE WHEN revoked THEN approved_at ELSE COALESCE(approved_at, created_at) END,
    approved_by = CASE WHEN revoked THEN approved_by ELSE COALESCE(approved_by, 'legacy-migration') END,
    revoked_at = CASE WHEN revoked THEN COALESCE(revoked_at, updated_at) ELSE NULL END
WHERE enrollment_status IS NULL;

ALTER TABLE public.engagement_devices
  ALTER COLUMN enrollment_status SET DEFAULT 'pending',
  ALTER COLUMN enrollment_status SET NOT NULL;

ALTER TABLE public.engagement_devices
  DROP CONSTRAINT IF EXISTS engagement_devices_enrollment_status_check;
ALTER TABLE public.engagement_devices
  ADD CONSTRAINT engagement_devices_enrollment_status_check
  CHECK (enrollment_status IN ('pending', 'approved', 'revoked'));

CREATE INDEX IF NOT EXISTS idx_engagement_devices_enrollment
  ON public.engagement_devices (enrollment_status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS public.device_enrollment_invitations (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL REFERENCES public.users (username) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_by_device TEXT,
  revoked_at TIMESTAMPTZ,
  created_by VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_device_enrollment_invites_open
  ON public.device_enrollment_invitations (username, expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.user_consents (
  username VARCHAR(100) PRIMARY KEY REFERENCES public.users (username) ON DELETE CASCADE,
  consent_version INTEGER NOT NULL CHECK (consent_version > 0),
  engagement_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  auto_publish_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  delegated_engagement_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  delegation_policy_version BIGINT,
  delegation_expires_at TIMESTAMPTZ,
  consented_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  quiet_hours JSONB NOT NULL DEFAULT '{"enabled":false,"timezone":"Asia/Ho_Chi_Minh"}'::jsonb,
  daily_action_limit INTEGER NOT NULL DEFAULT 2 CHECK (daily_action_limit BETWEEN 1 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_consent_events (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL REFERENCES public.users (username) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  consent_version INTEGER NOT NULL,
  engagement_enabled BOOLEAN NOT NULL,
  auto_publish_enabled BOOLEAN NOT NULL,
  delegated_engagement_enabled BOOLEAN NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('updated', 'paused', 'resumed', 'disconnected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_consent_events_owner_time
  ON public.user_consent_events (username, created_at DESC);

ALTER TABLE public.device_enrollment_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_consent_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.device_enrollment_invitations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.user_consents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.user_consent_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.device_enrollment_invitations_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.user_consent_events_id_seq FROM PUBLIC, anon, authenticated;

-- Roles/profile are now read through an approved device (or ADMIN_TOKEN), so
-- anon clients must no longer enumerate other users or read their email.
DROP POLICY IF EXISTS "ext_users_all" ON public.users;
REVOKE ALL ON public.users FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.users_id_seq FROM anon, authenticated;

-- The extension reads these objects through ownership-checked Edge Functions.
-- Legacy read-all policies exposed device hashes and other users' task content.
REVOKE ALL ON public.engagement_devices FROM anon, authenticated;
REVOKE ALL ON public.engagement_campaigns FROM anon, authenticated;
REVOKE ALL ON public.engagement_tasks FROM anon, authenticated;
REVOKE ALL ON public.engagement_events FROM anon, authenticated;
REVOKE ALL ON public.discussion_threads FROM anon, authenticated;
REVOKE ALL ON public.discussion_turns FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_device_enrollment_invitation(
  p_code_hash TEXT,
  p_device_id TEXT,
  p_token_hash TEXT,
  p_label TEXT DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE(device_id TEXT, username VARCHAR, enrollment_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invite public.device_enrollment_invitations%ROWTYPE;
  v_existing public.engagement_devices%ROWTYPE;
BEGIN
  IF NULLIF(BTRIM(p_code_hash), '') IS NULL
     OR NULLIF(BTRIM(p_device_id), '') IS NULL
     OR NULLIF(BTRIM(p_token_hash), '') IS NULL THEN
    RAISE EXCEPTION 'ENROLLMENT_INVALID';
  END IF;

  SELECT * INTO v_invite
  FROM public.device_enrollment_invitations i
  WHERE i.code_hash = BTRIM(p_code_hash)
  FOR UPDATE;

  IF NOT FOUND OR v_invite.revoked_at IS NOT NULL
     OR v_invite.consumed_at IS NOT NULL OR v_invite.expires_at <= p_now THEN
    RAISE EXCEPTION 'ENROLLMENT_CODE_INVALID_OR_EXPIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.username = v_invite.username AND COALESCE(u.is_locked, FALSE) = FALSE
  ) THEN
    RAISE EXCEPTION 'ENROLLMENT_USER_UNAVAILABLE';
  END IF;

  SELECT * INTO v_existing
  FROM public.engagement_devices d
  WHERE d.username = v_invite.username AND d.device_id = BTRIM(p_device_id)
  FOR UPDATE;

  IF FOUND AND (v_existing.revoked OR v_existing.enrollment_status = 'revoked') THEN
    RAISE EXCEPTION 'DEVICE_REVOKED';
  END IF;
  IF FOUND AND v_existing.enrollment_status = 'approved'
     AND v_existing.token_hash <> BTRIM(p_token_hash) THEN
    RAISE EXCEPTION 'DEVICE_ALREADY_ENROLLED';
  END IF;

  INSERT INTO public.engagement_devices
    (device_id, username, token_hash, label, last_seen_at, revoked,
     enrollment_status, approved_at, approved_by, updated_at)
  VALUES
    (BTRIM(p_device_id), v_invite.username, BTRIM(p_token_hash), NULLIF(BTRIM(p_label), ''),
     p_now, FALSE, 'approved', p_now, 'invitation', p_now)
  ON CONFLICT ON CONSTRAINT uq_engagement_devices_user_device DO UPDATE
  SET token_hash = EXCLUDED.token_hash,
      label = COALESCE(EXCLUDED.label, public.engagement_devices.label),
      last_seen_at = EXCLUDED.last_seen_at,
      enrollment_status = 'approved',
      approved_at = EXCLUDED.approved_at,
      approved_by = EXCLUDED.approved_by,
      updated_at = EXCLUDED.updated_at;

  UPDATE public.device_enrollment_invitations
  SET consumed_at = p_now, consumed_by_device = BTRIM(p_device_id)
  WHERE id = v_invite.id;

  RETURN QUERY SELECT BTRIM(p_device_id), v_invite.username, 'approved'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_device_enrollment_invitation(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_device_enrollment_invitation(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.update_user_consent(
  p_username TEXT,
  p_device_id TEXT,
  p_consent_version INTEGER,
  p_engagement_enabled BOOLEAN,
  p_auto_publish_enabled BOOLEAN,
  p_delegated_engagement_enabled BOOLEAN,
  p_quiet_hours JSONB,
  p_daily_action_limit INTEGER,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS SETOF public.user_consents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_was_paused BOOLEAN := FALSE;
  v_event TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.engagement_devices d
    WHERE d.username = BTRIM(p_username)
      AND d.device_id = BTRIM(p_device_id)
      AND d.revoked = FALSE
      AND d.enrollment_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'DEVICE_NOT_APPROVED';
  END IF;
  IF p_consent_version < 1 OR p_daily_action_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'CONSENT_INVALID';
  END IF;

  SELECT c.paused_at IS NOT NULL INTO v_was_paused
  FROM public.user_consents c
  WHERE c.username = BTRIM(p_username)
  FOR UPDATE;
  v_event := CASE
    WHEN NOT p_engagement_enabled THEN 'paused'
    WHEN COALESCE(v_was_paused, FALSE) THEN 'resumed'
    ELSE 'updated'
  END;

  INSERT INTO public.user_consents
    (username, consent_version, engagement_enabled, auto_publish_enabled,
     delegated_engagement_enabled, consented_at, paused_at, quiet_hours,
     daily_action_limit, updated_at)
  VALUES
    (BTRIM(p_username), p_consent_version, p_engagement_enabled,
     p_auto_publish_enabled, p_delegated_engagement_enabled, p_now,
     CASE WHEN p_engagement_enabled THEN NULL ELSE p_now END,
     COALESCE(p_quiet_hours, '{"enabled":false,"timezone":"Asia/Ho_Chi_Minh"}'::jsonb),
     p_daily_action_limit, p_now)
  ON CONFLICT (username) DO UPDATE
  SET consent_version = EXCLUDED.consent_version,
      engagement_enabled = EXCLUDED.engagement_enabled,
      auto_publish_enabled = EXCLUDED.auto_publish_enabled,
      delegated_engagement_enabled = EXCLUDED.delegated_engagement_enabled,
      consented_at = EXCLUDED.consented_at,
      paused_at = EXCLUDED.paused_at,
      quiet_hours = EXCLUDED.quiet_hours,
      daily_action_limit = EXCLUDED.daily_action_limit,
      updated_at = EXCLUDED.updated_at;

  INSERT INTO public.user_consent_events
    (username, device_id, consent_version, engagement_enabled,
     auto_publish_enabled, delegated_engagement_enabled, event, created_at)
  VALUES
    (BTRIM(p_username), BTRIM(p_device_id), p_consent_version,
     p_engagement_enabled, p_auto_publish_enabled,
     p_delegated_engagement_enabled, v_event, p_now);

  RETURN QUERY SELECT c.* FROM public.user_consents c
  WHERE c.username = BTRIM(p_username);
END;
$$;

REVOKE ALL ON FUNCTION public.update_user_consent(TEXT, TEXT, INTEGER, BOOLEAN, BOOLEAN, BOOLEAN, JSONB, INTEGER, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_consent(TEXT, TEXT, INTEGER, BOOLEAN, BOOLEAN, BOOLEAN, JSONB, INTEGER, TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.disconnect_engagement_device(
  p_username TEXT,
  p_device_id TEXT,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_consent_version INTEGER;
BEGIN
  UPDATE public.engagement_devices d
  SET revoked = TRUE,
      enrollment_status = 'revoked',
      revoked_at = p_now,
      updated_at = p_now
  WHERE d.username = BTRIM(p_username)
    AND d.device_id = BTRIM(p_device_id)
    AND d.revoked = FALSE
    AND d.enrollment_status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEVICE_NOT_APPROVED';
  END IF;

  UPDATE public.user_consents c
  SET engagement_enabled = FALSE,
      auto_publish_enabled = FALSE,
      delegated_engagement_enabled = FALSE,
      paused_at = p_now,
      updated_at = p_now
  WHERE c.username = BTRIM(p_username)
  RETURNING c.consent_version INTO v_consent_version;

  IF v_consent_version IS NOT NULL THEN
    INSERT INTO public.user_consent_events
      (username, device_id, consent_version, engagement_enabled,
       auto_publish_enabled, delegated_engagement_enabled, event, created_at)
    VALUES
      (BTRIM(p_username), BTRIM(p_device_id), v_consent_version,
       FALSE, FALSE, FALSE, 'disconnected', p_now);
  END IF;

  PERFORM public.release_actor_claims(BTRIM(p_username), BTRIM(p_device_id), p_now);
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.disconnect_engagement_device(TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.disconnect_engagement_device(TEXT, TEXT, TIMESTAMPTZ) TO service_role;

INSERT INTO public.settings (key, value, description) VALUES
  ('current_consent_version', '1'::jsonb, 'Consent version required for engagement and publishing'),
  ('device_enrollment_required', 'true'::jsonb, 'Only approved devices may run background actions')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
