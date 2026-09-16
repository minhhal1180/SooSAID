import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { IsEnum, IsUUID } from 'class-validator';
import { UserRole } from '../../../contracts/generated/api-contract';
import { CurrentActor, Roles } from '../../../common/security/auth.decorators';
import type { AuthenticatedActor } from '../../../common/http/request-context';
import { GuidanceEventAction } from '../repository/guidance.repository';
import { FirstAidGuideService } from '../service/first-aid-guide.service';

export class DeliverGuidanceDto {
  @IsUUID()
  guidanceId!: string;
}

export class AcknowledgeGuidanceDto {
  @IsUUID()
  guidanceId!: string;

  @IsEnum(GuidanceEventAction)
  action!: GuidanceEventAction;
}

/** Danh mục hướng dẫn (`/v1/first-aid-guides`). */
@Controller('first-aid-guides')
export class FirstAidGuideCatalogController {
  constructor(private readonly guideService: FirstAidGuideService) {}

  /**
   * Danh mục để mobile cache offline (SOS-051: khi mất mạng vẫn có hướng dẫn đã
   * duyệt). Trả kèm `drillOnly` để app cảnh báo rõ nội dung chưa kiểm duyệt.
   */
  @Get()
  async list() {
    return this.guideService.listCatalog();
  }
}

/** Hướng dẫn gắn với một ca (`/v1/emergency-cases/{caseId}/guidance`). */
@Controller('emergency-cases/:caseId/guidance')
export class CaseGuidanceController {
  constructor(private readonly guideService: FirstAidGuideService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.OPERATOR_115, UserRole.CLINICIAN)
  async deliver(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() body: DeliverGuidanceDto,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.guideService.deliverToCase(caseId, actor, body.guidanceId);
  }

  /** Người dân xác nhận đã thực hiện – dữ liệu đưa vào hồ sơ bàn giao. */
  @Post('acknowledge')
  @HttpCode(HttpStatus.ACCEPTED)
  async acknowledge(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() body: AcknowledgeGuidanceDto,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    await this.guideService.acknowledge(caseId, actor, body.guidanceId, body.action);
    return { accepted: true };
  }

  @Get()
  async log(@Param('caseId', ParseUUIDPipe) caseId: string) {
    return this.guideService.listCaseGuidanceLog(caseId);
  }
}
