import { Inject, Injectable } from '@nestjs/common';
import {
  AssignmentStatus,
  AssignmentType,
  CaseStatus,
  DispatchPriority,
  DomainEventType,
} from '../../../contracts/generated/api-contract';
import { DomainErrors } from '../../../common/errors/domain-error';
import type { AuthenticatedActor } from '../../../common/http/request-context';
import { SafeLogger } from '../../../common/logging/safe-logger';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../persistence/unit-of-work';
import { AuditAction, AuditResourceType } from '../../audit-log/entity/audit-action';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { DirectoryService } from '../../directory/service/directory.service';
import { canDispatch } from '../../emergency-case/entity/case-access.policy';
import { findTransition } from '../../emergency-case/entity/case-state-machine';
import { isActiveCase } from '../../emergency-case/entity/emergency-case.entity';
import { EmergencyCaseService } from '../../emergency-case/service/emergency-case.service';
import { OutboxService } from '../../outbox/service/outbox.service';
import {
  DISPATCH_REPOSITORY,
  type DispatchRepositoryPort,
} from '../repository/dispatch.repository';

/**
 * Điều phối kíp xe và người hỗ trợ tại chỗ (FR-008, SOS-024/025/026).
 *
 * Hai nguyên tắc từ TDD §7.1 và FR-008:
 *  1. Assignment có vòng đời riêng. Tạo assignment KHÔNG tự động đổi trạng thái
 *     ca; ca chỉ chuyển sang DISPATCHED khi người điều phối xác nhận.
 *  2. Kíp xe/người hỗ trợ cập nhật EN_ROUTE/ON_SCENE dựa trên assignment của
 *     CHÍNH HỌ, không phải dựa trên vai trò chung chung (TC-012).
 *
 * Câu hỏi "người này có được phân công cho ca không" do `CaseAssignmentChecker`
 * (module riêng, @Global) trả lời, để tránh vòng phụ thuộc với `emergency-case`.
 */
@Injectable()
export class DispatchService {
  private readonly logger = new SafeLogger().setContext('dispatch');

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(DISPATCH_REPOSITORY) private readonly repository: DispatchRepositoryPort,
    private readonly emergencyCaseService: EmergencyCaseService,
    private readonly directory: DirectoryService,
    private readonly outbox: OutboxService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Danh sách ứng viên điều phối cho dashboard (W03 – Dispatch Drawer). */
  async listCandidates(caseId: string, actor: AuthenticatedActor) {
    const context = await this.emergencyCaseService.buildAccessContext(caseId, actor);
    if (!canDispatch(context)) {
      throw DomainErrors.forbidden('Bạn không được phép điều phối cho ca này.', { caseId });
    }

    return this.directory.listDispatchCandidates(
      context.caseRow.latest_location,
      context.caseRow.service_area_id,
    );
  }

  async createAssignment(
    caseId: string,
    actor: AuthenticatedActor,
    input: { targetType: 'ambulance_unit' | 'local_responder'; targetId: string; priority?: DispatchPriority },
  ) {
    const context = await this.emergencyCaseService.buildAccessContext(caseId, actor);
    if (!canDispatch(context)) {
      await this.auditLog.recordDenied({
        action: AuditAction.DISPATCH_CREATED,
        resourceType: AuditResourceType.DISPATCH_ASSIGNMENT,
        caseId,
      });
      throw DomainErrors.forbidden('Bạn không được phép điều phối cho ca này.', { caseId });
    }

    if (!isActiveCase(context.caseRow.status)) {
      throw DomainErrors.conflict('Ca đã kết thúc, không điều phối thêm được.', {
        caseId,
        status: context.caseRow.status,
      });
    }

    const target = await this.resolveTarget(input.targetType, input.targetId);

    const assignment = await this.unitOfWork.runInTransaction(async (tx) => {
      const row = await this.repository.create(tx, {
        caseId,
        assignmentType: target.assignmentType,
        ambulanceUnitId: target.ambulanceUnitId,
        responderId: target.responderId,
        priority: input.priority ?? DispatchPriority.NORMAL,
        assignedBy: actor.userId,
      });

      await this.outbox.append(tx, {
        aggregateType: 'Dispatch',
        aggregateId: row.id,
        eventType: DomainEventType.DISPATCH_CREATED,
        payload: {
          caseId,
          assignmentId: row.id,
          assignmentType: row.assignment_type,
          targetId: input.targetId,
          priority: row.priority,
        },
      });

      // Ca chuyển sang DISPATCHED nếu cạnh này hợp lệ từ trạng thái hiện tại.
      // Không ép: ca đang EN_ROUTE mà điều thêm một kíp nữa thì không được lùi lại.
      if (findTransition(context.caseRow.status, CaseStatus.DISPATCHED)) {
        await this.emergencyCaseService.transitionWithinTransaction(tx, {
          caseRow: context.caseRow,
          toStatus: CaseStatus.DISPATCHED,
          actor: actor.roles,
          actorUserId: actor.userId,
          reason: null,
          metadata: { assignmentId: row.id },
        });
      }

      return row;
    });

    await this.auditLog.record({
      action: AuditAction.DISPATCH_CREATED,
      resourceType: AuditResourceType.DISPATCH_ASSIGNMENT,
      resourceId: assignment.id,
      caseId,
      metadata: { assignmentId: assignment.id, assignmentType: assignment.assignment_type },
    });

    this.logger.log('dispatch_created', {
      caseId,
      assignmentId: assignment.id,
      status: assignment.status,
    });

    return toAssignmentView(assignment);
  }

