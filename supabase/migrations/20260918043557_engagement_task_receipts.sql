-- R3: actor assignment, per-revision approvals and durable execution receipts.
BEGIN;

CREATE TABLE public.discussion_script_assignments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  draft_id BIGINT NOT NULL REFERENCES public.discussion_script_drafts(id) ON DELETE CASCADE,
  revision_id BIGINT NOT NULL REFERENCES public.discussion_script_revisions(id) ON DELETE CASCADE,
  techhub_id BIGINT NOT NULL REFERENCES public.posts(techhub_id) ON DELETE CASCADE,
  author_username VARCHAR(100) NOT NULL REFERENCES public.users(username),
  visitor_username VARCHAR(100) NOT NULL REFERENCES public.users(username),
  author_reserved_actions INTEGER NOT NULL CHECK (author_reserved_actions > 0),
  visitor_reserved_actions INTEGER NOT NULL CHECK (visitor_reserved_actions > 0),
  status TEXT NOT NULL DEFAULT 'awaiting_approval'
    CHECK (status IN ('awaiting_approval','ready','running','completed','rejected','expired','blocked','cancelled')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (revision_id),
  CHECK (author_username <> visitor_username)
);

CREATE TABLE public.discussion_script_approvals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assignment_id BIGINT NOT NULL REFERENCES public.discussion_script_assignments(id) ON DELETE CASCADE,
  revision_id BIGINT NOT NULL REFERENCES public.discussion_script_revisions(id) ON DELETE CASCADE,
  username VARCHAR(100) NOT NULL REFERENCES public.users(username),
  actor_role TEXT NOT NULL CHECK (actor_role IN ('author','visitor')),
  decision TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','approved','rejected')),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (assignment_id, username)
);

ALTER TABLE public.discussion_threads
  ADD COLUMN IF NOT EXISTS source_revision_id BIGINT REFERENCES public.discussion_script_revisions(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_discussion_threads_source_revision_name
  ON public.discussion_threads(source_revision_id, name)
  WHERE source_revision_id IS NOT NULL;

CREATE TABLE public.engagement_task_receipts (
  task_id BIGINT PRIMARY KEY REFERENCES public.engagement_tasks(id) ON DELETE CASCADE,
  actor_username VARCHAR(100) NOT NULL REFERENCES public.users(username),
  device_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('begun','posted','completed','ambiguous')),
  techhub_result_id BIGINT,
  content_hash TEXT,
  http_status INTEGER,
  detail JSONB,
  begun_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_script_assignments_user_status
  ON public.discussion_script_assignments(visitor_username, status, expires_at);
CREATE UNIQUE INDEX uq_script_assignment_active_pair_post
  ON public.discussion_script_assignments(techhub_id, author_username, visitor_username)
  WHERE status IN ('awaiting_approval','ready','running');
CREATE INDEX idx_script_approvals_user_decision
  ON public.discussion_script_approvals(username, decision, created_at DESC);

ALTER TABLE public.discussion_script_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discussion_script_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_task_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.discussion_script_assignments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.discussion_script_approvals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.engagement_task_receipts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.discussion_script_assignments_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.discussion_script_approvals_id_seq FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
