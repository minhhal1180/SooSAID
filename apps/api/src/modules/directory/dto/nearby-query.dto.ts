import { Type } from 'class-transformer';
import { IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Max, Min } from 'class-validator';

const MAX_QUERY_RADIUS_METERS = 50_000;

export class NearbyQueryDto {
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_QUERY_RADIUS_METERS)
  radiusMeters?: number;
}

export class NearbyResourceQueryDto extends NearbyQueryDto {
  /** Lọc theo loại: FIRST_AID_ROOM, AED, ACCESS_GATE... (dữ liệu cấu hình). */
  @IsOptional()
  @IsString()
  resourceType?: string;
}