  async listByCase(caseId: string, actor: AuthenticatedActor) {
    const context = await this.emergencyCaseService.buildAccessContext(caseId, actor);
    if (!canDispatch(context) && !context.isAssignedToCase) {
      throw DomainErrors.forbidden('Bạn không được phép xem điều phối của ca này.', { caseId });
    }
    const rows = await this.repository.listByCase(caseId);
    return { items: rows.map(toAssignmentView) };
  }

  /** Nhiệm vụ đang mở của người dùng hiện tại – màn hình chính của Crew PWA. */
  async listMyAssignments(actor: AuthenticatedActor) {
    const rows = await this.repository.listActiveByUser(actor.userId);
    return { items: rows.map(toAssignmentView) };
  }

  /**
   * Kíp xe/người hỗ trợ cập nhật tiến độ.
   *
   * Cập nhật assignment và (nếu hợp lệ) kéo theo trạng thái ca — nhưng kiểm tra
   * quyền dựa trên "assignment này có phải của bạn không", chứ không phải chỉ
   * dựa trên vai trò (TC-012, TC-013).
   */
  async updateAssignmentStatus(
    assignmentId: string,
    actor: AuthenticatedActor,
    nextStatus: AssignmentStatus,
  ) {
    const assignment = await this.repository.findById(assignmentId);
    if (!assignment) throw DomainErrors.notFound('phân công điều phối', { assignmentId });

    const isMine = await this.repository.isUserAssignedToCase(assignment.case_id, actor.userId);
    if (!isMine) {
      throw DomainErrors.forbidden('Đây không phải nhiệm vụ được giao cho bạn.', { assignmentId });
    }

    const expected = this.requirePreviousStatus(nextStatus, assignment.status);
    const caseRow = await this.emergencyCaseService.requireCaseRow(assignment.case_id);

    const updated = await this.unitOfWork.runInTransaction(async (tx) => {
      const row = await this.repository.updateStatusIfCurrent(
        tx,
        assignmentId,
        expected,
        nextStatus,
        actor.userId,
      );
      if (!row) {
        throw DomainErrors.conflict('Trạng thái nhiệm vụ đã thay đổi. Hãy tải lại.', {
          assignmentId,
        });
      }

      await this.outbox.append(tx, {
        aggregateType: 'Dispatch',
        aggregateId: assignmentId,
        eventType: DomainEventType.DISPATCH_STATUS_CHANGED,
        payload: { caseId: assignment.case_id, assignmentId, status: nextStatus },
      });

      // Ánh xạ mốc của assignment sang trạng thái ca, chỉ khi cạnh hợp lệ.
      const caseStatusTarget = ASSIGNMENT_TO_CASE_STATUS[nextStatus];
      if (caseStatusTarget && findTransition(caseRow.status, caseStatusTarget)) {
        await this.emergencyCaseService.transitionWithinTransaction(tx, {
          caseRow,
          toStatus: caseStatusTarget,
          actor: actor.roles,
          actorUserId: actor.userId,
          reason: null,
          metadata: { assignmentId },
        });
      }

      return row;
    });

    await this.auditLog.record({
      action: AuditAction.DISPATCH_STATUS_CHANGED,
      resourceType: AuditResourceType.DISPATCH_ASSIGNMENT,
      resourceId: assignmentId,
      caseId: assignment.case_id,
      metadata: { assignmentId, status: nextStatus },
    });

    return toAssignmentView(updated);
  }

