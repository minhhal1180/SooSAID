import { Inject, Injectable } from '@nestjs/common';
import type { UserRole } from '../../../contracts/generated/api-contract';
import { DomainErrors } from '../../../common/errors/domain-error';
import { maskPhone } from '../../../common/logging/safe-logger';
import type { EmergencyProfileRow, UserRow } from '../../../persistence/rows';
import { UNIT_OF_WORK, type TxContext, type UnitOfWork } from '../../../persistence/unit-of-work';
import { AuditAction, AuditResourceType } from '../../audit-log/entity/audit-action';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import type {
  EmergencyProfileSnapshot,
  EmergencyProfileSnapshotPort,
} from '../../emergency-case/service/case-collaboration.ports';
import { USERS_REPOSITORY, type UsersRepositoryPort } from '../repository/users.repository.port';

/**
 * Hồ sơ người dùng, hồ sơ sức khỏe khẩn cấp và danh bạ liên hệ.
 *
 * `UsersService` đồng thời là cài đặt của `EmergencyProfileSnapshotPort` để
 * module `emergency-case` lấy ảnh chụp hồ sơ mà không đụng vào bảng của module
 * này (Rule 2.2).
 */

/** Ưu tiên mặc định của một liên hệ mới (1 = gọi trước nhất). */
const DEFAULT_CONTACT_PRIORITY = 1;

export interface EmergencyProfileView {
  bloodType: string | null;
  allergies: string[];
  chronicConditions: string[];
  medications: string[];
  preferredFacility: string | null;
  specialNote: string | null;
  consentShareInEmergency: boolean;
  version: number;
  updatedAt: string;
}

@Injectable()
export class UsersService implements EmergencyProfileSnapshotPort {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(USERS_REPOSITORY) private readonly repository: UsersRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  // --- Định danh -----------------------------------------------------------

  async findById(userId: string): Promise<UserRow | null> {
    return this.repository.findById(userId);
  }

  async findByPhone(phone: string): Promise<UserRow | null> {
    return this.repository.findByPhone(phone);
  }

  async createCitizen(tx: TxContext, phone: string): Promise<UserRow> {
    return this.repository.createCitizen(tx, phone);
  }

  async listRoles(userId: string): Promise<UserRole[]> {
    return this.repository.listRoles(userId);
  }

  async listServiceAreaIds(userId: string): Promise<string[]> {
    return this.repository.listServiceAreaIds(userId);
  }

  async getMe(userId: string) {
    const user = await this.repository.findById(userId);
    if (!user) throw DomainErrors.notFound('người dùng', { userId });

    const roles = await this.repository.listRoles(userId);
    return {
      id: user.id,
      // Số điện thoại chỉ trả về dạng che, kể cả cho chính chủ: màn hình có thể
      // bị người khác nhìn thấy trong tình huống khẩn cấp (Rule 11).
      phoneMasked: user.phone ? maskPhone(user.phone) : null,
      email: user.email,
      fullName: user.full_name,
      locale: user.locale,
      status: user.status,
      roles,
    };
  }

  async updateMe(userId: string, patch: { fullName?: string; locale?: string }) {
    await this.unitOfWork.runInTransaction((tx) =>
      this.repository.updateProfile(tx, userId, patch),
    );
    return this.getMe(userId);
  }

  // --- Hồ sơ sức khỏe khẩn cấp (dữ liệu nhạy cảm – Rule 5.1) ---------------

  /** Chủ dữ liệu xem hồ sơ của chính mình. Vẫn ghi audit (TC-024). */
  async getOwnEmergencyProfile(userId: string): Promise<EmergencyProfileView | null> {
    const row = await this.repository.getEmergencyProfile(userId);

    await this.auditLog.record({
      action: AuditAction.HEALTH_PROFILE_VIEWED,
      resourceType: AuditResourceType.EMERGENCY_PROFILE,
      resourceId: userId,
      metadata: { self: true },
    });

    return row ? toEmergencyProfileView(row) : null;
  }

