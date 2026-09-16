import { Inject, Injectable } from '@nestjs/common';
import { DomainErrors } from '../../../common/errors/domain-error';
import { isValidCoordinate } from '../../../common/geo/geo';
import type { AuthenticatedActor } from '../../../common/http/request-context';
import { SafeLogger } from '../../../common/logging/safe-logger';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../persistence/unit-of-work';
import { AuditAction, AuditResourceType } from '../../audit-log/entity/audit-action';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import {
  canViewCase,
  canViewPreciseLocation,
} from '../../emergency-case/entity/case-access.policy';
import { isActiveCase } from '../../emergency-case/entity/emergency-case.entity';
import { caseLocationUpdatedEvent } from '../../emergency-case/event/emergency-case.events';
import { EmergencyCaseService } from '../../emergency-case/service/emergency-case.service';
import { OutboxService } from '../../outbox/service/outbox.service';
import {
  LOCATION_REPOSITORY,
  LocationSource,
  type LocationRepositoryPort,
} from '../repository/location.repository.port';

/**
 * Chuỗi vị trí của ca cấp cứu (FR-003, SOS-012).
 *
 * Mẫu vị trí được lưu **append-only**: mọi mẫu đều giữ lại kèm `accuracyMeters`
 * và `capturedAt`, không ghi đè. Nhân viên trực cần thấy chất lượng tín hiệu
 * thay đổi thế nào, không chỉ điểm cuối cùng (TC-005).
 */

/** Số mẫu tối đa trả về trong một lần đọc lịch sử vị trí. */
const LOCATION_HISTORY_LIMIT = 200;

/** Ngưỡng cảnh báo chất lượng: trên mức này coi là "vị trí chưa đủ chính xác". */
export const LOW_ACCURACY_THRESHOLD_METERS = 100;

export interface AppendLocationCommand {
  readonly caseId: string;
  readonly lat: number;
  readonly lng: number;
  readonly accuracyMeters: number | null;
  readonly altitudeMeters: number | null;
  readonly capturedAt: string;
  readonly addressText: string | null;
  readonly accessNote: string | null;
}

@Injectable()
export class LocationService {
  private readonly logger = new SafeLogger().setContext('location');

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(LOCATION_REPOSITORY) private readonly repository: LocationRepositoryPort,
    private readonly emergencyCaseService: EmergencyCaseService,
    private readonly outbox: OutboxService,
    private readonly auditLog: AuditLogService,
  ) {}

  async appendSample(command: AppendLocationCommand, actor: AuthenticatedActor): Promise<void> {
    const point = { lat: command.lat, lng: command.lng };
    if (!isValidCoordinate(point)) {
      throw DomainErrors.validation('Toạ độ không hợp lệ.', [{ field: 'lat/lng' }]);
    }

    const context = await this.emergencyCaseService.buildAccessContext(command.caseId, actor);
    if (!canViewCase(context)) {
      throw DomainErrors.notFound('ca cấp cứu', { caseId: command.caseId });
    }

    // Ca đã đóng/hủy/báo nhầm không nhận thêm dữ liệu vị trí: dữ liệu đến sau
    // khi ca kết thúc chỉ làm nhiễu hồ sơ bàn giao.
    if (!isActiveCase(context.caseRow.status)) {
      throw DomainErrors.conflict('Ca đã kết thúc, không nhận thêm cập nhật vị trí.', {
        caseId: command.caseId,
        status: context.caseRow.status,
      });
    }

    // Chỉ người tạo ca hoặc người đang xử lý ca được gửi vị trí. Không để người
    // ngoài bơm toạ độ giả vào một ca thật (threat model: "Data tampering").
    const isCaller = context.caseRow.caller_user_id === actor.userId;
    if (!isCaller && !canViewPreciseLocation(context)) {
      throw DomainErrors.forbidden('Bạn không được phép cập nhật vị trí cho ca này.', {
        caseId: command.caseId,
      });
    }

    const capturedAt = new Date(command.capturedAt);

    await this.unitOfWork.runInTransaction(async (tx) => {
      await this.repository.append(tx, {
        caseId: command.caseId,
        location: point,
        accuracyMeters: command.accuracyMeters,
        altitudeMeters: command.altitudeMeters,
        addressText: command.addressText,
        accessNote: command.accessNote,
        source: isCaller ? LocationSource.MOBILE_GPS : LocationSource.OPERATOR_CORRECTION,
        capturedAt: Number.isNaN(capturedAt.getTime()) ? new Date() : capturedAt,
        createdBy: actor.userId,
      });

      // Ảnh chụp trên bản ghi ca do module emergency-case ghi (Rule 2.2).
      await this.emergencyCaseService.applyLocationSnapshot(tx, {
        caseId: command.caseId,
        lat: command.lat,
        lng: command.lng,
        accuracyMeters: command.accuracyMeters,
        addressText: command.addressText,
        accessNote: command.accessNote,
      });

      await this.outbox.append(
        tx,
        caseLocationUpdatedEvent({
          caseId: command.caseId,
          lat: command.lat,
          lng: command.lng,
          accuracyMeters: command.accuracyMeters,
          capturedAt: command.capturedAt,
        }),
      );
    });

    await this.auditLog.record({
      action: AuditAction.CASE_LOCATION_APPENDED,
      resourceType: AuditResourceType.EMERGENCY_CASE,
      resourceId: command.caseId,
      caseId: command.caseId,
      // Ghi CHẤT LƯỢNG tín hiệu, không ghi toạ độ (Rule 11).
      metadata: { accuracyMeters: command.accuracyMeters },
    });

    if (
      command.accuracyMeters !== null &&
      command.accuracyMeters > LOW_ACCURACY_THRESHOLD_METERS
    ) {
      this.logger.warn('location_low_accuracy', {
        caseId: command.caseId,
        count: command.accuracyMeters,
      });
    }
  }

  /** Lịch sử vị trí kèm chỉ báo chất lượng cho dashboard (TC-005). */
  async listHistory(caseId: string, actor: AuthenticatedActor) {
    const context = await this.emergencyCaseService.buildAccessContext(caseId, actor);
    if (!canViewPreciseLocation(context)) {
      throw DomainErrors.forbidden('Bạn không được phép xem vị trí chi tiết của ca này.', {
        caseId,
      });
    }

    const rows = await this.repository.listByCase(caseId, LOCATION_HISTORY_LIMIT);
    return {
      items: rows.map((row) => ({
        lat: row.location.lat,
        lng: row.location.lng,
        accuracyMeters: row.accuracy_meters,
        altitudeMeters: row.altitude_meters,
        capturedAt: row.captured_at.toISOString(),
        receivedAt: row.received_at.toISOString(),
        addressText: row.address_text,
        accessNote: row.access_note,
        source: row.source,
        lowAccuracy:
          row.accuracy_meters !== null && row.accuracy_meters > LOW_ACCURACY_THRESHOLD_METERS,
      })),
    };
  }
}