  /**
   * Kiểm tra mục tiêu điều phối tồn tại và ĐỦ ĐIỀU KIỆN.
   * Responder chưa xác thực/không sẵn sàng được repository trả về `null` — với
   * người điều phối, họ đơn giản là không tồn tại (TC-013).
   */
  private async resolveTarget(
    targetType: 'ambulance_unit' | 'local_responder',
    targetId: string,
  ): Promise<{
    assignmentType: AssignmentType;
    ambulanceUnitId: string | null;
    responderId: string | null;
  }> {
    if (targetType === 'ambulance_unit') {
      const unit = await this.directory.findAmbulanceUnitById(targetId);
      if (!unit) throw DomainErrors.notFound('kíp xe cấp cứu');
      return {
        assignmentType: AssignmentType.AMBULANCE_UNIT,
        ambulanceUnitId: unit.id,
        responderId: null,
      };
    }

    const responder = await this.directory.findVerifiedAvailableResponderById(targetId);
    if (!responder) {
      throw DomainErrors.notFound('người hỗ trợ đã xác thực và đang sẵn sàng');
    }
    return {
      assignmentType: AssignmentType.LOCAL_RESPONDER,
      ambulanceUnitId: null,
      responderId: responder.id,
    };
  }

  /** Trạng thái trước bắt buộc của mỗi bước – vòng đời assignment là tuyến tính. */
  private requirePreviousStatus(
    next: AssignmentStatus,
    current: AssignmentStatus,
  ): AssignmentStatus {
    const expected = ASSIGNMENT_PREVIOUS_STATUS[next];
    if (!expected) {
      throw DomainErrors.validation(`Không hỗ trợ chuyển nhiệm vụ sang trạng thái ${next}.`);
    }
    if (current !== expected) {
      throw DomainErrors.conflict(
        `Nhiệm vụ đang ở trạng thái ${current}, không chuyển sang ${next} được.`,
        { status: current },
      );
    }
    return expected;
  }
}

/** Vòng đời assignment: PENDING -> ACCEPTED -> EN_ROUTE -> ARRIVED -> COMPLETED. */
const ASSIGNMENT_PREVIOUS_STATUS: Partial<Record<AssignmentStatus, AssignmentStatus>> = {
  [AssignmentStatus.ACCEPTED]: AssignmentStatus.PENDING,
  [AssignmentStatus.REJECTED]: AssignmentStatus.PENDING,
  [AssignmentStatus.EN_ROUTE]: AssignmentStatus.ACCEPTED,
  [AssignmentStatus.ARRIVED]: AssignmentStatus.EN_ROUTE,
  [AssignmentStatus.COMPLETED]: AssignmentStatus.ARRIVED,
};

/** Mốc của assignment kéo theo trạng thái ca tương ứng (TDD §7.1). */
const ASSIGNMENT_TO_CASE_STATUS: Partial<Record<AssignmentStatus, CaseStatus>> = {
  [AssignmentStatus.EN_ROUTE]: CaseStatus.EN_ROUTE,
  [AssignmentStatus.ARRIVED]: CaseStatus.ON_SCENE,
};

function toAssignmentView(row: {
  id: string;
  case_id: string;
  assignment_type: AssignmentType;
  ambulance_unit_id: string | null;
  responder_id: string | null;
  status: AssignmentStatus;
  priority: string;
  assigned_at: Date;
  accepted_at: Date | null;
  arrived_at: Date | null;
  completed_at: Date | null;
}) {
  return {
    id: row.id,
    caseId: row.case_id,
    assignmentType: row.assignment_type,
    ambulanceUnitId: row.ambulance_unit_id,
    responderId: row.responder_id,
    status: row.status,
    priority: row.priority,
    assignedAt: row.assigned_at.toISOString(),
    acceptedAt: row.accepted_at?.toISOString() ?? null,
    arrivedAt: row.arrived_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}
