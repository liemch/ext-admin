-- R5: Kho bài AI — preset, content item, revision bất biến, approval của user
-- và lịch đăng (schedule). Chạy sau 20260918120000.
-- Tham chiếu: PLAN_PRODUCT_9_10.md mục 6.1, 6.3, 17.3, 19.1, 21 (ticket R5).
-- publishing_jobs / publishing_runs thuộc R6 (thực thi đăng bài).

BEGIN;

-- ==================== 1. content_presets ====================
-- community/terms không hardcode trong worker; preset "Cải tiến mỗi ngày"
-- được seed sẵn theo payload TechHub đã nghiệp vụ cung cấp (mục 6.1).

CREATE TABLE IF NOT EXISTS public.content_presets (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  community_id BIGINT NOT NULL CHECK (community_id > 0),
  term_ids BIGINT[] NOT NULL DEFAULT '{}'::BIGINT[],
  body_type VARCHAR(20) NOT NULL DEFAULT 'markdown'
    CHECK (body_type IN ('markdown', 'plain')),
  default_description TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_content_presets_name UNIQUE (name)
);

INSERT INTO public.content_presets
  (name, community_id, term_ids, body_type, default_description, enabled)
VALUES
  ('Cải tiến mỗi ngày', 35, ARRAY[178, 368, 274]::BIGINT[], 'markdown', '', TRUE)
ON CONFLICT (name) DO NOTHING;

-- ==================== 2. content_items ====================
-- Trạng thái biên tập (draft/review/approved/rejected/archived) tách bạch với
-- trạng thái chạy của lịch/job: "Đã lên lịch/Đã đăng" là trạng thái tổng hợp
-- từ schedule, không thêm cột vào content (mục 6.3).
-- content_hash = sha256(title, body, description, community, terms, body_type,
-- ảnh tùy chọn) — UNIQUE để "nhập batch lặp không nhân đôi kho" (R5).

CREATE TABLE IF NOT EXISTS public.content_items (
  id BIGSERIAL PRIMARY KEY,
  preset_id BIGINT NOT NULL REFERENCES public.content_presets (id),
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  main_image TEXT,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  content_hash CHAR(64) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'approved', 'rejected', 'archived')),
  current_revision_id BIGINT,
  ai_model VARCHAR(120),
  prompt_version VARCHAR(40),
  generated_by VARCHAR(100),
  approved_by VARCHAR(100),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_by VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_content_items_hash UNIQUE (content_hash)
);

CREATE INDEX IF NOT EXISTS idx_content_items_status
  ON public.content_items (status, updated_at DESC);

-- ==================== 3. content_revisions ====================
-- Snapshot BẤT BIẾN tạo lúc admin duyệt: schedule trỏ tới revision, không đọc
-- body đang chỉnh ở content item — nên "sửa draft không đổi bài đã duyệt đang
-- chờ đăng" (R5 nghiệm thu). Không có đường UPDATE sau khi tạo.

