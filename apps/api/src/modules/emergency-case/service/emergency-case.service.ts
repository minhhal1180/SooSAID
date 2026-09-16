import { Inject, Injectable } from '@nestjs/common';
import {
  ApiErrorCode,
  CaseStatus,
  NoteType,
  TriggerSource,
  type EmergencyCaseView,
} from '../../../contracts/generated/api-contract';
import { APP_CONFIG, type AppConfig } from '../../../common/config/app-config';
import { DomainError, DomainErrors } from '../../../common/errors/domain-error';
import type { AuthenticatedActor } from '../../../common/http/request-context';
import { IdempotencyService } from '../../../common/idempotency/idempotency.service';
import { SafeLogger } from '../../../common/logging/safe-logger';
import { RateLimiterService, RateLimitRules } from '../../../common/security/rate-limiter.service';
import type { EmergencyCaseRow } from '../../../persistence/rows';
import { UNIT_OF_WORK, type TxContext, type UnitOfWork } from '../../../persistence/unit-of-work';
import { AuditAction, AuditResourceType } from '../../audit-log/entity/audit-action';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { DirectoryService } from '../../directory/service/directory.service';
import { OutboxService } from '../../outbox/service/outbox.service';
import {
  canAddCaseNote,
  canViewCase,
  canViewPreciseLocation,
  type CaseAccessContext,
} from '../entity/case-access.policy';
import {
  SYSTEM_ACTOR,
  assertTransitionAllowed,
  type TransitionActor,
} from '../entity/case-state-machine';
import { toEmergencyCaseView } from '../entity/emergency-case.entity';
import {
  caseAcceptedEvent,
  caseCreatedEvent,
  caseStatusChangedEvent,
} from '../event/emergency-case.events';
import {
  EMERGENCY_CASE_REPOSITORY,
  type EmergencyCaseRepositoryPort,
} from '../repository/emergency-case.repository.port';
import {
  CASE_ASSIGNMENT_CHECKER_PORT,
  EMERGENCY_PROFILE_SNAPSHOT_PORT,
  type CaseAssignmentCheckerPort,
  type EmergencyProfileSnapshotPort,
} from './case-collaboration.ports';

/**
 * Nghiệp vụ ca cấp cứu – trái tim của giải pháp.
 *
 * Thứ tự trong `createCase` bám sát Rule 7.2 (SOS Button Flow):
 *   1. Create emergency case   5. Send alert (outbox -> notification)
 *   2. Capture timestamp       6. Connect support (đẩy vào hàng đợi operator)
 *   3. Get GPS location        7. Start video session (module video-session)
 *   4. Generate case ID/code   8. Save timeline (case_status_history)
 *
 * Bước 7 KHÔNG nằm trong transaction tạo ca: gọi video provider là I/O ra ngoài,
 * nếu nó chậm hoặc chết thì ca cấp cứu vẫn phải được tạo (FR-007, TC-009).
 */

/** Định danh endpoint dùng làm scope cho Idempotency-Key. */
const CREATE_CASE_ENDPOINT = 'POST /v1/emergency-cases';
/** Mã HTTP lưu kèm response idempotent. */
const HTTP_CREATED = 201;

/** Số ca tối đa trả về trong hàng đợi một lần. */
const QUEUE_PAGE_SIZE = 100;
/** Số ca tối đa trong lịch sử cá nhân (màn hình M10). */
const CASE_HISTORY_LIMIT = 50;

/** Trạng thái được coi là "đang chờ/đang xử lý" trên dashboard operator. */
const OPERATOR_QUEUE_STATUSES: readonly CaseStatus[] = [
  CaseStatus.QUEUED,
  CaseStatus.ACCEPTED,
  CaseStatus.VIDEO_CONNECTED,
  CaseStatus.DISPATCHED,
  CaseStatus.EN_ROUTE,
  CaseStatus.ON_SCENE,
  CaseStatus.HANDOVER_PENDING,
];

