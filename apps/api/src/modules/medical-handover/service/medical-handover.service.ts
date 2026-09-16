import { Inject, Injectable } from '@nestjs/common';
import { DomainEventType, UserRole } from '../../../contracts/generated/api-contract';
import { DomainErrors } from '../../../common/errors/domain-error';
import type { AuthenticatedActor } from '../../../common/http/request-context';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../persistence/unit-of-work';
import { AuditAction, AuditResourceType } from '../../audit-log/entity/audit-action';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { DispatchService } from '../../dispatch/service/dispatch.service';
import {
  canViewCase,
  canViewHealthProfileByRole,
} from '../../emergency-case/entity/case-access.policy';
import { EmergencyCaseService } from '../../emergency-case/service/emergency-case.service';
import { FirstAidGuideService } from '../../first-aid-guide/service/first-aid-guide.service';
import { LocationService } from '../../location/service/location.service';
import { OutboxService } from '../../outbox/service/outbox.service';
import { TriageService } from '../../triage/service/triage.service';
import {
  HANDOVER_REPOSITORY,
  type HandoverRepositoryPort,
} from '../repository/handover.repository';
import { buildHandoverPayload } from './handover-builder';

/**
 * Sinh hồ sơ bàn giao điện tử (FR-013, SOS-033/034).
 *
 * Mỗi lần finalize tạo MỘT VERSION MỚI, bất biến. Không bao giờ sửa version cũ:
 * kíp cấp cứu có thể đã đọc bản trước đó, và hồ sơ y tế phải truy vết được
 * (TC-018, TC-019).
 *
 * Module này ĐỌC dữ liệu từ nhiều module qua service công khai của chúng, không
 * đụng vào repository của module khác (Rule 2.2).
 */