CREATE TABLE IF NOT EXISTS public.content_revisions (
  id BIGSERIAL PRIMARY KEY,
  content_item_id BIGINT NOT NULL
    REFERENCES public.content_items (id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  preset_id BIGINT NOT NULL REFERENCES public.content_presets (id),
  preset_name VARCHAR(120) NOT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  main_image TEXT,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  community_id BIGINT NOT NULL CHECK (community_id > 0),
  term_ids BIGINT[] NOT NULL DEFAULT '{}'::BIGINT[],
  body_type VARCHAR(20) NOT NULL DEFAULT 'markdown',
  content_hash CHAR(64) NOT NULL,
  approved_by VARCHAR(100) NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_content_revisions_item_number UNIQUE (content_item_id, revision_number)
);

ALTER TABLE public.content_items
  ADD CONSTRAINT fk_content_items_current_revision
  FOREIGN KEY (current_revision_id) REFERENCES public.content_revisions (id)
  NOT VALID;

-- ==================== 4. content_revision_approvals ====================
-- Approval của TARGET USER theo (revision, username): chỉ người được gán mới
-- đồng ý dùng tên mình; admin duyệt chất lượng nhưng không giả lập approval
-- của user (mục 19.1). UNIQUE bảo vệ upsert idempotent.

CREATE TABLE IF NOT EXISTS public.content_revision_approvals (
  id BIGSERIAL PRIMARY KEY,
  revision_id BIGINT NOT NULL
    REFERENCES public.content_revisions (id) ON DELETE CASCADE,
  target_username VARCHAR(100) NOT NULL
    REFERENCES public.users (username) ON DELETE CASCADE,
  decision VARCHAR(12) NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending', 'approved', 'rejected')),
  decided_at TIMESTAMPTZ,
  device_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_content_revision_approvals UNIQUE (revision_id, target_username)
);

CREATE INDEX IF NOT EXISTS idx_content_revision_approvals_user
  ON public.content_revision_approvals (target_username, decision, updated_at DESC);

-- ==================== 5. publishing_schedules ====================
-- scheduled_at lưu UTC; timezone mặc định Asia/Ho_Chi_Minh để nhập/hiển thị
-- (mục 19.1). late_policy mặc định manual_review cho pilot (mục 6.7).

CREATE TABLE IF NOT EXISTS public.publishing_schedules (
  id BIGSERIAL PRIMARY KEY,
  content_item_id BIGINT NOT NULL
    REFERENCES public.content_items (id) ON DELETE CASCADE,
  content_revision_id BIGINT NOT NULL
    REFERENCES public.content_revisions (id),
  target_username VARCHAR(100) NOT NULL
    REFERENCES public.users (username) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  timezone VARCHAR(60) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  late_policy VARCHAR(30) NOT NULL DEFAULT 'manual_review'
    CHECK (late_policy IN ('publish_within_window', 'skip_when_late', 'manual_review')),
  late_window_minutes INTEGER NOT NULL DEFAULT 120
    CHECK (late_window_minutes BETWEEN 5 AND 1440),
  status VARCHAR(12) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  created_by VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- R5 nghiệm thu: hai admin reserve cùng revision → chỉ một người thành công.
-- Revision đã hủy/completed có thể được lập lịch lại bằng revision khác.
CREATE UNIQUE INDEX IF NOT EXISTS uq_publishing_schedules_active_revision
  ON public.publishing_schedules (content_revision_id)
  WHERE status IN ('active', 'paused');

-- Không gán trùng một content item cho cùng user ở hai lịch còn hiệu lực.
CREATE UNIQUE INDEX IF NOT EXISTS uq_publishing_schedules_active_item_user
  ON public.publishing_schedules (content_item_id, target_username)
  WHERE status IN ('active', 'paused');

CREATE INDEX IF NOT EXISTS idx_publishing_schedules_user_time
  ON public.publishing_schedules (target_username, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_publishing_schedules_status_time
  ON public.publishing_schedules (status, scheduled_at);

-- ==================== 6. RLS + grants ====================
-- Client không ghi trực tiếp: mọi thao tác qua publishing-api (service role).
-- Server không nhận cookie/CSRF TechHub (mục 6.2).

ALTER TABLE public.content_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_revision_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publishing_schedules ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.content_presets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.content_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.content_revisions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.content_revision_approvals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.publishing_schedules FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_presets TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_revisions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_revision_approvals TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.publishing_schedules TO service_role;

GRANT USAGE, SELECT ON SEQUENCE public.content_presets_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.content_items_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.content_revisions_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.content_revision_approvals_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.publishing_schedules_id_seq TO service_role;

-- ==================== 7. Settings ====================
-- Giới hạn batch pilot: 20 bài và 1 MB (mục 17.3); mỗi user tối đa 1 bài/ngày.
INSERT INTO public.settings (key, value, description) VALUES
  ('publishing_batch_max_items', '20', 'Số bài tối đa trong một lần nhập kho'),
  ('publishing_batch_max_bytes', '1048576', 'Dung lượng JSON tối đa một batch (byte)'),
  ('publishing_max_schedules_per_user_day', '1', 'Số lịch đăng tối đa cho một user trong một ngày (pilot)')
ON CONFLICT (key) DO NOTHING;

COMMIT;
NOTIFY pgrst, 'reload schema';
