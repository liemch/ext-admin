\set ON_ERROR_STOP on

BEGIN;

INSERT INTO public.users (username, full_name)
VALUES ('r2_owner', 'R2 Owner'), ('r2_other', 'R2 Other')
ON CONFLICT (username) DO NOTHING;

INSERT INTO public.posts (techhub_id, username, title, verification_status, status)
VALUES (987654321, 'r2_owner', 'R2 fixture', 'verified', 'open');

DO $$
DECLARE
  v_first RECORD;
  v_repeat RECORD;
  v_next RECORD;
  v_threads JSONB := '[{"name":"one","actors":{"A":"visitor","B":"author"},"turns":[{"actor":"A","content":"Question"},{"actor":"B","content":"Answer"}]}]'::jsonb;
BEGIN
  SELECT * INTO v_first FROM public.save_discussion_script_draft(
    'r2_owner', 987654321, v_threads, REPEAT('a', 64));
  IF v_first.revision_number <> 1 OR v_first.created IS NOT TRUE THEN
    RAISE EXCEPTION 'first save did not create revision 1';
  END IF;
  SELECT * INTO v_repeat FROM public.save_discussion_script_draft(
    'r2_owner', 987654321, v_threads, REPEAT('a', 64));
  IF v_repeat.draft_id <> v_first.draft_id OR v_repeat.revision_number <> 1
     OR v_repeat.created IS NOT FALSE THEN
    RAISE EXCEPTION 'repeat save was not idempotent';
  END IF;
  SELECT * INTO v_next FROM public.save_discussion_script_draft(
    'r2_owner', 987654321, v_threads, REPEAT('b', 64));
  IF v_next.revision_number <> 2 OR v_next.created IS NOT TRUE THEN
    RAISE EXCEPTION 'changed draft did not create immutable revision 2';
  END IF;
  IF (SELECT COUNT(*) FROM public.discussion_script_revisions
      WHERE draft_id = v_first.draft_id) <> 2 THEN
    RAISE EXCEPTION 'revision history was overwritten';
  END IF;
  BEGIN
    PERFORM public.save_discussion_script_draft(
      'r2_other', 987654321, v_threads, REPEAT('c', 64));
    RAISE EXCEPTION 'other user saved owner post';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'other user saved owner post' THEN RAISE; END IF;
    IF POSITION('POST_NOT_OWNED_OR_VERIFIED' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
  IF has_table_privilege('anon', 'public.discussion_script_drafts', 'SELECT')
     OR has_table_privilege('authenticated', 'public.discussion_script_revisions', 'SELECT')
     OR has_function_privilege('anon',
       'public.save_discussion_script_draft(text,bigint,jsonb,text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'client roles can bypass draft ownership API';
  END IF;
  DELETE FROM public.posts WHERE techhub_id = 987654321;
  IF EXISTS (SELECT 1 FROM public.discussion_script_drafts WHERE id = v_first.draft_id) THEN
    RAISE EXCEPTION 'draft remained after source post deletion';
  END IF;
END
$$;

ROLLBACK;
SELECT 'R2 discussion draft DB contract passed' AS result;
