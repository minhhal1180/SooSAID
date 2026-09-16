import { Inject, Injectable } from '@nestjs/common';
import { DomainEventType } from '../../../contracts/generated/api-contract';
import { DomainErrors } from '../../../common/errors/domain-error';
import type { AuthenticatedActor } from '../../../common/http/request-context';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../persistence/unit-of-work';
import { AuditAction, AuditResourceType } from '../../audit-log/entity/audit-action';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { canViewCase } from '../../emergency-case/entity/case-access.policy';
import { isActiveCase } from '../../emergency-case/entity/emergency-case.entity';
import { EmergencyCaseService } from '../../emergency-case/service/emergency-case.service';
import { OutboxService } from '../../outbox/service/outbox.service';
import {
  CURRENT_QUESTIONNAIRE_VERSION,
  findQuestionnaire,
  type TriageQuestionnaire,
} from '../entity/triage-questionnaire';
import {
  TRIAGE_REPOSITORY,
  type TriageRepositoryPort,
} from '../repository/triage.repository';

/**
 * Ghi nhận dấu hiệu quan sát được (FR-004, TC-006).
 *
 * Service này CỐ TÌNH không có logic phân loại: không tính điểm, không xếp mức
 * độ, không gợi ý chẩn đoán (Rule 1.2). Nó chỉ xác thực câu trả lời có thuộc bộ
 * câu hỏi đã phát hành hay không, rồi lưu lại nguyên văn.
 */
@Injectable()
export class TriageService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(TRIAGE_REPOSITORY) private readonly repository: TriageRepositoryPort,
    private readonly emergencyCaseService: EmergencyCaseService,
    private readonly outbox: OutboxService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Bộ câu hỏi đang hiệu lực – mobile tải về để render (không hard-code ở client). */
  getCurrentQuestionnaire(): TriageQuestionnaire {
    const questionnaire = findQuestionnaire(CURRENT_QUESTIONNAIRE_VERSION);
    if (!questionnaire) {
      throw DomainErrors.conflict('Chưa cấu hình bộ câu hỏi phân loại đang hiệu lực.');
    }
    return questionnaire;
  }

  async submit(
    caseId: string,
    actor: AuthenticatedActor,
    input: { questionnaireVersion: string; answers: Array<{ questionCode: string; value: string }> },
  ): Promise<{ submissionId: string; submittedAt: string }> {
    const context = await this.emergencyCaseService.buildAccessContext(caseId, actor);
    if (!canViewCase(context)) throw DomainErrors.notFound('ca cấp cứu', { caseId });

    if (!isActiveCase(context.caseRow.status)) {
      throw DomainErrors.conflict('Ca đã kết thúc, không nhận thêm phiếu phân loại.', {
        caseId,
        status: context.caseRow.status,
      });
    }

    const questionnaire = this.requireQuestionnaire(input.questionnaireVersion);
    this.assertAnswersMatchQuestionnaire(questionnaire, input.answers);

    const submission = await this.unitOfWork.runInTransaction(async (tx) => {
      const row = await this.repository.submit(tx, {
        caseId,
        questionnaireVersion: questionnaire.version,
        answers: input.answers,
        submittedBy: actor.userId,
      });

      await this.outbox.append(tx, {
        aggregateType: 'Triage',
        aggregateId: row.id,
        eventType: DomainEventType.TRIAGE_SUBMITTED,
        // Payload KHÔNG chứa câu trả lời: đó là dữ liệu quan sát về tình trạng
        // người bệnh. Ai cần đọc thì gọi API có kiểm tra quyền và ghi audit.
        payload: {
          caseId,
          submissionId: row.id,
          questionnaireVersion: questionnaire.version,
        },
      });

      return row;
    });

    await this.auditLog.record({
      action: AuditAction.TRIAGE_SUBMITTED,
      resourceType: AuditResourceType.EMERGENCY_CASE,
      resourceId: caseId,
      caseId,
      metadata: { questionnaireVersion: questionnaire.version },
    });

    return {
      submissionId: submission.id,
      submittedAt: submission.created_at.toISOString(),
    };
  }

  /** Lịch sử phiếu phân loại của ca – nhân viên trực đọc để thấy diễn biến. */
  async listByCase(caseId: string, actor: AuthenticatedActor) {
    const context = await this.emergencyCaseService.buildAccessContext(caseId, actor);
    if (!canViewCase(context)) throw DomainErrors.notFound('ca cấp cứu', { caseId });

    const rows = await this.repository.listByCase(caseId);
    return {
      items: rows.map((row) => ({
        id: row.id,
        questionnaireVersion: row.questionnaire_version,
        answers: row.answers,
        submittedAt: row.created_at.toISOString(),
        submittedBy: row.submitted_by,
      })),
    };
  }

  private requireQuestionnaire(version: string): TriageQuestionnaire {
    const questionnaire = findQuestionnaire(version);
    if (!questionnaire) {
      // Từ chối version lạ thay vì im lặng dùng version hiện tại: câu trả lời
      // gắn sai bộ câu hỏi sẽ bị hiểu sai khi đọc lại hồ sơ (TC-035).
      throw DomainErrors.validation(
        `Không tồn tại bộ câu hỏi phiên bản "${version}".`,
        [{ field: 'questionnaireVersion', current: CURRENT_QUESTIONNAIRE_VERSION }],
      );
    }
    return questionnaire;
  }

  private assertAnswersMatchQuestionnaire(
    questionnaire: TriageQuestionnaire,
    answers: Array<{ questionCode: string; value: string }>,
  ): void {
    const questionByCode = new Map(questionnaire.questions.map((q) => [q.code, q]));

    for (const answer of answers) {
      const question = questionByCode.get(answer.questionCode);
      if (!question) {
        throw DomainErrors.validation(`Câu hỏi "${answer.questionCode}" không thuộc bộ câu hỏi.`, [
          { field: 'answers', questionCode: answer.questionCode },
        ]);
      }
      if (!question.allowedValues.includes(answer.value as never)) {
        throw DomainErrors.validation(
          `Giá trị "${answer.value}" không hợp lệ cho câu hỏi "${answer.questionCode}".`,
          [{ field: 'answers', allowedValues: question.allowedValues }],
        );
      }
    }
    // Cố ý KHÔNG bắt buộc trả lời đủ mọi câu: người ở hiện trường có thể chỉ kịp
    // trả lời vài câu, và một phiếu thiếu vẫn tốt hơn không có phiếu nào.
  }
}
