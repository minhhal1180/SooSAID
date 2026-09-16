import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TriggerSource } from '../../../contracts/generated/api-contract';
import { LocationSampleDto } from '../../../common/dto/location-sample.dto';

/**
 * Body của `POST /v1/emergency-cases` (OpenAPI: `CreateEmergencyCaseRequest`).
 *
 * Thiết kế có chủ đích: **rất ít trường bắt buộc**. Người đang hoảng loạn không
 * điền form — mọi thông tin bổ sung (triage, ghi chú tiếp cận) được gửi SAU khi
 * ca đã tồn tại, qua endpoint riêng.
 */

/** Giới hạn trên số nạn nhân, chặn dữ liệu rác làm hỏng điều phối. */
const MAX_PATIENTS_PER_CASE = 100;

export class CreateEmergencyCaseDto {
  /** Thiết bị gửi yêu cầu – dùng cho rate limit và truy vết (FR-001). */
  @IsUUID()
  deviceId!: string;

  @ValidateNested()
  @Type(() => LocationSampleDto)
  location!: LocationSampleDto;

  @IsOptional()
  @IsEnum(TriggerSource)
  triggerSource?: TriggerSource;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PATIENTS_PER_CASE)
  numberOfPatients?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  accessNote?: string;

  /**
   * Đồng ý cho ghi hình. Mặc định `false` và server KHÔNG tự suy ra `true`
   * (TC-016, ADR-006). Cờ này chỉ là một điều kiện; `RECORDING_ENABLED` vẫn
   * phải bật ở cấp hệ thống thì mới có ghi hình.
   */
  @IsOptional()
  @IsBoolean()
  mediaConsent?: boolean;
}
