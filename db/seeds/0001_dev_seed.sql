-- ============================================================================
-- Development / drill seed – KHÔNG dùng cho Pilot có dữ liệu thật.
--
-- Rule 14 (DON'T): "Không fake dữ liệu y tế thật".
--   * Tất cả cơ sở y tế, kíp xe, người hỗ trợ ở đây là ĐỐI TƯỢNG MÔ PHỎNG.
--   * Nội dung hướng dẫn sơ cấp cứu được nạp ở trạng thái approval_status='DRAFT'
--     và gắn cờ content->>'drillOnly' = true. Backend TỪ CHỐI gửi nội dung DRAFT
--     tới ca thật; chỉ gửi được khi GUIDANCE_ALLOW_DRILL_CONTENT=true (dev/drill).
--     Việc duyệt nội dung là của chuyên gia y tế (Open Decision, xem
--     docs/decision-log/README.md).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Tài khoản mô phỏng cho từng vai trò (mật khẩu/OTP xử lý ở tầng auth, không lưu ở đây)
-- ---------------------------------------------------------------------------
INSERT INTO users (id, phone, email, full_name, status, locale) VALUES
  ('11111111-1111-4111-8111-111111111111', '+84900000001', NULL,                      'Nguoi dan mo phong',   'ACTIVE', 'vi-VN'),
  ('22222222-2222-4222-8222-222222222222', '+84900000002', 'operator@pilot.local',    'Tong dai vien mo phong','ACTIVE', 'vi-VN'),
  ('33333333-3333-4333-8333-333333333333', '+84900000003', 'clinician@pilot.local',   'Bac si truc mo phong',  'ACTIVE', 'vi-VN'),
  ('44444444-4444-4444-8444-444444444444', '+84900000004', 'crew@pilot.local',        'Kip xe mo phong',       'ACTIVE', 'vi-VN'),
  ('55555555-5555-4555-8555-555555555555', '+84900000005', 'responder@pilot.local',   'Nguoi ho tro tai cho',  'ACTIVE', 'vi-VN'),
  ('66666666-6666-4666-8666-666666666666', '+84900000006', 'admin@pilot.local',       'Quan tri mo phong',     'ACTIVE', 'vi-VN')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_roles (user_id, role) VALUES
  ('11111111-1111-4111-8111-111111111111', 'CITIZEN'),
  ('22222222-2222-4222-8222-222222222222', 'OPERATOR_115'),
  ('33333333-3333-4333-8333-333333333333', 'CLINICIAN'),
  ('44444444-4444-4444-8444-444444444444', 'AMBULANCE_CREW'),
  ('55555555-5555-4555-8555-555555555555', 'LOCAL_RESPONDER'),
  ('66666666-6666-4666-8666-666666666666', 'ADMIN')
ON CONFLICT ON CONSTRAINT uq_user_roles_user_role DO NOTHING;

-- ---------------------------------------------------------------------------
-- Service area mô phỏng: khuôn viên trường (kịch bản UAT SOS-070)
-- ---------------------------------------------------------------------------
INSERT INTO service_areas (id, code, name, geom, routing_priority) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'PILOT-SCHOOL', 'Khu vuc truong hoc mo phong',
   ST_Multi(ST_GeomFromText(
     'POLYGON((105.835 21.015, 105.848 21.015, 105.848 21.028, 105.835 21.028, 105.835 21.015))', 4326)),
   10)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Cơ sở y tế mô phỏng (TC-020)
