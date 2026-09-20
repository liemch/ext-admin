-- R2: one editable discussion draft per owner/post, with immutable revisions.
BEGIN;

CREATE TABLE public.discussion_script_drafts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_username VARCHAR(100) NOT NULL REFERENCES public.users(username),
  techhub_id BIGINT NOT NULL REFERENCES public.posts(techhub_id) ON DELETE CASCADE,
  current_revision INTEGER NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_username, techhub_id)
);

CREATE TABLE public.discussion_script_revisions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  draft_id BIGINT NOT NULL REFERENCES public.discussion_script_drafts(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  threads JSONB NOT NULL CHECK (jsonb_typeof(threads) = 'array' AND jsonb_array_length(threads) BETWEEN 1 AND 3),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (draft_id, revision_number)
);

CREATE INDEX idx_discussion_script_revisions_latest
  ON public.discussion_script_revisions (draft_id, revision_number DESC);

ALTER TABLE public.discussion_script_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discussion_script_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.discussion_script_drafts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.discussion_script_revisions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.discussion_script_drafts_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.discussion_script_revisions_id_seq FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.save_discussion_script_draft(
  p_owner_username TEXT,
  p_techhub_id BIGINT,
  p_threads JSONB,
  p_content_hash TEXT,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE(draft_id BIGINT, revision_number INTEGER, created BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft_id BIGINT;
  v_revision INTEGER;
  v_old_hash TEXT;
BEGIN
  IF NULLIF(BTRIM(p_owner_username), '') IS NULL OR p_techhub_id <= 0
     OR jsonb_typeof(p_threads) <> 'array'
     OR jsonb_array_length(p_threads) NOT BETWEEN 1 AND 3
     OR p_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'DRAFT_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.username = BTRIM(p_owner_username)
      AND p.techhub_id = p_techhub_id
      AND p.status = 'open'
      AND p.verification_status = 'verified'
  ) THEN
    RAISE EXCEPTION 'POST_NOT_OWNED_OR_VERIFIED';
  END IF;

  INSERT INTO public.discussion_script_drafts (owner_username, techhub_id, updated_at)
  VALUES (BTRIM(p_owner_username), p_techhub_id, p_now)
  ON CONFLICT (owner_username, techhub_id) DO UPDATE
    SET updated_at = EXCLUDED.updated_at
  RETURNING id, current_revision INTO v_draft_id, v_revision;

  SELECT r.content_hash INTO v_old_hash
  FROM public.discussion_script_revisions r
  WHERE r.draft_id = v_draft_id AND r.revision_number = v_revision;
  IF v_old_hash = p_content_hash THEN
    RETURN QUERY SELECT v_draft_id, v_revision, FALSE;
    RETURN;
  END IF;

  v_revision := v_revision + 1;
  INSERT INTO public.discussion_script_revisions
    (draft_id, revision_number, threads, content_hash, created_at)
  VALUES (v_draft_id, v_revision, p_threads, p_content_hash, p_now);
  UPDATE public.discussion_script_drafts d
  SET current_revision = v_revision, status = 'draft', updated_at = p_now
  WHERE d.id = v_draft_id;
  RETURN QUERY SELECT v_draft_id, v_revision, TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.save_discussion_script_draft(TEXT, BIGINT, JSONB, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_discussion_script_draft(TEXT, BIGINT, JSONB, TEXT, TIMESTAMPTZ)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
