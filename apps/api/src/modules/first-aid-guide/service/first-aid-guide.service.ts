import { Inject, Injectable } from '@nestjs/common';
import {
  ApiErrorCode,
  DomainEventType,
  GuidanceApprovalStatus,
} from '../../../contracts/generated/api-contract';
import { APP_CONFIG, type AppConfig } from '../../../common/config/app-config';
import { DomainError, DomainErrors } from '../../../common/errors/domain-error';
import type { AuthenticatedActor } from '../../../common/http/request-context';
import type { GuidanceCatalogRow } from '../../../persistence/rows';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../persistence/unit-of-work';
import { AuditAction, AuditResourceType } from '../../audit-log/entity/audit-action';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { canAddCaseNote, canViewCase } from '../../emergency-case/entity/case-access.policy';
import { EmergencyCaseService } from '../../emergency-case/service/emergency-case.service';
import { OutboxService } from '../../outbox/service/outbox.service';
import {
  GUIDANCE_REPOSITORY,
  GuidanceEventAction,
  type GuidanceRepositoryPort,
} from '../repository/guidance.repository';

/**
 * Hướng dẫn sơ cấp cứu (FR-010, SOS-030/031).
 *
 * Chốt chặn quan trọng nhất: **chỉ nội dung đã được duyệt mới gửi tới ca thật**.
 * Nội dung `DRAFT` (bao gồm bộ nội dung diễn tập trong seed) chỉ gửi được khi
 * `GUIDANCE_ALLOW_DRILL_CONTENT=true` — cấu hình dành cho diễn tập.
 *
 * Rule 1.2: hệ thống KHÔNG tự chọn hướng dẫn theo triệu chứng. Nhân viên y tế
 * chọn, hệ thống chỉ hiển thị và ghi lại đã hiển thị nội dung nào, bởi ai.
 */

/** Trạng thái được coi là đã duyệt, dùng cho ca thật. */
const APPROVED_STATUSES: readonly string[] = [
  GuidanceApprovalStatus.APPROVED,
  GuidanceApprovalStatus.EFFECTIVE,
];

export interface GuidanceView {
  id: string;
  code: string;
  version: number;
  title: string;
  content: Record<string, unknown>;
  approvalStatus: string;
  /** `true` khi nội dung chưa được chuyên gia duyệt – UI phải cảnh báo rõ. */
  drillOnly: boolean;
}

