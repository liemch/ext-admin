-- Extension mục tiêu: quét bài user + push comment + auto-reply trên bài của mình
-- Cơ chế gốc: capture session TechHub → sync user/posts → comment/reply qua API
-- Chạy trong: Supabase Dashboard → SQL Editor → Run

BEGIN;

-- ==================== users ====================
CREATE TABLE IF NOT EXISTS public.users (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(150),
  username VARCHAR(100) NOT NULL UNIQUE,
  email VARCHAR(255),
  avatar TEXT,
  last_update TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_users_username ON public.users (username);
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON public.users (is_admin);

-- ==================== posts ====================
CREATE TABLE IF NOT EXISTS public.posts (
  id BIGSERIAL PRIMARY KEY,
  title TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'open',
  techhub_id BIGINT NOT NULL UNIQUE,
  techhub_uuid VARCHAR(100),
  username VARCHAR(100),
  url TEXT,
  votes_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  medals_count INTEGER NOT NULL DEFAULT 0,
  feed_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_ultra BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_posts_username ON public.posts (username);
CREATE INDEX IF NOT EXISTS idx_posts_techhub_id ON public.posts (techhub_id);
CREATE INDEX IF NOT EXISTS idx_posts_status_created ON public.posts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_is_ultra ON public.posts (is_ultra);

-- ==================== settings ====================
CREATE TABLE IF NOT EXISTS public.settings (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settings_key ON public.settings (key);

-- ==================== comment_templates ====================
CREATE TABLE IF NOT EXISTS public.comment_templates (
  id BIGSERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  kind TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'reply')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comment_templates_active ON public.comment_templates (is_active);
CREATE INDEX IF NOT EXISTS idx_comment_templates_kind ON public.comment_templates (kind, is_active);

-- ==================== interactions ====================
CREATE TABLE IF NOT EXISTS public.interactions (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  techhub_id BIGINT NOT NULL,
  interaction_type VARCHAR(20) NOT NULL,
  parent_comment_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interactions_lookup
  ON public.interactions (username, techhub_id, interaction_type);
CREATE INDEX IF NOT EXISTS idx_interactions_techhub_id
  ON public.interactions (techhub_id);
CREATE INDEX IF NOT EXISTS idx_interactions_created_at
  ON public.interactions (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_interactions_reply_unique
  ON public.interactions (username, parent_comment_id)
  WHERE interaction_type = 'reply' AND parent_comment_id IS NOT NULL;

-- ==================== RLS ====================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ext_users_all" ON public.users;
CREATE POLICY "ext_users_all" ON public.users
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ext_posts_all" ON public.posts;
CREATE POLICY "ext_posts_all" ON public.posts
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ext_settings_all" ON public.settings;
CREATE POLICY "ext_settings_all" ON public.settings
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ext_comment_templates_all" ON public.comment_templates;
CREATE POLICY "ext_comment_templates_all" ON public.comment_templates
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ext_interactions_all" ON public.interactions;
CREATE POLICY "ext_interactions_all" ON public.interactions
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

COMMIT;