export interface CreateCaseCommand {
  readonly deviceId: string;
  readonly callerUserId: string | null;
  readonly triggerSource: TriggerSource;
  readonly numberOfPatients: number;
  readonly accessNote: string | null;
  readonly mediaConsent: boolean;
  readonly location: {
    lat: number;
    lng: number;
    accuracyMeters: number | null;
    capturedAt: string;
    addressText: string | null;
    accessNote: string | null;
  };
  readonly idempotencyKey: string;
}

@Injectable()
export class EmergencyCaseService {
  private readonly logger = new SafeLogger().setContext('emergency-case');

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(EMERGENCY_CASE_REPOSITORY) private readonly repository: EmergencyCaseRepositoryPort,
    @Inject(EMERGENCY_PROFILE_SNAPSHOT_PORT)
    private readonly profileSnapshot: EmergencyProfileSnapshotPort,
    @Inject(CASE_ASSIGNMENT_CHECKER_PORT)
    private readonly assignmentChecker: CaseAssignmentCheckerPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly outbox: OutboxService,
    private readonly auditLog: AuditLogService,
    private readonly directory: DirectoryService,
    private readonly rateLimiter: RateLimiterService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // -------------------------------------------------------------------------
  // Tạo ca (Rule 7.2)
  // -------------------------------------------------------------------------