  async replaceEmergencyProfile(
    userId: string,
    input: Omit<EmergencyProfileView, 'version' | 'updatedAt'>,
  ): Promise<EmergencyProfileView> {
    const row = await this.unitOfWork.runInTransaction((tx) =>
      this.repository.upsertEmergencyProfile(tx, {
        userId,
        bloodType: input.bloodType,
        allergies: input.allergies,
        chronicConditions: input.chronicConditions,
        medications: input.medications,
        preferredFacility: input.preferredFacility,
        specialNote: input.specialNote,
        consentShareInEmergency: input.consentShareInEmergency,
      }),
    );

    await this.auditLog.record({
      action: AuditAction.HEALTH_PROFILE_UPDATED,
      resourceType: AuditResourceType.EMERGENCY_PROFILE,
      resourceId: userId,
      // Ghi VERSION và trạng thái consent, KHÔNG ghi nội dung y tế (Rule 11).
      metadata: { version: row.version, consent: row.consent_share_in_emergency },
    });

    return toEmergencyProfileView(row);
  }

  /**
   * Cài đặt `EmergencyProfileSnapshotPort`.
   *
   * Trả `null` khi người dùng CHƯA đồng ý chia sẻ trong tình huống khẩn cấp —
   * đây là chốt chặn của TC-015, đặt ở nguồn dữ liệu chứ không ở nơi hiển thị.
   */
  async snapshotForCase(userId: string): Promise<EmergencyProfileSnapshot | null> {
    const row = await this.repository.getEmergencyProfile(userId);
    if (!row || !row.consent_share_in_emergency) return null;

    return {
      profileVersion: row.version,
      bloodType: row.blood_type,
      allergies: row.allergies,
      chronicConditions: row.chronic_conditions,
      medications: row.medications,
      specialNote: row.special_note,
    };
  }

  // --- Người liên hệ khẩn cấp ---------------------------------------------

  async listEmergencyContacts(userId: string) {
    const rows = await this.repository.listEmergencyContacts(userId);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      phoneMasked: maskPhone(row.phone),
      relation: row.relation,
      priority: row.priority,
      notifyByPush: row.notify_by_push,
      notifyBySms: row.notify_by_sms,
    }));
  }

  /** Danh sách đầy đủ kèm số điện thoại thật – CHỈ dùng nội bộ khi gửi thông báo. */
  async listContactsForNotification(userId: string) {
    return this.repository.listEmergencyContacts(userId);
  }

  async addEmergencyContact(
    userId: string,
    input: {
      name: string;
      phone: string;
      relation?: string;
      priority?: number;
      notifyByPush?: boolean;
      notifyBySms?: boolean;
    },
  ) {
    const row = await this.unitOfWork.runInTransaction((tx) =>
      this.repository.addEmergencyContact(tx, {
        userId,
        name: input.name,
        phone: input.phone,
        relation: input.relation ?? null,
        priority: input.priority ?? DEFAULT_CONTACT_PRIORITY,
        notifyByPush: input.notifyByPush ?? true,
        notifyBySms: input.notifyBySms ?? true,
      }),
    );

    return { id: row.id, name: row.name, phoneMasked: maskPhone(row.phone) };
  }

  async deleteEmergencyContact(userId: string, contactId: string): Promise<void> {
    const deleted = await this.unitOfWork.runInTransaction((tx) =>
      this.repository.deleteEmergencyContact(tx, userId, contactId),
    );
    if (!deleted) throw DomainErrors.notFound('người liên hệ khẩn cấp', { userId });
  }

  // --- Thiết bị ------------------------------------------------------------

  async registerDevice(
    userId: string,
    input: {
      deviceId: string;
      platform: 'ios' | 'android' | 'web';
      pushToken?: string;
      appVersion?: string;
    },
  ) {
    const row = await this.unitOfWork.runInTransaction((tx) =>
      this.repository.registerDevice(tx, {
        deviceId: input.deviceId,
        userId,
        platform: input.platform,
        pushToken: input.pushToken ?? null,
        appVersion: input.appVersion ?? null,
      }),
    );
    return { id: row.id, platform: row.platform, appVersion: row.app_version };
  }
}

function toEmergencyProfileView(row: EmergencyProfileRow): EmergencyProfileView {
  return {
    bloodType: row.blood_type,
    allergies: row.allergies,
    chronicConditions: row.chronic_conditions,
    medications: row.medications,
    preferredFacility: row.preferred_facility,
    specialNote: row.special_note,
    consentShareInEmergency: row.consent_share_in_emergency,
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
  };
}
