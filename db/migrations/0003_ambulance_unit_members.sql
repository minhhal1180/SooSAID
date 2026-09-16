-- ============================================================================
-- Migration 0003 – Bảng `ambulance_unit_members`
--
-- LÝ DO (khoảng trống trong schema gốc của Developer Kit):
--   `CaseAccessPolicy` cho phép vai trò AMBULANCE_CREW xem một ca CHỈ KHI họ
--   được phân công cho ca đó (TDD §4.1: "Khi assigned"). Nhưng schema baseline
--   liên kết assignment tới `ambulance_units`, không tới người dùng — không có
--   cách nào trả lời "user X có thuộc kíp xe Y không".
--
--   Nếu không có bảng này thì chỉ còn hai lựa chọn, đều sai:
--     (a) cho MỌI tài khoản AMBULANCE_CREW xem MỌI ca đã điều phối — vi phạm
--         nguyên tắc least privilege và threat "Unauthorized medical data access";
--     (b) không cho kíp xe nào xem ca nào — hỏng nghiệp vụ SOS-025.
--
--   Đây là thay đổi schema có chủ đích, đã ghi lại theo Rule 14 ("tạo migration
--   khi đổi DB") và Rule 13 (cập nhật docs/database).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS ambulance_unit_members (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ambulance_unit_id uuid NOT NULL REFERENCES ambulance_units(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Vai trò trong kíp (lái xe, điều dưỡng, bác sĩ...). Là dữ liệu vận hành,
  -- KHÔNG dùng để phân quyền — phân quyền vẫn theo `user_roles`.
  crew_role varchar(64),
  -- Ca trực đang hiệu lực. NULL ở `active_to` nghĩa là còn hiệu lực.
  active_from timestamptz NOT NULL DEFAULT now(),
  active_to timestamptz,

  -- Rule 4.1
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);

-- Một người không thuộc cùng một kíp hai lần trong cùng khoảng thời gian.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ambulance_unit_member_active
  ON ambulance_unit_members (ambulance_unit_id, user_id)
  WHERE active_to IS NULL;

-- Truy vấn nóng: "user này đang thuộc những kíp nào" – chạy trên mọi lần kiểm
-- tra quyền truy cập ca của kíp xe.
CREATE INDEX IF NOT EXISTS idx_ambulance_unit_members_user
  ON ambulance_unit_members (user_id)
  WHERE active_to IS NULL;

DROP TRIGGER IF EXISTS trg_ambulance_unit_members_updated_at ON ambulance_unit_members;
CREATE TRIGGER trg_ambulance_unit_members_updated_at
  BEFORE UPDATE ON ambulance_unit_members
  FOR EACH ROW EXECUTE FUNCTION sos_set_updated_at();

COMMIT;