  async createCase(command: CreateCaseCommand): Promise<EmergencyCaseView> {
    // Chống trùng TRƯỚC mọi thứ khác: một lần retry không được tính vào rate
    // limit và không được tạo ca thứ hai (FR-002, TC-002, TC-003).
    const requestHash = this.idempotency.hashRequest({
      deviceId: command.deviceId,
      location: command.location,
      triggerSource: command.triggerSource,
      numberOfPatients: command.numberOfPatients,
    });
    const replay = await this.idempotency.findReplay(
      command.idempotencyKey,
      CREATE_CASE_ENDPOINT,
      requestHash,
    );
    if (replay) {
      this.logger.log('case_create_idempotent_replay', { deviceId: command.deviceId });
      return replay.responseBody as unknown as EmergencyCaseView;
    }

    // Chống lạm dụng theo thiết bị. Fail-open khi cache lỗi — chặn một ca cấp
    // cứu thật vì Redis chết là đánh đổi sai (TC-027).
    await this.rateLimiter.consume(
      RateLimitRules.sosCreate(this.config.rateLimit.sosPerHour),
      command.deviceId,
    );

    // Bước 2: thời điểm sự cố lấy từ thiết bị nhưng KHÔNG tin tuyệt đối — đồng
    // hồ máy có thể sai. Nếu lệch quá xa, dùng giờ server và ghi lại độ lệch.
    const occurredAt = this.resolveOccurredAt(command.location.capturedAt);

    const point = { lat: command.location.lat, lng: command.location.lng };

    // Bước 3: xác định service area để định tuyến hàng đợi. Ngoài vùng cấu hình
    // thì vẫn tạo ca (null), tổng đài trung tâm xử lý.
    const serviceArea = await this.directory.resolveServiceArea(point);

    // Ảnh chụp hồ sơ sức khỏe – chỉ khi người dùng đã đồng ý chia sẻ (TC-015).
    const snapshot = command.callerUserId
      ? await this.profileSnapshot.snapshotForCase(command.callerUserId)
      : null;

    const created = await this.unitOfWork.runInTransaction(async (tx) => {
      // Đặt chỗ idempotency key TRONG transaction: nếu hai request song song
      // cùng key, chỉ một cái qua được UNIQUE constraint, cái còn lại rollback
      // và không để lại ca thừa.
      await this.idempotency.reserve(tx, {
        key: command.idempotencyKey,
        userId: command.callerUserId,
        endpoint: CREATE_CASE_ENDPOINT,
        requestHash,
      });

      // Bước 1 + 4: tạo ca, mã ca do repository cấp phát (không trùng).
      const row = await this.repository.create(tx, {
        callerUserId: command.callerUserId,
        deviceId: command.deviceId,
        serviceAreaId: serviceArea?.id ?? null,
        triggerSource: command.triggerSource,
        numberOfPatients: command.numberOfPatients,
        location: point,
        accuracyMeters: command.location.accuracyMeters,
        addressText: command.location.addressText,
        accessNote: command.accessNote ?? command.location.accessNote,
        mediaConsent: command.mediaConsent,
        emergencyProfileSnapshot: snapshot as Record<string, unknown> | null,
        occurredAt,
      });

      // Bước 8 (phần đầu): ghi mốc đầu tiên của timeline.
      await this.repository.appendStatusHistory(tx, {
        caseId: row.id,
        fromStatus: null,
        toStatus: CaseStatus.CREATED,
        reason: null,
        changedBy: command.callerUserId,
        metadata: { triggerSource: command.triggerSource },
      });

      // Bước 6: CREATED -> QUEUED do hệ thống thực hiện ngay sau khi persist
      // xong, đúng tiền điều kiện trong TDD §7.1.
      const queued = await this.transitionWithinTransaction(tx, {
        caseRow: row,
        toStatus: CaseStatus.QUEUED,
        actor: SYSTEM_ACTOR,
        actorUserId: null,
        reason: null,
        metadata: { serviceAreaResolved: serviceArea !== null },
      });

      // Bước 5: phát cảnh báo qua outbox. Cùng transaction nên không thể có
      // chuyện "ca đã tạo nhưng không ai được báo" (TC-023).
      await this.outbox.append(
        tx,
        caseCreatedEvent({
          caseId: queued.id,
          code: queued.code,
          serviceAreaId: queued.service_area_id,
          triggerSource: queued.trigger_source,
          callerUserId: queued.caller_user_id,
        }),
      );

      await this.auditLog.record(
        {
          action: AuditAction.CASE_CREATED,
          resourceType: AuditResourceType.EMERGENCY_CASE,
          resourceId: queued.id,
          caseId: queued.id,
          metadata: { triggerSource: command.triggerSource },
        },
        tx,
      );

      // Lưu response để lần retry sau trả lại đúng kết quả này (TC-002).
      await this.idempotency.complete(
        tx,
        command.idempotencyKey,
        HTTP_CREATED,
        toEmergencyCaseView(queued) as unknown as Record<string, unknown>,
      );

      return queued;
    });

    this.logger.log('case_created', {
      caseId: created.id,
      caseCode: created.code,
      status: created.status,
      serviceAreaId: created.service_area_id ?? undefined,
    });

    return toEmergencyCaseView(created);
  }

  // -------------------------------------------------------------------------
  // Đọc ca
  // -------------------------------------------------------------------------

  /** Lấy ca kèm kiểm tra quyền và ghi audit (Rule 5.1). */
  async getCaseForActor(caseId: string, actor: AuthenticatedActor): Promise<EmergencyCaseView> {
    const context = await this.buildAccessContext(caseId, actor);

    if (!canViewCase(context)) {
      await this.auditLog.recordDenied({
        action: AuditAction.CASE_VIEWED,
        resourceType: AuditResourceType.EMERGENCY_CASE,
        resourceId: caseId,
        caseId,
      });
      // Trả 404 thay vì 403: không xác nhận sự tồn tại của ca ngoài scope (TC-025).
      throw DomainErrors.notFound('ca cấp cứu', { caseId });
    }

    await this.auditLog.record({
      action: AuditAction.CASE_VIEWED,
      resourceType: AuditResourceType.EMERGENCY_CASE,
      resourceId: caseId,
      caseId,
    });

    const view = toEmergencyCaseView(context.caseRow);
    // Người không được xem vị trí chính xác vẫn thấy ca, nhưng không thấy toạ độ
    // (threat model: "Location leakage" – field-level authorization).
    return canViewPreciseLocation(context) ? view : { ...view, latestLocation: null };
  }

