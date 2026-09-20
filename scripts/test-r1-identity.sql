\set ON_ERROR_STOP on

BEGIN;

INSERT INTO public.users (username, full_name, is_locked)
VALUES ('r1_user_a', 'R1 User A', FALSE), ('r1_user_b', 'R1 User B', FALSE)
ON CONFLICT (username) DO UPDATE SET is_locked = FALSE;

INSERT INTO public.device_enrollment_invitations
  (username, code_hash, expires_at, created_by)
VALUES
  ('r1_user_a', 'r1-code-hash-a', NOW() + INTERVAL '1 hour', 'test');

SELECT * FROM public.consume_device_enrollment_invitation(
  'r1-code-hash-a', 'r1-device-a', 'r1-token-hash-a', 'test device', NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_consents WHERE username = 'r1_user_a') THEN
    RAISE EXCEPTION 'enrollment unexpectedly created consent';
  END IF;
END
$$;

SELECT username, engagement_enabled, daily_action_limit
FROM public.update_user_consent(
  'r1_user_a', 'r1-device-a', 1, TRUE, FALSE, FALSE,
  '{"enabled":false,"timezone":"Asia/Ho_Chi_Minh"}'::jsonb, 2, NOW()
);

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.user_consent_events WHERE username = 'r1_user_a') <> 1 THEN
    RAISE EXCEPTION 'consent update did not create exactly one audit event';
  END IF;
  BEGIN
    PERFORM public.update_user_consent(
      'r1_user_b', 'r1-device-a', 1, TRUE, FALSE, FALSE, '{}'::jsonb, 2, NOW()
    );
    RAISE EXCEPTION 'device A updated user B consent';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'device A updated user B consent' THEN RAISE; END IF;
    IF POSITION('DEVICE_NOT_APPROVED' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
END
$$;

DO $$
BEGIN
  BEGIN
    PERFORM public.consume_device_enrollment_invitation(
      'r1-code-hash-a', 'r1-device-replay', 'r1-token-replay', 'replay', NOW()
    );
    RAISE EXCEPTION 'invitation replay unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'invitation replay unexpectedly succeeded' THEN RAISE; END IF;
    IF POSITION('ENROLLMENT_CODE_INVALID_OR_EXPIRED' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
END
$$;

SELECT public.disconnect_engagement_device('r1_user_a', 'r1-device-a', NOW());

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_consents
    WHERE username = 'r1_user_a' AND engagement_enabled = TRUE
  ) THEN
    RAISE EXCEPTION 'disconnect did not pause consent';
  END IF;
  IF (SELECT COUNT(*) FROM public.user_consent_events
      WHERE username = 'r1_user_a' AND event = 'disconnected') <> 1 THEN
    RAISE EXCEPTION 'disconnect audit event missing';
  END IF;
END
$$;

INSERT INTO public.device_enrollment_invitations
  (username, code_hash, expires_at, created_by)
VALUES
  ('r1_user_a', 'r1-code-hash-b', NOW() + INTERVAL '1 hour', 'test');

DO $$
BEGIN
  BEGIN
    PERFORM public.consume_device_enrollment_invitation(
      'r1-code-hash-b', 'r1-device-a', 'r1-token-hash-b', 'revive attempt', NOW()
    );
    RAISE EXCEPTION 'revoked device unexpectedly revived';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'revoked device unexpectedly revived' THEN RAISE; END IF;
    IF POSITION('DEVICE_REVOKED' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
END
$$;

DO $$
BEGIN
  IF has_function_privilege(
    'anon',
    'public.consume_device_enrollment_invitation(text,text,text,text,timestamptz)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon can execute enrollment RPC';
  END IF;
  IF has_table_privilege('anon', 'public.user_consents', 'SELECT')
     OR has_table_privilege('authenticated', 'public.user_consents', 'SELECT') THEN
    RAISE EXCEPTION 'client roles can read user consent rows directly';
  END IF;
  IF has_table_privilege('anon', 'public.users', 'SELECT')
     OR has_table_privilege('authenticated', 'public.users', 'SELECT')
     OR has_table_privilege('anon', 'public.users', 'INSERT')
     OR has_table_privilege('authenticated', 'public.users', 'UPDATE') THEN
    RAISE EXCEPTION 'client roles still have direct users access';
  END IF;
  IF has_table_privilege('anon', 'public.engagement_devices', 'SELECT')
     OR has_table_privilege('authenticated', 'public.engagement_tasks', 'SELECT')
     OR has_table_privilege('anon', 'public.discussion_turns', 'SELECT') THEN
    RAISE EXCEPTION 'client roles still read cross-user engagement objects';
  END IF;
END
$$;

ROLLBACK;

SELECT 'R1 identity/consent DB contract passed' AS result;
