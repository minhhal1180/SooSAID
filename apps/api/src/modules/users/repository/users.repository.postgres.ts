import { UserRole } from '../../../contracts/generated/api-contract';
import type { PgExecutor } from '../../../persistence/postgres/pg-executor';
import type {
  DeviceRow,
  EmergencyContactRow,
  EmergencyProfileRow,
  UserRow,
} from '../../../persistence/rows';
import type { TxContext } from '../../../persistence/unit-of-work';
import type {
  UpsertEmergencyProfileInput,
  UsersRepositoryPort,
} from './users.repository.port';

export class PgUsersRepository implements UsersRepositoryPort {
  constructor(private readonly executor: PgExecutor) {}

  async findById(userId: string): Promise<UserRow | null> {
    return this.executor.queryOne<UserRow>(undefined, `SELECT * FROM users WHERE id = $1`, [
      userId,
    ]);
  }

  async findByPhone(phone: string): Promise<UserRow | null> {
    return this.executor.queryOne<UserRow>(undefined, `SELECT * FROM users WHERE phone = $1`, [
      phone,
    ]);
  }

  async createCitizen(tx: TxContext, phone: string): Promise<UserRow> {
    const rows = await this.executor.query<UserRow>(
      tx,
      `WITH new_user AS (
         INSERT INTO users (phone) VALUES ($1) RETURNING *
       ), assigned_role AS (
         INSERT INTO user_roles (user_id, role, created_by)
         SELECT id, $2::user_role, id FROM new_user
       )
       SELECT * FROM new_user`,
      [phone, UserRole.CITIZEN],
    );
    return rows[0];
  }

  async listRoles(userId: string): Promise<UserRole[]> {
    const rows = await this.executor.query<{ role: UserRole }>(
      undefined,
      `SELECT role FROM user_roles WHERE user_id = $1`,
      [userId],
    );
    return rows.map((row) => row.role);
  }

  async listServiceAreaIds(userId: string): Promise<string[]> {
    // `organization_id` trong `user_roles` trỏ tới service area mà người dùng
    // phục vụ. NULL = phạm vi toàn hệ thống (tổng đài trung tâm).
    const rows = await this.executor.query<{ organization_id: string | null }>(
      undefined,
      `SELECT DISTINCT organization_id FROM user_roles
        WHERE user_id = $1 AND organization_id IS NOT NULL`,
      [userId],
    );
    return rows.map((row) => row.organization_id as string);
  }

  async updateProfile(
    tx: TxContext,
    userId: string,
    patch: { fullName?: string; locale?: string },
  ): Promise<UserRow> {
    const rows = await this.executor.query<UserRow>(
      tx,
      `UPDATE users
          SET full_name = COALESCE($2, full_name),
              locale    = COALESCE($3, locale),
              updated_by = $1
        WHERE id = $1
        RETURNING *`,
      [userId, patch.fullName ?? null, patch.locale ?? null],
    );
    return rows[0];
  }

  async getEmergencyProfile(userId: string): Promise<EmergencyProfileRow | null> {
    return this.executor.queryOne<EmergencyProfileRow>(
      undefined,
      `SELECT * FROM emergency_profiles WHERE user_id = $1`,
      [userId],
    );
  }

  async upsertEmergencyProfile(
    tx: TxContext,
    input: UpsertEmergencyProfileInput,
  ): Promise<EmergencyProfileRow> {
    // `version = version + 1` mỗi lần ghi: hồ sơ bàn giao của ca cũ vẫn tham
    // chiếu đúng phiên bản đã dùng lúc đó (FR-011).
    const rows = await this.executor.query<EmergencyProfileRow>(
      tx,
      `INSERT INTO emergency_profiles (
         user_id, blood_type, allergies, chronic_conditions, medications,
         preferred_facility, special_note, consent_share_in_emergency,
         created_by, updated_by
       ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7, $8, $1, $1)
       ON CONFLICT ON CONSTRAINT uq_emergency_profiles_user DO UPDATE SET
         blood_type = EXCLUDED.blood_type,
         allergies = EXCLUDED.allergies,
         chronic_conditions = EXCLUDED.chronic_conditions,
         medications = EXCLUDED.medications,
         preferred_facility = EXCLUDED.preferred_facility,
         special_note = EXCLUDED.special_note,
         consent_share_in_emergency = EXCLUDED.consent_share_in_emergency,
         version = emergency_profiles.version + 1,
         updated_at = now(),
         updated_by = EXCLUDED.updated_by
       RETURNING *`,
      [
        input.userId,
        input.bloodType,
        JSON.stringify(input.allergies),
        JSON.stringify(input.chronicConditions),
        JSON.stringify(input.medications),
        input.preferredFacility,
        input.specialNote,
        input.consentShareInEmergency,
      ],
    );
    return rows[0];
  }

  async listEmergencyContacts(userId: string): Promise<EmergencyContactRow[]> {
    return this.executor.query<EmergencyContactRow>(
      undefined,
      `SELECT * FROM emergency_contacts WHERE user_id = $1 ORDER BY priority ASC, created_at ASC`,
      [userId],
    );
  }

  async addEmergencyContact(
    tx: TxContext,
    input: {
      userId: string;
      name: string;
      phone: string;
      relation: string | null;
      priority: number;
      notifyByPush: boolean;
      notifyBySms: boolean;
    },
  ): Promise<EmergencyContactRow> {
    const rows = await this.executor.query<EmergencyContactRow>(
      tx,
      `INSERT INTO emergency_contacts
         (user_id, name, phone, relation, priority, notify_by_push, notify_by_sms,
          created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $1, $1)
       RETURNING *`,
      [
        input.userId,
        input.name,
        input.phone,
        input.relation,
        input.priority,
        input.notifyByPush,
        input.notifyBySms,
      ],
    );
    return rows[0];
  }

  async deleteEmergencyContact(
    tx: TxContext,
    userId: string,
    contactId: string,
  ): Promise<boolean> {
    // Điều kiện `user_id` trong WHERE: không ai xoá được liên hệ của người khác
    // kể cả khi đoán đúng id (IDOR).
    const rows = await this.executor.query<{ id: string }>(
      tx,
      `DELETE FROM emergency_contacts WHERE id = $2 AND user_id = $1 RETURNING id`,
      [userId, contactId],
    );
    return rows.length > 0;
  }

  async registerDevice(
    tx: TxContext,
    input: {
      deviceId: string;
      userId: string;
      platform: 'ios' | 'android' | 'web';
      pushToken: string | null;
      appVersion: string | null;
    },
  ): Promise<DeviceRow> {
    const rows = await this.executor.query<DeviceRow>(
      tx,
      `INSERT INTO devices (id, user_id, platform, push_token, app_version, last_seen_at,
                            created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, now(), $2, $2)
       ON CONFLICT (id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         push_token = EXCLUDED.push_token,
         app_version = EXCLUDED.app_version,
         last_seen_at = now(),
         updated_by = EXCLUDED.updated_by
       RETURNING *`,
      [input.deviceId, input.userId, input.platform, input.pushToken, input.appVersion],
    );
    return rows[0];
  }
}