  /** Bản ghi thô cho module khác đã tự kiểm tra quyền (video, dispatch, handover). */
  async requireCaseRow(caseId: string): Promise<EmergencyCaseRow> {
    const row = await this.repository.findById(caseId);
    if (!row) throw DomainErrors.notFound('ca cấp cứu', { caseId });
    return row;
  }

  async buildAccessContext(
    caseId: string,
    actor: AuthenticatedActor,
  ): Promise<CaseAccessContext> {
    const caseRow = await this.requireCaseRow(caseId);
    const isAssignedToCase = await this.assignmentChecker.isUserAssignedToCase(
      caseId,
      actor.userId,
    );
    return { actor, caseRow, isAssignedToCase };
  }

  async listQueue(
    actor: AuthenticatedActor,
    filter: { statuses?: CaseStatus[]; serviceAreaId?: string },
  ): Promise<EmergencyCaseView[]> {
    // Scope service area của actor là giới hạn cứng; tham số `serviceAreaId`
    // chỉ được phép THU HẸP thêm, không mở rộng.
    const scopeIds =
      filter.serviceAreaId && this.isWithinActorScope(actor, filter.serviceAreaId)
        ? [filter.serviceAreaId]
        : [...actor.serviceAreaIds];

    const rows = await this.repository.listQueue({
      statuses: filter.statuses?.length ? filter.statuses : OPERATOR_QUEUE_STATUSES,
      serviceAreaIds: scopeIds,
      limit: QUEUE_PAGE_SIZE,
    });

    await this.auditLog.record({
      action: AuditAction.CASE_QUEUE_VIEWED,
      resourceType: AuditResourceType.EMERGENCY_CASE,
      metadata: { resultCount: rows.length },
    });

    return rows.map(toEmergencyCaseView);
  }

  async listMyCases(actor: AuthenticatedActor): Promise<EmergencyCaseView[]> {
    const rows = await this.repository.listByCaller(actor.userId, CASE_HISTORY_LIMIT);
    return rows.map(toEmergencyCaseView);
  }

