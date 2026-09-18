\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.users (username, full_name)
VALUES ('r3_author', 'R3 Author'), ('r3_visitor', 'R3 Visitor')
ON CONFLICT (username) DO NOTHING;
INSERT INTO public.posts (techhub_id, username, title, verification_status, status)
VALUES (987654322, 'r3_author', 'R3 fixture', 'verified', 'open');

WITH draft AS (
  INSERT INTO public.discussion_script_drafts(owner_username, techhub_id, current_revision)
  VALUES ('r3_author', 987654322, 1) RETURNING id
), revision AS (
  INSERT INTO public.discussion_script_revisions(draft_id, revision_number, threads, content_hash)
  SELECT id, 1, '[{"name":"r3","turns":[{"actor":"A","content":"Question"},{"actor":"B","content":"Answer"},{"actor":"A","content":"Follow up"}]}]'::jsonb, REPEAT('d',64)
  FROM draft RETURNING id, draft_id
), assignment AS (
  INSERT INTO public.discussion_script_assignments
    (draft_id, revision_id, author_username, visitor_username)
  SELECT draft_id, id, 'r3_author', 'r3_visitor' FROM revision RETURNING id, revision_id
)
INSERT INTO public.discussion_script_approvals(assignment_id, revision_id, username, actor_role, decision)
SELECT id, revision_id, 'r3_author', 'author', 'approved' FROM assignment
UNION ALL
SELECT id, revision_id, 'r3_visitor', 'visitor', 'pending' FROM assignment;

DO $$
DECLARE v_assignment BIGINT;
BEGIN
  SELECT id INTO v_assignment FROM public.discussion_script_assignments
  WHERE author_username='r3_author' AND visitor_username='r3_visitor';
  IF (SELECT COUNT(*) FROM public.discussion_script_approvals WHERE assignment_id=v_assignment) <> 2 THEN
    RAISE EXCEPTION 'assignment does not require both actor approvals';
  END IF;
  BEGIN
    INSERT INTO public.discussion_script_approvals(assignment_id, revision_id, username, actor_role)
    SELECT v_assignment, revision_id, 'r3_visitor', 'visitor'
    FROM public.discussion_script_assignments WHERE id=v_assignment;
    RAISE EXCEPTION 'duplicate actor approval accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  IF has_table_privilege('anon','public.discussion_script_approvals','SELECT')
     OR has_table_privilege('authenticated','public.engagement_task_receipts','INSERT') THEN
    RAISE EXCEPTION 'client can bypass R3 API';
  END IF;
END $$;

ROLLBACK;
SELECT 'R3 approval/receipt DB contract passed' AS result;
