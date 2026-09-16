import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { CaseStatus } from '../../../contracts/generated/api-contract';

/** Query của `GET /v1/operator/queue`. */
export class OperatorQueueQueryDto {
  /**
   * Lọc theo một trạng thái cụ thể. Bỏ trống = toàn bộ ca đang hoạt động
   * (mặc định do service quyết định, xem `OPERATOR_QUEUE_STATUSES`).
   */
  @IsOptional()
  @IsEnum(CaseStatus)
  status?: CaseStatus;

  /**
   * Thu hẹp theo service area. Chỉ có tác dụng THU HẸP trong phạm vi vốn có của
   * người trực — không dùng để xem vùng khác (kiểm tra ở service).
   */
  @IsOptional()
  @IsUUID()
  serviceAreaId?: string;
}
