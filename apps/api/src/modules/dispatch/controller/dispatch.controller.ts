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
import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  AssignmentStatus,
  DispatchPriority,
  UserRole,
} from '../../../contracts/generated/api-contract';
import { CurrentActor, Roles } from '../../../common/security/auth.decorators';
import type { AuthenticatedActor } from '../../../common/http/request-context';
import { DispatchService } from '../service/dispatch.service';

export class CreateDispatchDto {
  @IsIn(['ambulance_unit', 'local_responder'])
  targetType!: 'ambulance_unit' | 'local_responder';

  @IsUUID()
  targetId!: string;

  @IsOptional()
  @IsEnum(DispatchPriority)
  priority?: DispatchPriority;
}

export class UpdateAssignmentStatusDto {
  @IsEnum(AssignmentStatus)
  status!: AssignmentStatus;
}

/** Điều phối theo ca (`/v1/emergency-cases/{caseId}/dispatch`). */
@Controller('emergency-cases/:caseId/dispatch')
export class CaseDispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

  /** Ứng viên khả dụng cho ca: kíp xe rảnh + người hỗ trợ đã xác thực ở gần. */
  @Get('candidates')
  @Roles(UserRole.OPERATOR_115, UserRole.CLINICIAN)
  async candidates(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.dispatchService.listCandidates(caseId, actor);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.OPERATOR_115, UserRole.CLINICIAN)
  async create(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() body: CreateDispatchDto,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.dispatchService.createAssignment(caseId, actor, body);
  }

  @Get()
  async list(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.dispatchService.listByCase(caseId, actor);
  }
}

/**
 * Nhiệm vụ của kíp xe / người hỗ trợ (`/v1/assignments/*`).
 * Đây là bề mặt API của Crew/Responder PWA (SOS-025).
 */
@Controller('assignments')
@Roles(UserRole.AMBULANCE_CREW, UserRole.LOCAL_RESPONDER)
export class AssignmentController {
  constructor(private readonly dispatchService: DispatchService) {}

  @Get('mine')
  async mine(@CurrentActor() actor: AuthenticatedActor) {
    return this.dispatchService.listMyAssignments(actor);
  }

  @Post(':assignmentId/status')
  @HttpCode(HttpStatus.OK)
  async updateStatus(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() body: UpdateAssignmentStatusDto,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.dispatchService.updateAssignmentStatus(assignmentId, actor, body.status);
  }
}
