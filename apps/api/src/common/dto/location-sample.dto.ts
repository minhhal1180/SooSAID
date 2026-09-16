import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Một mẫu vị trí GPS (schema `LocationSample` trong OpenAPI).
 *
 * `capturedAt` là thời điểm THIẾT BỊ đo được, khác `received_at` là thời điểm
 * server nhận. Giữ cả hai vì mạng yếu có thể làm mẫu vị trí tới muộn hàng chục
 * giây — nhân viên trực cần biết vị trí đó "cũ" bao nhiêu (FR-003).
 */

/** Độ cao hợp lý trên mặt đất; ngoài khoảng này chắc chắn là dữ liệu hỏng. */
const MIN_ALTITUDE_METERS = -500;
const MAX_ALTITUDE_METERS = 9000;
/** Sai số lớn hơn mức này thì mẫu vô dụng cho việc tiếp cận hiện trường. */
const MAX_ACCURACY_METERS = 100_000;

export class LocationSampleDto {
  @IsLatitude()
  lat!: number;

  @IsLongitude()
  lng!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MAX_ACCURACY_METERS)
  accuracyMeters?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(MIN_ALTITUDE_METERS)
  @Max(MAX_ALTITUDE_METERS)
  altitudeMeters?: number;

  @IsISO8601()
  capturedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  addressText?: string;

  /** Chỉ dẫn tiếp cận: cổng nào, tầng mấy, đi lối nào (FR-003). */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  accessNote?: string;
}
