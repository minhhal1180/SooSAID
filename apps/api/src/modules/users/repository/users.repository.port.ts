import type { UserRole } from '../../../contracts/generated/api-contract';
import type {
  DeviceRow,
  EmergencyContactRow,
  EmergencyProfileRow,
  UserRow,
} from '../../../persistence/rows';
import type { TxContext } from '../../../persistence/unit-of-work';

export interface UpsertEmergencyProfileInput {
  readonly userId: string;
  readonly bloodType: string | null;
  readonly allergies: string[];
  readonly chronicConditions: string[];
  readonly medications: string[];
  readonly preferredFacility: string | null;
  readonly specialNote: string | null;
  readonly consentShareInEmergency: boolean;
}

export interface UsersRepositoryPort {
  findById(userId: string): Promise<UserRow | null>;
  findByPhone(phone: string): Promise<UserRow | null>;

  /** Tạo tài khoản người dân khi đăng nhập OTP lần đầu. */
  createCitizen(tx: TxContext, phone: string): Promise<UserRow>;

  listRoles(userId: string): Promise<UserRole[]>;
  /** Service area gắn với vai trò của người dùng – nền tảng cho ABAC theo vùng. */
  listServiceAreaIds(userId: string): Promise<string[]>;

  updateProfile(
    tx: TxContext,
    userId: string,
    patch: { fullName?: string; locale?: string },
  ): Promise<UserRow>;

  getEmergencyProfile(userId: string): Promise<EmergencyProfileRow | null>;
  /** Mỗi lần ghi tăng `version` để hồ sơ bàn giao tham chiếu được đúng phiên bản. */
  upsertEmergencyProfile(
    tx: TxContext,
    input: UpsertEmergencyProfileInput,
  ): Promise<EmergencyProfileRow>;

  listEmergencyContacts(userId: string): Promise<EmergencyContactRow[]>;
  addEmergencyContact(
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
  ): Promise<EmergencyContactRow>;
  deleteEmergencyContact(tx: TxContext, userId: string, contactId: string): Promise<boolean>;

  registerDevice(
    tx: TxContext,
    input: {
      deviceId: string;
      userId: string;
      platform: 'ios' | 'android' | 'web';
      pushToken: string | null;
      appVersion: string | null;
    },
  ): Promise<DeviceRow>;
}

export const USERS_REPOSITORY = Symbol('USERS_REPOSITORY');