  async getTimeline(caseId: string, actor: AuthenticatedActor) {
    const context = await this.buildAccessContext(caseId, actor);
    if (!canViewCase(context)) throw DomainErrors.notFound('ca cấp cứu', { caseId });

    const [history, notes] = await Promise.all([
      this.repository.listStatusHistory(caseId),
      this.repository.listNotes(caseId),
    ]);

    return {
      statusHistory: history.map((row) => ({
        at: row.changed_at.toISOString(),
        fromStatus: row.from_status,
        toStatus: row.to_status,
        reason: row.reason,
        changedBy: row.changed_by,
        metadata: row.metadata,
      })),
      notes: notes.map((row) => ({
        id: row.id,
        at: row.created_at.toISOString(),
        noteType: row.note_type,
        text: row.text,
        authorUserId: row.author_user_id,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Nhận ca (FR-005, TC-007)
  // -------------------------------------------------------------------------

  async acceptCase(caseId: string, actor: AuthenticatedActor): Promise<EmergencyCaseView> {
    const context = await this.buildAccessContext(caseId, actor);
    if (!canViewCase(context)) throw DomainErrors.notFound('ca cấp cứu', { caseId });

    // Kiểm tra transition trước khi ghi để trả lỗi rõ ràng khi ca không còn ở
    // trạng thái QUEUED (ví dụ đã bị đánh dấu báo nhầm).
    assertTransitionAllowed({
      from: context.caseRow.status,
      to: CaseStatus.ACCEPTED,
      actor: actor.roles,
    });

    const accepted = await this.unitOfWork.runInTransaction(async (tx) => {
      const row = await this.repository.acceptIfUnassigned(tx, caseId, actor.userId);
      if (!row) {
        // Người khác đã nhận trong khoảnh khắc giữa lúc đọc và lúc ghi.
        throw new DomainError(
          ApiErrorCode.CASE_ALREADY_ACCEPTED,
          'Ca này đã được người khác tiếp nhận.',
          [],
          { caseId },
        );
      }

      await this.repository.appendStatusHistory(tx, {
        caseId,
        fromStatus: CaseStatus.QUEUED,
        toStatus: CaseStatus.ACCEPTED,
        reason: null,
        changedBy: actor.userId,
        metadata: {},
      });

      await this.outbox.appendAll(tx, [
        caseAcceptedEvent({ caseId, operatorId: actor.userId }),
        caseStatusChangedEvent({
          caseId,
          from: CaseStatus.QUEUED,
          to: CaseStatus.ACCEPTED,
          actorUserId: actor.userId,
        }),
      ]);

      await this.auditLog.record(
        {
          action: AuditAction.CASE_ACCEPTED,
          resourceType: AuditResourceType.EMERGENCY_CASE,
          resourceId: caseId,
          caseId,
        },
        tx,
      );

      return row;
    });

    this.logger.log('case_accepted', { caseId, operatorId: actor.userId });
    return toEmergencyCaseView(accepted);
  }

  // -------------------------------------------------------------------------
  // Đổi trạng thái (FR-012)
  // -------------------------------------------------------------------------

  async transitionStatus(
    caseId: string,
    actor: AuthenticatedActor,
    toStatus: CaseStatus,
    reason: string | null,
  ): Promise<EmergencyCaseView> {
    const context = await this.buildAccessContext(caseId, actor);
    if (!canViewCase(context)) throw DomainErrors.notFound('ca cấp cứu', { caseId });

    // Người dân chỉ được hủy ca DO CHÍNH MÌNH tạo. `canViewCase` cho phép nhiều
    // vai trò khác đọc ca, nên ràng buộc quyền sở hữu phải kiểm tra riêng ở đây.
    if (toStatus === CaseStatus.CANCELLED && context.caseRow.caller_user_id !== actor.userId) {
      throw DomainErrors.forbidden('Chỉ người tạo ca mới được hủy ca này.', { caseId });
    }

    const updated = await this.unitOfWork.runInTransaction((tx) =>
      this.transitionWithinTransaction(tx, {
        caseRow: context.caseRow,
        toStatus,
        actor: actor.roles,
        actorUserId: actor.userId,
        reason,
        metadata: {},
      }),
    );

    await this.auditLog.record({
      action: AuditAction.CASE_STATUS_CHANGED,
      resourceType: AuditResourceType.EMERGENCY_CASE,
      resourceId: caseId,
      caseId,
      metadata: { fromStatus: context.caseRow.status, toStatus },
    });

    return toEmergencyCaseView(updated);
  }

  /**
   * Chuyển trạng thái bên trong một transaction đang mở.
   *
   * Public cho module khác dùng lại (video-session chuyển ACCEPTED ->
   * VIDEO_CONNECTED, dispatch chuyển -> DISPATCHED) mà vẫn đi qua đúng một chỗ
   * kiểm tra state machine.
   */
  async transitionWithinTransaction(
    tx: TxContext,
    input: {
      caseRow: EmergencyCaseRow;
      toStatus: CaseStatus;
      actor: TransitionActor;
      actorUserId: string | null;
      reason: string | null;
      metadata: Record<string, unknown>;
    },
  ): Promise<EmergencyCaseRow> {
    const fromStatus = input.caseRow.status;

    assertTransitionAllowed({
      from: fromStatus,
      to: input.toStatus,
      actor: input.actor,
      reason: input.reason,
    });

    const updated = await this.repository.updateStatusIfCurrent(
      tx,
      input.caseRow.id,
      fromStatus,
      input.toStatus,
      input.actorUserId,
    );

    if (!updated) {
      // Trạng thái đã đổi giữa lúc đọc và lúc ghi -> optimistic lock thất bại.
      throw new DomainError(
        ApiErrorCode.CASE_INVALID_TRANSITION,
        'Trạng thái ca đã thay đổi. Hãy tải lại và thử lại.',
        [{ expectedFrom: fromStatus }],
        { caseId: input.caseRow.id },
      );
    }

    await this.repository.appendStatusHistory(tx, {
      caseId: updated.id,
      fromStatus,
      toStatus: input.toStatus,
      reason: input.reason,
      changedBy: input.actorUserId,
      metadata: input.metadata,
    });

    await this.outbox.append(
      tx,
      caseStatusChangedEvent({
        caseId: updated.id,
        from: fromStatus,
        to: input.toStatus,
        actorUserId: input.actorUserId,
      }),
    );

    return updated;
  }

  /**
   * Cập nhật ảnh chụp vị trí mới nhất trên bản ghi ca.
   *
   * Module `location` sở hữu bảng `case_locations` (chuỗi mẫu vị trí theo thời
   * gian) nhưng KHÔNG được ghi thẳng vào bảng `emergency_cases` (Rule 2.2), nên
   * nó gọi hàm này trong cùng transaction.
   */
  async applyLocationSnapshot(
    tx: TxContext,
    input: {
      caseId: string;
      lat: number;
      lng: number;
      accuracyMeters: number | null;
      addressText: string | null;
      accessNote: string | null;
    },
  ): Promise<void> {
    await this.repository.updateLatestLocation(
      tx,
      input.caseId,
      { lat: input.lat, lng: input.lng },
      input.accuracyMeters,
      input.addressText,
      input.accessNote,
    );
  }

  // -------------------------------------------------------------------------
  // Ghi chú chuyên môn/vận hành
  // -------------------------------------------------------------------------

  async addNote(
    caseId: string,
    actor: AuthenticatedActor,
    text: string,
    noteType: NoteType,
  ): Promise<{ id: string; createdAt: string }> {
    const context = await this.buildAccessContext(caseId, actor);
    if (!canAddCaseNote(context)) {
      await this.auditLog.recordDenied({
        action: AuditAction.CASE_NOTE_ADDED,
        resourceType: AuditResourceType.EMERGENCY_CASE,
        resourceId: caseId,
        caseId,
      });
      throw DomainErrors.forbidden('Bạn không được phép ghi chú vào ca này.', { caseId });
    }

    const note = await this.unitOfWork.runInTransaction((tx) =>
      this.repository.addNote(tx, {
        caseId,
        authorUserId: actor.userId,
        noteType,
        text,
      }),
    );

    await this.auditLog.record({
      action: AuditAction.CASE_NOTE_ADDED,
      resourceType: AuditResourceType.EMERGENCY_CASE,
      resourceId: caseId,
      caseId,
      metadata: { noteType },
    });

    return { id: note.id, createdAt: note.created_at.toISOString() };
  }

  // -------------------------------------------------------------------------
  // Tiện ích nội bộ
  // -------------------------------------------------------------------------

  /**
   * Đồng hồ thiết bị lệch quá `MAX_CLOCK_SKEW_MS` thì dùng giờ server.
   * Một `capturedAt` sai lệch hàng giờ sẽ làm mã ca sai ngày và làm hỏng thứ tự
   * timeline trong hồ sơ bàn giao.
   */
  private resolveOccurredAt(capturedAt: string): Date {
    const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;
    const now = new Date();
    const claimed = new Date(capturedAt);

    if (Number.isNaN(claimed.getTime())) return now;
    if (Math.abs(claimed.getTime() - now.getTime()) > MAX_CLOCK_SKEW_MS) {
      this.logger.warn('device_clock_skew_detected', {
        durationMs: Math.abs(claimed.getTime() - now.getTime()),
      });
      return now;
    }
    return claimed;
  }

  private isWithinActorScope(actor: AuthenticatedActor, serviceAreaId: string): boolean {
    return actor.serviceAreaIds.length === 0 || actor.serviceAreaIds.includes(serviceAreaId);
  }
}
