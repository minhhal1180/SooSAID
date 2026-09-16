import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Giới hạn kích thước danh sách trong hồ sơ sức khỏe: không phải để tiết kiệm
 * dung lượng mà để nhân viên y tế đọc được trong vài giây trên hiện trường.
 */
const MAX_LIST_ITEMS = 20;
const MAX_LIST_ITEM_LENGTH = 120;
const MAX_SPECIAL_NOTE_LENGTH = 2000;

/** Số điện thoại VN hoặc E.164. */
const PHONE_PATTERN = /^(\+?\d{8,15})$/;

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;
}

export class EmergencyProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(8)
  bloodType?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LIST_ITEMS)
  @IsString({ each: true })
  @MaxLength(MAX_LIST_ITEM_LENGTH, { each: true })
  allergies?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LIST_ITEMS)
  @IsString({ each: true })
  @MaxLength(MAX_LIST_ITEM_LENGTH, { each: true })
  chronicConditions?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LIST_ITEMS)
  @IsString({ each: true })
  @MaxLength(MAX_LIST_ITEM_LENGTH, { each: true })
  medications?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  preferredFacility?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_SPECIAL_NOTE_LENGTH)
  specialNote?: string | null;

  /**
   * Đồng ý chia sẻ hồ sơ khi có ca cấp cứu. Mặc định `false`: im lặng KHÔNG
   * phải là đồng ý (TC-015).
   */
  @IsOptional()
  @IsBoolean()
  consentShareInEmergency?: boolean;
}

export class CreateEmergencyContactDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @Matches(PHONE_PATTERN, { message: 'Số điện thoại không hợp lệ.' })
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  relation?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  notifyByPush?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyBySms?: boolean;
}

export class RegisterDeviceDto {
  @IsUUID()
  deviceId!: string;

  @IsIn(['ios', 'android', 'web'])
  platform!: 'ios' | 'android' | 'web';

  @IsOptional()
  @IsString()
  @MaxLength(512)
  pushToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  appVersion?: string;
}