@Injectable()
export class FirstAidGuideService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(GUIDANCE_REPOSITORY) private readonly repository: GuidanceRepositoryPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly emergencyCaseService: EmergencyCaseService,
    private readonly outbox: OutboxService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Danh mục hướng dẫn mà người gọi được phép sử dụng. */
  async listCatalog(): Promise<{ items: GuidanceView[]; drillContentAllowed: boolean }> {
    const statuses = this.allowedApprovalStatuses();
    const rows = await this.repository.listCatalog(statuses);
    return {
      items: rows.map(toGuidanceView),
      drillContentAllowed: this.config.policy.guidanceAllowDrillContent,
    };
  }

  /**
   * Nhân viên y tế gửi một hướng dẫn tới ca đang xử lý và hệ thống ghi lại sự
   * kiện đó (SOS-031: "event logged").
   */
  async deliverToCase(
    caseId: string,
    actor: AuthenticatedActor,
    guidanceId: string,
  ): Promise<GuidanceView> {
    const context = await this.emergencyCaseService.buildAccessContext(caseId, actor);
    if (!canAddCaseNote(context)) {
      throw DomainErrors.forbidden('Bạn không được phép gửi hướng dẫn cho ca này.', { caseId });
    }

    const guidance = await this.repository.findById(guidanceId);
    if (!guidance) throw DomainErrors.notFound('nội dung hướng dẫn', { caseId });

    this.assertDeliverable(guidance);

    await this.unitOfWork.runInTransaction(async (tx) => {
      await this.repository.recordEvent(tx, {
        caseId,
        guidanceId: guidance.id,
        action: GuidanceEventAction.DISPLAYED,
        actorUserId: actor.userId,
        metadata: { code: guidance.code, version: guidance.version },
      });

      await this.outbox.append(tx, {
        aggregateType: 'Guidance',
        aggregateId: guidance.id,
        eventType: DomainEventType.GUIDANCE_DELIVERED,
        payload: {
          caseId,
          guidanceId: guidance.id,
          code: guidance.code,
          version: guidance.version,
          actorUserId: actor.userId,
        },
      });
    });

    await this.auditLog.record({
      action: AuditAction.GUIDANCE_DELIVERED,
      resourceType: AuditResourceType.EMERGENCY_CASE,
      resourceId: caseId,
      caseId,
      metadata: { guidanceCode: guidance.code, guidanceVersion: guidance.version },
    });

    return toGuidanceView(guidance);
  }

  /**
   * Người dân xác nhận đã thực hiện/đã bỏ qua một hướng dẫn.
   * Đây là dữ liệu quan trọng cho hồ sơ bàn giao: kíp cấp cứu cần biết những gì
   * ĐÃ được làm trước khi họ tới.
   */
  async acknowledge(
    caseId: string,
    actor: AuthenticatedActor,
    guidanceId: string,
    action: GuidanceEventAction,
  ): Promise<void> {
    const context = await this.emergencyCaseService.buildAccessContext(caseId, actor);
    if (!canViewCase(context)) throw DomainErrors.notFound('ca cấp cứu', { caseId });

    await this.unitOfWork.runInTransaction((tx) =>
      this.repository.recordEvent(tx, {
        caseId,
        guidanceId,
        action,
        actorUserId: actor.userId,
        metadata: {},
      }),
    );
  }

  /** Nhật ký hướng dẫn của ca – nguồn cho phần "đã thực hiện" trong handover. */
  async listCaseGuidanceLog(caseId: string) {
    const events = await this.repository.listEventsByCase(caseId);

    const guidanceCache = new Map<string, GuidanceCatalogRow | null>();
    const entries = [];

    for (const event of events) {
      if (event.guidance_id && !guidanceCache.has(event.guidance_id)) {
        guidanceCache.set(event.guidance_id, await this.repository.findById(event.guidance_id));
      }
      const guidance = event.guidance_id ? guidanceCache.get(event.guidance_id) : null;

      entries.push({
        at: event.created_at.toISOString(),
        action: event.action,
        actorUserId: event.actor_user_id,
        // Tham chiếu theo code+version, không nhúng lại nội dung: nội dung là
        // của version cụ thể và tra được từ danh mục (TC-035).
        guidanceCode: guidance?.code ?? null,
        guidanceVersion: guidance?.version ?? null,
        title: guidance?.title ?? null,
      });
    }

    return { items: entries };
  }

  private allowedApprovalStatuses(): readonly string[] {
    return this.config.policy.guidanceAllowDrillContent
      ? [...APPROVED_STATUSES, GuidanceApprovalStatus.DRAFT]
      : APPROVED_STATUSES;
  }

  private assertDeliverable(guidance: GuidanceCatalogRow): void {
    if (APPROVED_STATUSES.includes(guidance.approval_status)) return;

    if (!this.config.policy.guidanceAllowDrillContent) {
      // Đây là chốt chặn của Rule 1.2 và Rule 14: không đẩy nội dung y tế chưa
      // kiểm duyệt tới người đang xử lý một ca thật.
      throw new DomainError(
        ApiErrorCode.GUIDANCE_NOT_APPROVED,
        'Nội dung hướng dẫn này chưa được chuyên gia y tế phê duyệt nên không thể gửi.',
        [{ code: guidance.code, version: guidance.version, status: guidance.approval_status }],
      );
    }
  }
}

function toGuidanceView(row: GuidanceCatalogRow): GuidanceView {
  return {
    id: row.id,
    code: row.code,
    version: row.version,
    title: row.title,
    content: row.content,
    approvalStatus: row.approval_status,
    drillOnly: !APPROVED_STATUSES.includes(row.approval_status),
  };
}
