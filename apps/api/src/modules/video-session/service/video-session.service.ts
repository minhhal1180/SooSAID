import { Inject, Injectable } from '@nestjs/common';
import {
  CaseStatus,
  DomainEventType,
  UserRole,
  VideoParticipantRole,
} from '../../../contracts/generated/api-contract';
import { APP_CONFIG, type AppConfig } from '../../../common/config/app-config';
import { DomainErrors } from '../../../common/errors/domain-error';
import type { AuthenticatedActor } from '../../../common/http/request-context';
import { SafeLogger } from '../../../common/logging/safe-logger';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../persistence/unit-of-work';
import { AuditAction, AuditResourceType } from '../../audit-log/entity/audit-action';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { canJoinVideoSession } from '../../emergency-case/entity/case-access.policy';
import { isActiveCase } from '../../emergency-case/entity/emergency-case.entity';
import { EmergencyCaseService } from '../../emergency-case/service/emergency-case.service';
import { SYSTEM_ACTOR, findTransition } from '../../emergency-case/entity/case-state-machine';
import { OutboxService } from '../../outbox/service/outbox.service';
import { VIDEO_PROVIDER, type VideoProviderPort } from '../entity/video-provider.port';
import {
  VIDEO_SESSION_REPOSITORY,
  type VideoSessionRepositoryPort,
} from '../repository/video-session.repository';

/**
 * Phiên video của ca cấp cứu (FR-006, SOS-020).
 *
 * Ba nguyên tắc chi phối thiết kế:
 *  1. Không gọi SDK trực tiếp — tất cả qua `VideoProviderPort` (Rule 8.1).
 *  2. Video lỗi KHÔNG làm hỏng ca: trả `PROVIDER_UNAVAILABLE` để client bật
 *     fallback thoại/gọi trực tiếp, trạng thái ca giữ nguyên (FR-007, TC-009).
 *  3. Ghi hình mặc định TẮT; muốn bật cần đồng thời cờ hệ thống VÀ đồng ý của
 *     người dùng (TC-016, TC-017).
 */

export interface VideoJoinInfo {
  provider: string;
  room: string;
  token: string;
  serverUrl: string;
  expiresAt: string;
  recordingEnabled: boolean;
}