-- ---------------------------------------------------------------------------
INSERT INTO medical_facilities (code, name, facility_type, phone, address, location, capabilities, service_area_id) VALUES
  ('FAC-PILOT-01', 'Co so y te mo phong 01', 'pilot_facility', '0000000000', 'Dia chi mo phong 01',
   ST_SetSRID(ST_MakePoint(105.840, 21.020), 4326)::geography,
   '{"pilot":true,"emergency":true}', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('FAC-PILOT-02', 'Co so y te mo phong 02', 'pilot_facility', '0000000000', 'Dia chi mo phong 02',
   ST_SetSRID(ST_MakePoint(105.846, 21.025), 4326)::geography,
   '{"pilot":true,"trauma":true}', 'aaaaaaaa-0000-4000-8000-000000000001')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Điểm hỗ trợ tại chỗ (TC-021) – phòng y tế, AED, cổng tiếp cận
-- ---------------------------------------------------------------------------
INSERT INTO local_resources (resource_type, name, location, address, access_instruction, metadata) VALUES
  ('FIRST_AID_ROOM', 'Phong y te tang 1',
   ST_SetSRID(ST_MakePoint(105.8410, 21.0210), 4326)::geography,
   'Nha A, tang 1', 'Di qua cong chinh, re phai 30m', '{"pilot":true}'),
  ('AED', 'AED sanh nha the chat',
   ST_SetSRID(ST_MakePoint(105.8425, 21.0218), 4326)::geography,
   'Nha the chat', 'Tu AED gan cua vao ben trai', '{"pilot":true}'),
  ('ACCESS_GATE', 'Cong phu cho xe cuu thuong',
   ST_SetSRID(ST_MakePoint(105.8398, 21.0225), 4326)::geography,
   'Mat sau khuon vien', 'Bao bao ve mo barrier, xe vao duoc', '{"pilot":true,"vehicleAccess":true}')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Kíp xe và người hỗ trợ mô phỏng (SOS-024, SOS-026)
-- ---------------------------------------------------------------------------
INSERT INTO ambulance_units (code, display_name, status, current_location, service_area_id, capabilities) VALUES
  ('AMB-PILOT-01', 'Xe cuu thuong mo phong 01', 'AVAILABLE',
   ST_SetSRID(ST_MakePoint(105.8390, 21.0195), 4326)::geography,
   'aaaaaaaa-0000-4000-8000-000000000001', '{"pilot":true,"als":false}')
ON CONFLICT (code) DO NOTHING;

INSERT INTO responders (user_id, certification_status, available, current_location, skills) VALUES
  ('55555555-5555-4555-8555-555555555555', 'VERIFIED', true,
   ST_SetSRID(ST_MakePoint(105.8415, 21.0212), 4326)::geography,
   '["basic_first_aid","cpr_awareness"]')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Guidance catalog – DRAFT, drill-only
--
-- Đây là KHUNG NỘI DUNG để kiểm thử luồng gửi/ghi nhận hướng dẫn, KHÔNG phải
-- phác đồ y khoa. Mỗi mục nêu thao tác quan sát/hỗ trợ cơ bản và luôn nhắc gọi
-- 115. Chuyên gia y tế phải soạn lại và chuyển sang APPROVED trước Pilot thật.
-- ---------------------------------------------------------------------------
INSERT INTO guidance_catalog (code, version, title, content, approval_status, effective_from) VALUES
  ('GUIDE-CALL-115', 1, 'Goi ho tro y te khan cap',
   '{"drillOnly":true,
     "summary":"Buoc dau tien trong moi tinh huong khan cap",
     "steps":[
       {"order":1,"text":"Goi 115 hoac so cap cuu dia phuong ngay."},
       {"order":2,"text":"Noi ro dia chi, mo ta ngan tinh trang nguoi gap nan."},
       {"order":3,"text":"Giu may, khong tat cuoc goi khi chua duoc huong dan."}],
     "disclaimer":"Noi dung drill, chua duoc chuyen gia y te phe duyet."}',
   'DRAFT', NULL),
  ('GUIDE-SCENE-SAFETY', 1, 'Bao dam an toan hien truong',
   '{"drillOnly":true,
     "summary":"Khong tro thanh nan nhan thu hai",
     "steps":[
       {"order":1,"text":"Quan sat nguy co: giao thong, dien, nuoc, khoi, vat roi."},
       {"order":2,"text":"Chi tiep can khi hien truong an toan."},
       {"order":3,"text":"Nho nguoi xung quanh ho tro canh gioi va goi 115."}],
     "disclaimer":"Noi dung drill, chua duoc chuyen gia y te phe duyet."}',
   'DRAFT', NULL),
  ('GUIDE-OBSERVE', 1, 'Ghi nhan dau hieu quan sat duoc',
   '{"drillOnly":true,
     "summary":"Thong tin giup nhan vien y te danh gia tu xa",
     "steps":[
       {"order":1,"text":"Nguoi gap nan co phan ung khi goi ten khong?"},
       {"order":2,"text":"Long nguc co di dong deu khong?"},
       {"order":3,"text":"Co chay mau thay ro o vi tri nao khong?"},
       {"order":4,"text":"Doc lai cac quan sat nay cho nhan vien truc."}],
     "disclaimer":"Chi ghi nhan quan sat, KHONG chan doan benh."}',
   'DRAFT', NULL),
  ('GUIDE-WAIT-SUPPORT', 1, 'Giu lien lac trong khi cho ho tro',
   '{"drillOnly":true,
     "summary":"Duy tri ket noi va cap nhat dien bien",
     "steps":[
       {"order":1,"text":"Giu camera huong ve nguoi gap nan neu duoc yeu cau."},
       {"order":2,"text":"Bao ngay khi tinh trang thay doi."},
       {"order":3,"text":"Cu nguoi ra don xe cuu thuong tai cong."}],
     "disclaimer":"Noi dung drill, chua duoc chuyen gia y te phe duyet."}',
   'DRAFT', NULL)
ON CONFLICT (code, version) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- Thành viên kíp xe (migration 0003) – để kíp xe mô phỏng thấy được ca đã điều phối
-- ---------------------------------------------------------------------------
BEGIN;
INSERT INTO ambulance_unit_members (ambulance_unit_id, user_id, crew_role)
SELECT a.id, '44444444-4444-4444-8444-444444444444', 'crew_lead'
  FROM ambulance_units a
 WHERE a.code = 'AMB-PILOT-01'
ON CONFLICT DO NOTHING;
COMMIT;
