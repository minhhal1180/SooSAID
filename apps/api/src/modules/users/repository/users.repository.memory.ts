import { randomUUID } from 'node:crypto';
import { UserRole } from '../../../contracts/generated/api-contract';
import type { MemoryDb } from '../../../persistence/memory/memory-db';
import type {
  DeviceRow,
  EmergencyContactRow,
  EmergencyProfileRow,
  UserRow,
} from '../../../persistence/rows';
import type { TxContext } from '../../../persistence/unit-of-work';
import type { UpsertEmergencyProfileInput, UsersRepositoryPort } from './users.repository.port';

function auditColumns(actorId: string | null) {
  const now = new Date();
  return { created_at: now, updated_at: now, created_by: actorId, updated_by: actorId };
}

export class MemoryUsersRepository implements UsersRepositoryPort {
  constructor(private readonly db: MemoryDb) {}

  async findById(userId: string): Promise<UserRow | null> {
    return this.db.users.findById(userId);
  }

  async findByPhone(phone: string): Promise<UserRow | null> {
    return this.db.users.findOne((row) => row.phone === phone);
  }

  async createCitizen(_tx: TxContext, phone: string): Promise<UserRow> {
    const id = randomUUID();
    const user = this.db.users.insert({
      id,
      phone,
      email: null,
      full_name: null,
      status: 'ACTIVE',
      locale: 'vi-VN',
      ...auditColumns(id),
    });
    this.db.userRoles.insert({
      id: randomUUID(),
      user_id: id,
      role: UserRole.CITIZEN,
      organization_id: null,
      ...auditColumns(id),
    });
    return user;
  }

  async listRoles(userId: string): Promise<UserRole[]> {
    return this.db.userRoles.findMany((row) => row.user_id === userId).map((row) => row.role);
  }

  async listServiceAreaIds(userId: string): Promise<string[]> {
    const ids = this.db.userRoles
      .findMany((row) => row.user_id === userId && row.organization_id !== null)
      .map((row) => row.organization_id as string);
    return [...new Set(ids)];
  }

  async updateProfile(
    _tx: TxContext,
    userId: string,
    patch: { fullName?: string; locale?: string },
  ): Promise<UserRow> {
    const existing = this.db.users.findById(userId);
    if (!existing) throw new Error(`User ${userId} không tồn tại`);
    return this.db.users.update(userId, {
      full_name: patch.fullName ?? existing.full_name,
      locale: patch.locale ?? existing.locale,
      updated_by: userId,
    }) as UserRow;
  }

  async getEmergencyProfile(userId: string): Promise<EmergencyProfileRow | null> {
    return this.db.emergencyProfiles.findOne((row) => row.user_id === userId);
  }

  async upsertEmergencyProfile(
    _tx: TxContext,
    input: UpsertEmergencyProfileInput,
  ): Promise<EmergencyProfileRow> {
    const existing = this.db.emergencyProfiles.findOne((row) => row.user_id === input.userId);

    if (existing) {
      return this.db.emergencyProfiles.update(existing.id, {
        blood_type: input.bloodType,
        allergies: input.allergies,
        chronic_conditions: input.chronicConditions,
        medications: input.medications,
        preferred_facility: input.preferredFacility,
        special_note: input.specialNote,
        consent_share_in_emergency: input.consentShareInEmergency,
        version: existing.version + 1,
        updated_by: input.userId,
      }) as EmergencyProfileRow;
    }

    return this.db.emergencyProfiles.insert({
      id: randomUUID(),
      user_id: input.userId,
      blood_type: input.bloodType,
      allergies: input.allergies,
      chronic_conditions: input.chronicConditions,
      medications: input.medications,
      preferred_facility: input.preferredFacility,
      special_note: input.specialNote,
      consent_share_in_emergency: input.consentShareInEmergency,
      version: 1,
      ...auditColumns(input.userId),
    });
  }

  async listEmergencyContacts(userId: string): Promise<EmergencyContactRow[]> {
    return this.db.emergencyContacts
      .findMany((row) => row.user_id === userId)
      .sort((a, b) => a.priority - b.priority || a.created_at.getTime() - b.created_at.getTime());
  }

  async addEmergencyContact(
    _tx: TxContext,
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
    return this.db.emergencyContacts.insert({
      id: randomUUID(),
      user_id: input.userId,
      name: input.name,
      phone: input.phone,
      relation: input.relation,
      priority: input.priority,
      notify_by_push: input.notifyByPush,
      notify_by_sms: input.notifyBySms,
      ...auditColumns(input.userId),
    });
  }

  async deleteEmergencyContact(
    _tx: TxContext,
    userId: string,
    contactId: string,
  ): Promise<boolean> {
    const row = this.db.emergencyContacts.findById(contactId);
    // Kiểm tra quyền sở hữu giống driver postgres: không xoá được của người khác.
    if (!row || row.user_id !== userId) return false;
    this.db.emergencyContacts.delete(contactId);
    return true;
  }

  async registerDevice(
    _tx: TxContext,
    input: {
      deviceId: string;
      userId: string;
      platform: 'ios' | 'android' | 'web';
      pushToken: string | null;
      appVersion: string | null;
    },
  ): Promise<DeviceRow> {
    const existing = this.db.devices.findById(input.deviceId);
    if (existing) {
      return this.db.devices.update(input.deviceId, {
        user_id: input.userId,
        push_token: input.pushToken,
        app_version: input.appVersion,
        last_seen_at: new Date(),
        updated_by: input.userId,
      }) as DeviceRow;
    }
    return this.db.devices.insert({
      id: input.deviceId,
      user_id: input.userId,
      platform: input.platform,
      push_token: input.pushToken,
      app_version: input.appVersion,
      last_seen_at: new Date(),
      ...auditColumns(input.userId),
    });
  }
}
