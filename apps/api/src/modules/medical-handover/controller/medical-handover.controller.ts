import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { UserRole } from '../../../contracts/generated/api-contract';
import { CurrentActor, Roles } from '../../../common/security/auth.decorators';
import type { AuthenticatedActor } from '../../../common/http/request-context';
import { MedicalHandoverService } from '../service/medical-handover.service';
import { ReportingService } from '../service/reporting.service';

export class FinalizeHandoverDto {
  @IsOptional()
  @IsUUID()
  receivingFacilityId?: string;

  @IsOptional()
  @IsUUID()
  ambulanceUnitId?: string;
}

export class ReportSummaryQueryDto {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;

  /** Mặc định KHÔNG gộp ca diễn tập vào KPI (TDD §8.2 W07). */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeDrills?: boolean;
}

/** Hồ sơ bàn giao theo ca (`/v1/emergency-cases/{caseId}/handover`). */
@Controller('emergency-cases/:caseId/handover')
export class MedicalHandoverController {
  constructor(private readonly handoverService: MedicalHandoverService) {}

  /** Xem trước nội dung sẽ được đóng băng – không tạo version. */
  @Get('preview')
  async preview(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.handoverService.preview(caseId, actor);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.OPERATOR_115, UserRole.CLINICIAN, UserRole.AMBULANCE_CREW)
  async finalize(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() body: FinalizeHandoverDto,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.handoverService.finalize(caseId, actor, body);
  }

  @Get()
  async listVersions(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.handoverService.listVersions(caseId, actor);
  }

  /** Đọc bản đã đóng băng – cơ sở tiếp nhận dùng endpoint này (SOS-034). */
  @Get(':version')
  async getVersion(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('version', ParseIntPipe) version: number,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.handoverService.getVersion(caseId, version, actor);
  }
}

/** Báo cáo pilot (`/v1/reports/*`, SOS-042). */
@Controller('reports')
@Roles(UserRole.ADMIN, UserRole.AUDITOR, UserRole.OPERATOR_115)
export class ReportingController {
  constructor(private readonly reportingService: ReportingService) {}

  @Get('summary')
  async summary(@Query() query: ReportSummaryQueryDto) {
    return this.reportingService.summary(new Date(query.from), new Date(query.to), {
      includeDrills: query.includeDrills ?? false,
    });
  }
}
