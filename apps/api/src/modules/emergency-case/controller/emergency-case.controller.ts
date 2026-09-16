import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  NoteType,
  TriggerSource,
  UserRole,
  type EmergencyCaseView,
} from '../../../contracts/generated/api-contract';
import { DomainErrors } from '../../../common/errors/domain-error';
import { CurrentActor, Roles } from '../../../common/security/auth.decorators';
import type { AuthenticatedActor } from '../../../common/http/request-context';
import { CreateEmergencyCaseDto } from '../dto/create-emergency-case.dto';
import { AddCaseNoteDto, TransitionStatusDto } from '../dto/transition-status.dto';
import { EmergencyCaseService } from '../service/emergency-case.service';

/**
 * API ca cấp cứu (`/v1/emergency-cases`).
 *
 * Controller chỉ làm ba việc: đọc input, gọi service, trả payload trần.
 * Không có logic nghiệp vụ, không tự bọc envelope (ADR-003).
 */

/** Độ dài hợp lệ của Idempotency-Key (UUID v4 hoặc chuỗi ngẫu nhiên tương đương). */
const MIN_IDEMPOTENCY_KEY_LENGTH = 16;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

@Controller('emergency-cases')
export class EmergencyCaseController {
  constructor(private readonly emergencyCaseService: EmergencyCaseService) {}

  /**
   * Tạo ca cấp cứu – bước 1 của Rule 7.2.
   *
   * `Idempotency-Key` là BẮT BUỘC (OpenAPI đánh dấu required): người hoảng loạn
   * bấm nhiều lần và mạng di động hay timeout rồi client tự retry.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.CITIZEN, UserRole.OPERATOR_115)
  async create(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateEmergencyCaseDto,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<EmergencyCaseView> {
    this.assertIdempotencyKey(idempotencyKey);

    return this.emergencyCaseService.createCase({
      deviceId: body.deviceId,
      callerUserId: actor.userId,
      triggerSource: body.triggerSource ?? TriggerSource.SOS_BUTTON,
      numberOfPatients: body.numberOfPatients ?? 1,
      accessNote: body.accessNote ?? null,
      mediaConsent: body.mediaConsent ?? false,
      location: {
        lat: body.location.lat,
        lng: body.location.lng,
        accuracyMeters: body.location.accuracyMeters ?? null,
        capturedAt: body.location.capturedAt,
        addressText: body.location.addressText ?? null,
        accessNote: body.location.accessNote ?? null,
      },
      idempotencyKey: idempotencyKey as string,
    });
  }

  /** Lịch sử ca của chính người dùng (màn hình M10 – chỉ dữ liệu của họ). */
  @Get('mine')
  @Roles(UserRole.CITIZEN)
  async listMine(@CurrentActor() actor: AuthenticatedActor): Promise<EmergencyCaseView[]> {
    return this.emergencyCaseService.listMyCases(actor);
  }

  @Get(':caseId')
  async getOne(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<EmergencyCaseView> {
    return this.emergencyCaseService.getCaseForActor(caseId, actor);
  }

  /** Timeline đầy đủ: mốc trạng thái + ghi chú (dữ liệu nền cho hồ sơ bàn giao). */
  @Get(':caseId/timeline')
  async getTimeline(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.emergencyCaseService.getTimeline(caseId, actor);
  }

  @Post(':caseId/status')
  @HttpCode(HttpStatus.OK)
  async transition(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() body: TransitionStatusDto,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<EmergencyCaseView> {
    return this.emergencyCaseService.transitionStatus(
      caseId,
      actor,
      body.toStatus,
      body.reason ?? null,
    );
  }

  @Post(':caseId/notes')
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.OPERATOR_115,
    UserRole.CLINICIAN,
    UserRole.AMBULANCE_CREW,
    UserRole.LOCAL_RESPONDER,
  )
  async addNote(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() body: AddCaseNoteDto,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.emergencyCaseService.addNote(
      caseId,
      actor,
      body.text,
      body.noteType ?? NoteType.GENERAL,
    );
  }

  private assertIdempotencyKey(key: string | undefined): void {
    if (
      !key ||
      key.length < MIN_IDEMPOTENCY_KEY_LENGTH ||
      key.length > MAX_IDEMPOTENCY_KEY_LENGTH
    ) {
      throw DomainErrors.validation(
        'Header Idempotency-Key là bắt buộc và phải dài 16–128 ký tự.',
        [{ field: 'Idempotency-Key' }],
      );
    }
  }
}
