-- ============================================================================
-- Migration 0002 – Rule 4.1: mọi bảng phải có id, created_at, updated_at,
--                            created_by, updated_by
--
-- Baseline (0001) đến từ Developer Kit v1.0 và còn thiếu các cột này ở phần lớn
-- bảng. Migration này bổ sung mà KHÔNG đổi ngữ nghĩa nghiệp vụ nào.
--
-- Quy ước:
--   * created_by / updated_by  = users(id) của actor thực hiện thao tác.
--     NULL nghĩa là "do hệ thống thực hiện" (outbox worker, migration, seed) —
--     không phải "không biết". Audit trail thật nằm ở bảng audit_logs.
--   * Bảng append-only (case_locations, case_status_history, guidance_events,
--     audit_logs, outbox_events, consent_records, triage_submissions) vẫn có
--     updated_at để tuân Rule 4.1, nhưng giá trị luôn bằng created_at vì
--     không bao giờ UPDATE. Xem docs/database/README.md §"Bảng append-only".
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Bảng thiếu khóa chính dạng `id` (Rule 4.1 yêu cầu cột tên `id`)
-- ---------------------------------------------------------------------------

-- user_roles: baseline dùng composite PK (user_id, role). Giữ nguyên ràng buộc
-- duy nhất đó dưới dạng UNIQUE và thêm surrogate id để đồng nhất với Rule 4.1.
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT uuid_generate_v4();
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_pkey;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
ALTER TABLE user_roles ADD CONSTRAINT uq_user_roles_user_role UNIQUE (user_id, role);

-- emergency_profiles: baseline dùng user_id làm PK (quan hệ 1-1 với users).
-- Giữ 1-1 bằng UNIQUE(user_id), thêm id surrogate.
ALTER TABLE emergency_profiles ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT uuid_generate_v4();
ALTER TABLE emergency_profiles DROP CONSTRAINT IF EXISTS emergency_profiles_pkey;
ALTER TABLE emergency_profiles ADD CONSTRAINT emergency_profiles_pkey PRIMARY KEY (id);
ALTER TABLE emergency_profiles ADD CONSTRAINT uq_emergency_profiles_user UNIQUE (user_id);

-- idempotency_keys: baseline dùng `key` làm PK. `key` vẫn là lookup key nghiệp vụ.
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT uuid_generate_v4();
ALTER TABLE idempotency_keys DROP CONSTRAINT IF EXISTS idempotency_keys_pkey;
ALTER TABLE idempotency_keys ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (id);
ALTER TABLE idempotency_keys ADD CONSTRAINT uq_idempotency_keys_key UNIQUE (key);

-- ---------------------------------------------------------------------------
-- 2. created_at / updated_at cho các bảng còn thiếu
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  -- Bảng chưa có created_at trong baseline 0001.
  tables_missing_created_at text[] := ARRAY[
    'user_roles', 'emergency_profiles', 'service_areas', 'local_resources',
    'ambulance_units', 'responders', 'case_locations', 'case_status_history',
    'dispatch_assignments', 'guidance_catalog', 'consent_records'
  ];
BEGIN
  FOREACH t IN ARRAY tables_missing_created_at LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()', t);
  END LOOP;
END $$;

-- Giữ đúng ngữ nghĩa thời điểm gốc cho các bảng đã có cột thời gian riêng:
-- không tạo ra một mốc thời gian thứ hai mâu thuẫn với mốc nghiệp vụ.
UPDATE case_locations        SET created_at = received_at WHERE created_at <> received_at;
UPDATE case_status_history   SET created_at = changed_at  WHERE created_at <> changed_at;
UPDATE dispatch_assignments  SET created_at = assigned_at WHERE created_at <> assigned_at;
UPDATE consent_records       SET created_at = recorded_at WHERE created_at <> recorded_at;

DO $$
DECLARE
  t text;
  -- Mọi bảng nghiệp vụ đều cần updated_at (Rule 4.1).
  all_tables text[] := ARRAY[
    'users', 'user_roles', 'devices', 'emergency_profiles', 'emergency_contacts',
    'service_areas', 'medical_facilities', 'local_resources', 'ambulance_units',
    'responders', 'emergency_cases', 'case_locations', 'triage_submissions',
    'case_status_history', 'video_sessions', 'media_assets', 'dispatch_assignments',
    'guidance_catalog', 'guidance_events', 'case_notes', 'handovers',
    'notification_deliveries', 'consent_records', 'audit_logs',
    'idempotency_keys', 'outbox_events'
  ];
BEGIN
  FOREACH t IN ARRAY all_tables LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()', t);
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL', t);
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Trigger duy trì updated_at
--
-- updated_at do DB quản lý, không tin vào client: một client bị lỗi đồng hồ hoặc
-- một code path quên set sẽ làm hỏng thứ tự sự kiện trong hồ sơ bàn giao.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sos_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t text;
  -- Bảng append-only KHÔNG gắn trigger: chúng không bao giờ được UPDATE.
  mutable_tables text[] := ARRAY[
    'users', 'user_roles', 'devices', 'emergency_profiles', 'emergency_contacts',
    'service_areas', 'medical_facilities', 'local_resources', 'ambulance_units',
    'responders', 'emergency_cases', 'video_sessions', 'media_assets',
    'dispatch_assignments', 'guidance_catalog', 'case_notes', 'handovers',
    'notification_deliveries', 'idempotency_keys', 'outbox_events'
  ];
BEGIN
  FOREACH t IN ARRAY mutable_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION sos_set_updated_at()', t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Bảo vệ bảng append-only
--
-- Hồ sơ bàn giao (Rule 4.2 / FR-013) chỉ đáng tin nếu timeline không sửa được.
-- Chặn UPDATE/DELETE ở tầng DB, không chỉ ở tầng application.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sos_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Bang % la append-only: khong duoc % ban ghi', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t text;
  append_only_tables text[] := ARRAY[
    'case_locations', 'case_status_history', 'guidance_events',
    'triage_submissions', 'consent_records', 'audit_logs'
  ];
BEGIN
  FOREACH t IN ARRAY append_only_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_append_only ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_append_only BEFORE UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION sos_reject_mutation()', t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Bất biến của handover đã finalize (FR-013, TC-018, TC-019)
--
-- Handover là bảng mutable khi còn DRAFT, nhưng một version đã finalize thì
-- payload phải đóng băng. Sửa nội dung = tạo version mới.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sos_protect_finalized_handover() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'FINALIZED' THEN
    RAISE EXCEPTION 'Handover % version % da finalize: tao version moi thay vi sua',
      OLD.case_id, OLD.version USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_handovers_immutable_after_finalize ON handovers;
CREATE TRIGGER trg_handovers_immutable_after_finalize
  BEFORE UPDATE OR DELETE ON handovers
  FOR EACH ROW EXECUTE FUNCTION sos_protect_finalized_handover();

-- ---------------------------------------------------------------------------
-- 6. Ràng buộc chống hai operator cùng giữ một ca (FR-005, TC-007)
--
-- Accept phải atomic. Điều kiện thắng cuộc được cưỡng chế bằng câu UPDATE
-- có WHERE active_operator_id IS NULL, cộng index dưới đây cho hàng đợi.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_cases_queue
  ON emergency_cases (service_area_id, created_at)
  WHERE status = 'QUEUED';

-- Idempotency: tra cứu theo key phải nhanh và hết hạn phải dọn được (TC-002).
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys (expires_at);

COMMIT;
