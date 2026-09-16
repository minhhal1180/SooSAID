import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import {
  GuidanceApprovalStatus,
  UserRole,
} from '../../contracts/generated/api-contract';
import {
  APP_CONFIG,
  PersistenceDriver,
  type AppConfig,
} from '../../common/config/app-config';
import { SafeLogger } from '../../common/logging/safe-logger';
import { MemoryDb } from './memory-db';

/**
 * Nạp dữ liệu mô phỏng cho driver `memory` khi khởi động.
 *
 * Tương đương `db/seeds/0001_dev_seed.sql` của driver `postgres`; hai nguồn phải
 * khớp nhau về ý nghĩa để một luồng demo chạy giống nhau trên cả hai driver.
 *
 * Rule 14 (DON'T – "Không fake dữ liệu y tế thật"): mọi bản ghi ở đây là ĐỐI
 * TƯỢNG MÔ PHỎNG, và nội dung hướng dẫn ở trạng thái `DRAFT` (drill-only) nên
 * backend chỉ gửi được khi `GUIDANCE_ALLOW_DRILL_CONTENT=true`.
 *
 * Không chạy khi driver là `postgres`: ở đó dữ liệu do file SQL quản lý.
 */

/** Id cố định để tài liệu/Postman/kịch bản demo tham chiếu được. */
export const SEED_IDS = {
  citizen: '11111111-1111-4111-8111-111111111111',
  operator: '22222222-2222-4222-8222-222222222222',
  clinician: '33333333-3333-4333-8333-333333333333',
  crew: '44444444-4444-4444-8444-444444444444',
  responder: '55555555-5555-4555-8555-555555555555',
  admin: '66666666-6666-4666-8666-666666666666',
  serviceArea: 'aaaaaaaa-0000-4000-8000-000000000001',
  ambulanceUnit: 'bbbbbbbb-0000-4000-8000-000000000001',
  responderProfile: 'cccccccc-0000-4000-8000-000000000001',
} as const;

/** Số điện thoại mô phỏng để đăng nhập OTP trong demo. */
export const SEED_PHONES = {
  citizen: '+84900000001',
  operator: '+84900000002',
  clinician: '+84900000003',
  crew: '+84900000004',
  responder: '+84900000005',
  admin: '+84900000006',
} as const;

function auditColumns() {
  const now = new Date();
  return { created_at: now, updated_at: now, created_by: null, updated_by: null };
}

@Injectable()
export class MemorySeeder implements OnApplicationBootstrap {
  private readonly logger = new SafeLogger().setContext('persistence');

