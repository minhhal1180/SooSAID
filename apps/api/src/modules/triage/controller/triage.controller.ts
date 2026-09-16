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
import { CurrentActor } from '../../../common/security/auth.decorators';
import type { AuthenticatedActor } from '../../../common/http/request-context';
import { SubmitTriageDto } from '../dto/submit-triage.dto';
import { TriageService } from '../service/triage.service';

/** Bộ câu hỏi phân loại đang hiệu lực (`/v1/triage/questionnaire`). */
@Controller('triage')
export class TriageQuestionnaireController {
  constructor(private readonly triageService: TriageService) {}

  /**
   * Mobile tải bộ câu hỏi từ server thay vì hard-code: khi bộ câu hỏi được
   * chuyên gia duyệt lại, app cũ vẫn hiển thị đúng nội dung mới nhất (SOS-013).
   */
  @Get('questionnaire')
  getQuestionnaire() {
    return this.triageService.getCurrentQuestionnaire();
  }
}

/** Phiếu phân loại theo ca (`/v1/emergency-cases/{caseId}/triage`). */
@Controller('emergency-cases/:caseId/triage')
export class TriageController {
  constructor(private readonly triageService: TriageService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async submit(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() body: SubmitTriageDto,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.triageService.submit(caseId, actor, {
      questionnaireVersion: body.questionnaireVersion,
      answers: body.answers,
    });
  }

  @Get()
  async list(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.triageService.listByCase(caseId, actor);
  }
}