@Injectable()
export class VideoSessionService {
  private readonly logger = new SafeLogger().setContext('video-session');

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(VIDEO_SESSION_REPOSITORY) private readonly repository: VideoSessionRepositoryPort,
    @Inject(VIDEO_PROVIDER) private readonly videoProvider: VideoProviderPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly emergencyCaseService: EmergencyCaseService,
    private readonly outbox: OutboxService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Cấp thông tin tham gia phòng video cho một người trên một ca.
   * Bước 7 của Rule 7.2.
   */
  async joinSession(
    caseId: string,
    actor: AuthenticatedActor,
    requestedRole?: VideoParticipantRole,
  ): Promise<VideoJoinInfo> {
    const context = await this.emergencyCaseService.buildAccessContext(caseId, actor);

    if (!canJoinVideoSession(context)) {
      await this.auditLog.recordDenied({
        action: AuditAction.VIDEO_TOKEN_ISSUED,
        resourceType: AuditResourceType.VIDEO_SESSION,
        caseId,
      });
      throw DomainErrors.forbidden('Bạn không được phép tham gia phiên video của ca này.', {
        caseId,
      });
    }

    if (!isActiveCase(context.caseRow.status)) {
      throw DomainErrors.conflict('Ca đã kết thúc, không mở được phiên video.', {
        caseId,
        status: context.caseRow.status,
      });
    }

    // Vai trò trong phòng do SERVER quyết định từ role thật của người dùng.
    // Nhận `requestedRole` từ client chỉ để kiểm tra khớp, không để tin.
    const participantRole = this.resolveParticipantRole(actor, context.caseRow.caller_user_id);
    if (requestedRole && requestedRole !== participantRole) {
      throw DomainErrors.forbidden('Vai trò yêu cầu không khớp với quyền của bạn.', { caseId });
    }

    const recordingEnabled = this.shouldEnableRecording(context.caseRow.media_consent);

    try {
      const room = await this.videoProvider.createRoom(caseId);

      const session =
        (await this.repository.findActiveByCase(caseId)) ??
        (await this.unitOfWork.runInTransaction((tx) =>
          this.repository.create(tx, {
            caseId,
            provider: this.videoProvider.name,
            providerRoomId: room.roomId,
            recordingEnabled,
            createdBy: actor.userId,
          }),
        ));

      const token = await this.videoProvider.issueParticipantToken({
        roomId: room.roomId,
        userId: actor.userId,
        role: participantRole,
        ttlSeconds: this.config.video.tokenTtlSeconds,
      });

      await this.unitOfWork.runInTransaction(async (tx) => {
        await this.repository.markStarted(tx, session.id, actor.userId);

        await this.outbox.append(tx, {
          aggregateType: 'Video',
          aggregateId: session.id,
          eventType: DomainEventType.VIDEO_SESSION_STARTED,
          payload: {
            caseId,
            sessionId: session.id,
            provider: this.videoProvider.name,
            recordingEnabled,
          },
        });

        // ACCEPTED -> VIDEO_CONNECTED là transition của HỆ THỐNG (TDD §7.1).
        // Chỉ chuyển khi cạnh này hợp lệ; ở trạng thái khác (đã DISPATCHED
        // chẳng hạn) việc tham gia video không được làm lùi trạng thái ca.
        if (findTransition(context.caseRow.status, CaseStatus.VIDEO_CONNECTED)) {
          await this.emergencyCaseService.transitionWithinTransaction(tx, {
            caseRow: context.caseRow,
            toStatus: CaseStatus.VIDEO_CONNECTED,
            actor: SYSTEM_ACTOR,
            actorUserId: actor.userId,
            reason: null,
            metadata: { videoSessionId: session.id },
          });
        }
      });

      await this.auditLog.record({
        action: AuditAction.VIDEO_TOKEN_ISSUED,
        resourceType: AuditResourceType.VIDEO_SESSION,
        resourceId: session.id,
        caseId,
        // KHÔNG ghi token vào audit (Rule 11).
        metadata: { provider: this.videoProvider.name, role: participantRole },
      });

      return {
        provider: this.videoProvider.name,
        room: room.roomId,
        token: token.token,
        serverUrl: token.serverUrl,
        expiresAt: token.expiresAt.toISOString(),
        recordingEnabled,
      };
    } catch (error) {
      // Provider lỗi -> 503 + client bật fallback. Dữ liệu ca không bị ảnh hưởng.
      this.logger.error('video_provider_failed', {
        caseId,
        provider: this.videoProvider.name,
        errorCode: (error as Error)?.name ?? 'UnknownError',
      });
      throw DomainErrors.providerUnavailable('video', { caseId });
    }
  }

  async endSession(caseId: string, actor: AuthenticatedActor): Promise<void> {
    const context = await this.emergencyCaseService.buildAccessContext(caseId, actor);
    if (!canJoinVideoSession(context)) {
      throw DomainErrors.forbidden('Bạn không được phép kết thúc phiên video của ca này.', {
        caseId,
      });
    }

    const session = await this.repository.findActiveByCase(caseId);
    if (!session) return;

    await this.unitOfWork.runInTransaction((tx) =>
      this.repository.markEnded(tx, session.id, actor.userId),
    );
  }

  /** Trạng thái provider cho health check và cho UI hiển thị degraded mode. */
  async providerHealth(): Promise<{ provider: string; healthy: boolean }> {
    try {
      return { provider: this.videoProvider.name, healthy: await this.videoProvider.healthCheck() };
    } catch {
      return { provider: this.videoProvider.name, healthy: false };
    }
  }

  /**
   * Ghi hình chỉ bật khi CẢ HAI điều kiện đúng (TC-016, TC-017):
   *  - Cờ hệ thống `RECORDING_ENABLED` (chỉ bật sau khi policy được phê duyệt).
   *  - Người dùng đã đồng ý cho ca này (`media_consent`).
   */
  private shouldEnableRecording(mediaConsentGranted: boolean): boolean {
    return this.config.policy.recordingEnabled && mediaConsentGranted;
  }

  private resolveParticipantRole(
    actor: AuthenticatedActor,
    callerUserId: string | null,
  ): VideoParticipantRole {
    if (actor.userId === callerUserId) return VideoParticipantRole.CALLER;
    if (actor.roles.includes(UserRole.CLINICIAN)) return VideoParticipantRole.CLINICIAN;
    if (actor.roles.includes(UserRole.OPERATOR_115)) return VideoParticipantRole.OPERATOR;

    // Không rơi vào nhánh nào = không nên tới được đây vì policy đã chặn; ném
    // lỗi thay vì đoán một vai trò mặc định.
    throw DomainErrors.forbidden('Không xác định được vai trò của bạn trong phiên video.');
  }
}