  constructor(
    private readonly db: MemoryDb,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.persistence.driver !== PersistenceDriver.MEMORY) return;
    this.seed();
  }

  /** Public để test dựng lại dữ liệu mẫu sau khi reset. */
  seed(): void {
    this.seedUsers();
    this.seedServiceArea();
    this.seedFacilitiesAndResources();
    this.seedResponseUnits();
    this.seedGuidance();

    this.logger.log('memory_seed_loaded', {
      driver: 'memory',
      count: this.db.users.size,
    });
  }

  private seedUsers(): void {
    const users: Array<[string, string, UserRole, string]> = [
      [SEED_IDS.citizen, SEED_PHONES.citizen, UserRole.CITIZEN, 'Nguoi dan mo phong'],
      [SEED_IDS.operator, SEED_PHONES.operator, UserRole.OPERATOR_115, 'Tong dai vien mo phong'],
      [SEED_IDS.clinician, SEED_PHONES.clinician, UserRole.CLINICIAN, 'Bac si truc mo phong'],
      [SEED_IDS.crew, SEED_PHONES.crew, UserRole.AMBULANCE_CREW, 'Kip xe mo phong'],
      [SEED_IDS.responder, SEED_PHONES.responder, UserRole.LOCAL_RESPONDER, 'Nguoi ho tro tai cho'],
      [SEED_IDS.admin, SEED_PHONES.admin, UserRole.ADMIN, 'Quan tri mo phong'],
    ];

    for (const [id, phone, role, fullName] of users) {
      if (this.db.users.findById(id)) continue;

      this.db.users.insert({
        id,
        phone,
        email: null,
        full_name: fullName,
        status: 'ACTIVE',
        locale: 'vi-VN',
        ...auditColumns(),
      });

      this.db.userRoles.insert({
        id: randomUUID(),
        user_id: id,
        role,
        // NULL = phạm vi toàn hệ thống. Tổng đài mô phỏng xử lý mọi service area
        // để kịch bản demo không phụ thuộc cấu hình vùng.
        organization_id: null,
        ...auditColumns(),
      });
    }
  }

  private seedServiceArea(): void {
    if (this.db.serviceAreas.findById(SEED_IDS.serviceArea)) return;

    this.db.serviceAreas.insert({
      id: SEED_IDS.serviceArea,
      code: 'PILOT-SCHOOL',
      name: 'Khu vuc truong hoc mo phong',
      // Driver memory khớp service area bằng HỘP BAO, không phải polygon thật
      // (ADR-004). Hộp này tương ứng polygon trong db/seeds/0001_dev_seed.sql.
      bbox: { minLat: 21.015, minLng: 105.835, maxLat: 21.028, maxLng: 105.848 },
      active: true,
      routing_priority: 10,
      ...auditColumns(),
    });
  }

  private seedFacilitiesAndResources(): void {
    if (this.db.medicalFacilities.size > 0) return;

    this.db.medicalFacilities.insert({
      id: randomUUID(),
      code: 'FAC-PILOT-01',
      name: 'Co so y te mo phong 01',
      facility_type: 'pilot_facility',
      phone: '0000000000',
      address: 'Dia chi mo phong 01',
      location: { lat: 21.02, lng: 105.84 },
      capabilities: { pilot: true, emergency: true },
      service_area_id: SEED_IDS.serviceArea,
      active: true,
      ...auditColumns(),
    });

    this.db.medicalFacilities.insert({
      id: randomUUID(),
      code: 'FAC-PILOT-02',
      name: 'Co so y te mo phong 02',
      facility_type: 'pilot_facility',
      phone: '0000000000',
      address: 'Dia chi mo phong 02',
      location: { lat: 21.025, lng: 105.846 },
      capabilities: { pilot: true, trauma: true },
      service_area_id: SEED_IDS.serviceArea,
      active: true,
      ...auditColumns(),
    });

    const resources: Array<[string, string, number, number, string, string]> = [
      ['FIRST_AID_ROOM', 'Phong y te tang 1', 21.021, 105.841, 'Nha A, tang 1', 'Di qua cong chinh, re phai 30m'],
      ['AED', 'AED sanh nha the chat', 21.0218, 105.8425, 'Nha the chat', 'Tu AED gan cua vao ben trai'],
      ['ACCESS_GATE', 'Cong phu cho xe cuu thuong', 21.0225, 105.8398, 'Mat sau khuon vien', 'Bao bao ve mo barrier, xe vao duoc'],
    ];

    for (const [type, name, lat, lng, address, instruction] of resources) {
      this.db.localResources.insert({
        id: randomUUID(),
        resource_type: type,
        name,
        location: { lat, lng },
        address,
        access_instruction: instruction,
        organization_id: null,
        metadata: { pilot: true },
        active: true,
        ...auditColumns(),
      });
    }
  }

  private seedResponseUnits(): void {
    if (this.db.ambulanceUnits.findById(SEED_IDS.ambulanceUnit)) return;

    this.db.ambulanceUnits.insert({
      id: SEED_IDS.ambulanceUnit,
      code: 'AMB-PILOT-01',
      display_name: 'Xe cuu thuong mo phong 01',
      status: 'AVAILABLE',
      current_location: { lat: 21.0195, lng: 105.839 },
      service_area_id: SEED_IDS.serviceArea,
      last_location_at: new Date(),
      capabilities: { pilot: true, als: false },
      ...auditColumns(),
    });

    // Thành viên kíp xe (migration 0003) – điều kiện để kíp xe xem được ca.
    this.db.ambulanceUnitMembers.insert({
      id: randomUUID(),
      ambulance_unit_id: SEED_IDS.ambulanceUnit,
      user_id: SEED_IDS.crew,
      crew_role: 'crew_lead',
      active_from: new Date(),
      active_to: null,
      ...auditColumns(),
    });

    this.db.responders.insert({
      id: SEED_IDS.responderProfile,
      user_id: SEED_IDS.responder,
      organization_id: null,
      certification_status: 'VERIFIED',
      available: true,
      current_location: { lat: 21.0212, lng: 105.8415 },
      last_location_at: new Date(),
      skills: ['basic_first_aid', 'cpr_awareness'],
      ...auditColumns(),
    });
  }

  private seedGuidance(): void {
    if (this.db.guidanceCatalog.size > 0) return;

    const disclaimer = 'Noi dung drill, chua duoc chuyen gia y te phe duyet.';

    const entries: Array<[string, string, string, string[]]> = [
      [
        'GUIDE-CALL-115',
        'Goi ho tro y te khan cap',
        'Buoc dau tien trong moi tinh huong khan cap',
        [
          'Goi 115 hoac so cap cuu dia phuong ngay.',
          'Noi ro dia chi, mo ta ngan tinh trang nguoi gap nan.',
          'Giu may, khong tat cuoc goi khi chua duoc huong dan.',
        ],
      ],
      [
        'GUIDE-SCENE-SAFETY',
        'Bao dam an toan hien truong',
        'Khong tro thanh nan nhan thu hai',
        [
          'Quan sat nguy co: giao thong, dien, nuoc, khoi, vat roi.',
          'Chi tiep can khi hien truong an toan.',
          'Nho nguoi xung quanh ho tro canh gioi va goi 115.',
        ],
      ],
      [
        'GUIDE-OBSERVE',
        'Ghi nhan dau hieu quan sat duoc',
        'Thong tin giup nhan vien y te danh gia tu xa',
        [
          'Nguoi gap nan co phan ung khi goi ten khong?',
          'Long nguc co di dong deu khong?',
          'Co chay mau thay ro o vi tri nao khong?',
          'Doc lai cac quan sat nay cho nhan vien truc.',
        ],
      ],
      [
        'GUIDE-WAIT-SUPPORT',
        'Giu lien lac trong khi cho ho tro',
        'Duy tri ket noi va cap nhat dien bien',
        [
          'Giu camera huong ve nguoi gap nan neu duoc yeu cau.',
          'Bao ngay khi tinh trang thay doi.',
          'Cu nguoi ra don xe cuu thuong tai cong.',
        ],
      ],
    ];

    for (const [code, title, summary, steps] of entries) {
      this.db.guidanceCatalog.insert({
        id: randomUUID(),
        code,
        version: 1,
        title,
        content: {
          drillOnly: true,
          summary,
          steps: steps.map((text, index) => ({ order: index + 1, text })),
          disclaimer,
        },
        // DRAFT: chưa được chuyên gia y tế duyệt (Open Decision).
        approval_status: GuidanceApprovalStatus.DRAFT,
        approved_by: null,
        approved_at: null,
        effective_from: null,
        retired_at: null,
        ...auditColumns(),
      });
    }
  }
}

@Module({
  providers: [MemorySeeder],
  exports: [MemorySeeder],
})
export class MemorySeederModule {}
