import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CaseStatus, UserRole, type EmergencyCaseView } from '../../../contracts/generated/api-contract';
import { CurrentActor, Roles } from '../../../common/security/auth.decorators';
import type { AuthenticatedActor } from '../../../common/http/request-context';
import { OperatorQueueQueryDto } from '../dto/operator-queue.dto';
import { EmergencyCaseService } from '../service/emergency-case.service';

/**
 * API cho tổng đài/bác sĩ trực (`/v1/operator/*`, SOS-014).
 *
 * Tách khỏi `EmergencyCaseController` vì đây là bề mặt của một actor khác, với
 * ràng buộc vai trò khác — gộp chung sẽ khiến quyền khó đọc và dễ sai.
 */
@Controller('operator')
@Roles(UserRole.OPERATOR_115, UserRole.CLINICIAN)
export class OperatorController {
  constructor(private readonly emergencyCaseService: EmergencyCaseService) {}

  /** Hàng đợi ca đang hoạt động trong phạm vi service area của người trực. */
  @Get('queue')
  async queue(
    @Query() query: OperatorQueueQueryDto,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<EmergencyCaseView[]> {
    return this.emergencyCaseService.listQueue(actor, {
      statuses: query.status ? [query.status as CaseStatus] : undefined,
      serviceAreaId: query.serviceAreaId,
    });
  }

  /**
   * Nhận ca. Thao tác atomic: hai người bấm cùng lúc thì đúng một người thắng,
   * người còn lại nhận 409 `CASE_ALREADY_ACCEPTED` (TC-007).
   */
  @Post('cases/:caseId/accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<EmergencyCaseView> {
    return this.emergencyCaseService.acceptCase(caseId, actor);
  }
}