@Injectable()
export class MedicalHandoverService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(HANDOVER_REPOSITORY) private readonly repository: HandoverRepositoryPort,
    private readonly emergencyCaseService: EmergencyCaseService,
    private readonly triageService: TriageService,
    private readonly guideService: FirstAidGuideService,
    private readonly dispatchService: DispatchService,
    private readonly locationService: LocationService,
    private readonly outbox: OutboxService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Xem trước nội dung sẽ được đóng băng, trước khi finalize (W05). */
  async preview(caseId: string, actor: AuthenticatedActor) {
    const context = await this.emergencyCaseService.buildAccessContext(caseId, actor);
    if (!canViewCase(context)) throw DomainErrors.notFound('ca cấp cứu', { caseId });

    return buildHandoverPayload(await this.collectSource(caseId, actor), new Date());
  }

  async finalize(
    caseId: string,
    actor: AuthenticatedActor,
    input: { receivingFacilityId?: string; ambulanceUnitId?: string },
  ) {
    const context = await this.emergencyCaseService.buildAccessContext(caseId, actor);

    // Chỉ người có thẩm quyền chuyên môn/vận hành mới được chốt hồ sơ (TDD §4.1).
    const canFinalize =
      actor.roles.includes(UserRole.CLINICIAN) ||
      actor.roles.includes(UserRole.OPERATOR_115) ||
      (actor.roles.includes(UserRole.AMBULANCE_CREW) && context.isAssignedToCase);
    if (!canFinalize) {
      await this.auditLog.recordDenied({
        action: AuditAction.HANDOVER_GENERATED,
        resourceType: AuditResourceType.HANDOVER,
        caseId,
      });
      throw DomainErrors.forbidden('Bạn không được phép chốt hồ sơ bàn giao của ca này.', {
        caseId,
      });
    }

    const source = await this.collectSource(caseId, actor);
    const generatedAt = new Date();
    const payload = buildHandoverPayload(source, generatedAt);

    const handover = await this.unitOfWork.runInTransaction(async (tx) => {
      // Version mới = max hiện tại + 1. Nếu hai người finalize cùng lúc, ràng
      // buộc UNIQUE(case_id, version) khiến một bên thất bại và phải thử lại —
      // tốt hơn là ghi đè lẫn nhau.
      const nextVersion = (await this.repository.maxVersionForCase(caseId)) + 1;

      const row = await this.repository.createFinalized(tx, {
        caseId,
        version: nextVersion,
        receivingFacilityId: input.receivingFacilityId ?? null,
        ambulanceUnitId: input.ambulanceUnitId ?? null,
        payload: payload as unknown as Record<string, unknown>,
        finalizedBy: actor.userId,
      });

      await this.outbox.append(tx, {
        aggregateType: 'Handover',
        aggregateId: row.id,
        eventType: DomainEventType.HANDOVER_FINALIZED,
        payload: { caseId, handoverId: row.id, version: row.version },
      });

      return row;
    });

    await this.auditLog.record({
      action: AuditAction.HANDOVER_GENERATED,
      resourceType: AuditResourceType.HANDOVER,
      resourceId: handover.id,
      caseId,
      metadata: { handoverId: handover.id, version: handover.version },
    });

    return {
      handoverId: handover.id,
      version: handover.version,
      status: handover.status,
      finalizedAt: handover.finalized_at?.toISOString() ?? null,
    };
  }

  /** Danh sách version đã chốt của ca. */
  async listVersions(caseId: string, actor: AuthenticatedActor) {
    const context = await this.emergencyCaseService.buildAccessContext(caseId, actor);
    if (!canViewCase(context)) throw DomainErrors.notFound('ca cấp cứu', { caseId });

    const rows = await this.repository.listByCase(caseId);
    return {
      items: rows.map((row) => ({
        id: row.id,
        version: row.version,
        status: row.status,
        finalizedAt: row.finalized_at?.toISOString() ?? null,
        receivingFacilityId: row.receiving_facility_id,
      })),
    };
  }

  /** Đọc một version cụ thể – bản đã đóng băng, không dựng lại từ dữ liệu hiện tại. */
  async getVersion(caseId: string, version: number, actor: AuthenticatedActor) {
    const context = await this.emergencyCaseService.buildAccessContext(caseId, actor);
    if (!canViewCase(context)) throw DomainErrors.notFound('ca cấp cứu', { caseId });

    const row = await this.repository.findByCaseAndVersion(caseId, version);
    if (!row) throw DomainErrors.notFound('hồ sơ bàn giao', { caseId });

    await this.auditLog.record({
      action: AuditAction.HANDOVER_VIEWED,
      resourceType: AuditResourceType.HANDOVER,
      resourceId: row.id,
      caseId,
      metadata: { version },
    });

    return {
      id: row.id,
      version: row.version,
      status: row.status,
      finalizedAt: row.finalized_at?.toISOString() ?? null,
      payload: row.payload,
    };
  }

  /**
   * Gom dữ liệu từ các module liên quan.
   *
   * Hồ sơ sức khỏe CHỈ được đưa vào khi người đọc có quyền theo vai trò — cùng
   * một ca, hai người khác vai trò xem preview sẽ thấy nội dung khác nhau
   * (TC-015). Bản đã finalize thì đóng băng theo quyền của người chốt.
   */
  private async collectSource(caseId: string, actor: AuthenticatedActor) {
    const context = await this.emergencyCaseService.buildAccessContext(caseId, actor);

    const [timeline, triage, guidance, assignments, locations] = await Promise.all([
      this.emergencyCaseService.getTimeline(caseId, actor),
      this.triageService.listByCase(caseId, actor),
      this.guideService.listCaseGuidanceLog(caseId),
      this.dispatchService.listByCase(caseId, actor),
      this.locationService.listHistory(caseId, actor).catch(() => ({ items: [] })),
    ]);

    return {
      caseRow: context.caseRow,
      statusHistory: timeline.statusHistory.map((entry) => ({
        at: entry.at,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        reason: entry.reason,
        changedBy: entry.changedBy,
      })),
      notes: timeline.notes.map((note) => ({
        at: note.at,
        noteType: note.noteType,
        text: note.text,
        authorUserId: note.authorUserId,
      })),
      triageSubmissions: triage.items.map((item) => ({
        submittedAt: item.submittedAt,
        questionnaireVersion: item.questionnaireVersion,
        answers: item.answers,
      })),
      guidanceLog: guidance.items,
      assignments: assignments.items.map((item) => ({
        assignmentType: item.assignmentType,
        status: item.status,
        assignedAt: item.assignedAt,
        acceptedAt: item.acceptedAt,
        arrivedAt: item.arrivedAt,
      })),
      locationTrail: locations.items.map((item) => ({
        capturedAt: item.capturedAt,
        lat: item.lat,
        lng: item.lng,
        accuracyMeters: item.accuracyMeters,
      })),
      // Media asset chưa được bật trong Pilot (RECORDING_ENABLED=false), nên
      // danh sách này rỗng cho tới khi chính sách lưu trữ được phê duyệt.
      mediaReferences: [],
      emergencyProfileSnapshot: canViewHealthProfileByRole(context)
        ? context.caseRow.emergency_profile_snapshot
        : null,
    };
  }
}
