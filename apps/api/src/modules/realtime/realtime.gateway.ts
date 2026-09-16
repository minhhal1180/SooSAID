import { randomUUID } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import {
  DomainEventType,
  UserRole,
  type RealtimeEventEnvelope,
} from '../../contracts/generated/api-contract';
import { APP_CONFIG, type AppConfig } from '../../common/config/app-config';
import { Inject } from '@nestjs/common';
import { SafeLogger } from '../../common/logging/safe-logger';
import { TokenService } from '../../common/security/token.service';
import { caseRealtimeChannel } from '../emergency-case/entity/emergency-case.entity';
import { EmergencyCaseService } from '../emergency-case/service/emergency-case.service';
import { canViewCase } from '../emergency-case/entity/case-access.policy';
import type { StoredDomainEvent } from '../outbox/entity/domain-event';
import { DomainEventBus } from '../outbox/service/domain-event-bus.service';

/**
 * Cổng realtime cho dashboard operator và mobile (SOS-016, TDD §10.3).
 *
 * Nguyên tắc quan trọng (TDD §10.3): client **không được** dựng toàn bộ state
 * chỉ từ event push. Mỗi envelope có `sequence`; thấy khoảng trống hoặc vừa
 * reconnect thì client phải fetch snapshot qua REST (TC-010). Realtime là kênh
 * tăng tốc, không phải nguồn sự thật.
 *
 * Bảo mật: handshake phải mang access token hợp lệ; muốn nhận event của một ca
 * thì phải qua đúng `CaseAccessPolicy` như REST — WebSocket không phải cửa sau.
 */

/** Phòng chung cho hàng đợi tổng đài: nhận event ca mới. */
const OPERATOR_QUEUE_ROOM = 'operator:queue';

interface SocketActor {
  userId: string;
  roles: UserRole[];
  serviceAreaIds: string[];
}

@Injectable()
@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new SafeLogger().setContext('realtime');

  /** Số thứ tự event theo ca, để client phát hiện mất event. */
  private readonly sequenceByCase = new Map<string, number>();

  private readonly actorBySocket = new Map<string, SocketActor>();

  constructor(
    private readonly tokenService: TokenService,
    private readonly eventBus: DomainEventBus,
    private readonly emergencyCaseService: EmergencyCaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe('realtime', (event) => this.broadcast(event));
  }

  handleConnection(client: Socket): void {
    const token = extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const claims = this.tokenService.verifyAccessToken(token);
      this.actorBySocket.set(client.id, {
        userId: claims.sub,
        roles: claims.roles,
        serviceAreaIds: claims.serviceAreaIds,
      });

      // Tổng đài/bác sĩ trực tự động vào phòng hàng đợi để thấy ca mới ngay.
      if (
        claims.roles.includes(UserRole.OPERATOR_115) ||
        claims.roles.includes(UserRole.CLINICIAN)
      ) {
        void client.join(OPERATOR_QUEUE_ROOM);
      }

      this.logger.log('realtime_connected', { userId: claims.sub });
    } catch {
      // Không nói rõ lý do từ chối: client chỉ cần biết phải đăng nhập lại.
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.actorBySocket.delete(client.id);
  }

  /**
   * Client đăng ký nhận event của một ca.
   * Quyền được kiểm tra bằng CHÍNH `CaseAccessPolicy` dùng cho REST.
   */
  @SubscribeMessage('case:subscribe')
  async subscribeToCase(
    client: Socket,
    payload: { caseId?: string },
  ): Promise<{ subscribed: boolean; reason?: string }> {
    const actor = this.actorBySocket.get(client.id);
    if (!actor || !payload?.caseId) return { subscribed: false, reason: 'UNAUTHENTICATED' };

    try {
      const context = await this.emergencyCaseService.buildAccessContext(payload.caseId, actor);
      if (!canViewCase(context)) return { subscribed: false, reason: 'FORBIDDEN' };

      await client.join(caseRealtimeChannel(payload.caseId));
      return { subscribed: true };
    } catch {
      return { subscribed: false, reason: 'NOT_FOUND' };
    }
  }

  @SubscribeMessage('case:unsubscribe')
  async unsubscribeFromCase(
    client: Socket,
    payload: { caseId?: string },
  ): Promise<{ unsubscribed: boolean }> {
    if (payload?.caseId) await client.leave(caseRealtimeChannel(payload.caseId));
    return { unsubscribed: true };
  }

  /** Handler đăng ký với `DomainEventBus`: đẩy event tới đúng phòng. */
  private async broadcast(event: StoredDomainEvent): Promise<void> {
    // Server chưa sẵn sàng (ví dụ trong unit test) thì bỏ qua thay vì ném lỗi
    // làm outbox coi event là thất bại.
    if (!this.server) return;

    const caseId = typeof event.payload.caseId === 'string' ? event.payload.caseId : null;
    const envelope: RealtimeEventEnvelope = {
      eventId: event.id || randomUUID(),
      eventType: event.eventType,
      caseId,
      occurredAt: event.occurredAt.toISOString(),
      sequence: caseId ? this.nextSequence(caseId) : 0,
      payload: event.payload,
    };

    if (caseId) {
      this.server.to(caseRealtimeChannel(caseId)).emit('case:event', envelope);
    }

    // Ca mới và đổi trạng thái cũng đẩy tới hàng đợi tổng đài để danh sách tự
    // cập nhật mà không cần polling.
    if (
      event.eventType === DomainEventType.CASE_CREATED ||
      event.eventType === DomainEventType.CASE_STATUS_CHANGED ||
      event.eventType === DomainEventType.CASE_ACCEPTED
    ) {
      this.server.to(OPERATOR_QUEUE_ROOM).emit('queue:event', envelope);
    }
  }

  private nextSequence(caseId: string): number {
    const next = (this.sequenceByCase.get(caseId) ?? 0) + 1;
    this.sequenceByCase.set(caseId, next);
    return next;
  }

  /** Số client đang kết nối – dùng cho health check. */
  get connectedCount(): number {
    return this.actorBySocket.size;
  }
}

/**
 * Token lấy từ `auth.token` trong handshake hoặc header `Authorization`.
 * KHÔNG nhận token qua query string: query string bị ghi vào access log của
 * proxy/CDN (threat model – "không log raw access token").
 */
function extractToken(client: Socket): string | null {
  const fromAuth = client.handshake.auth?.token;
  if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;

  const header = client.handshake.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice('bearer '.length);
  }
  return null;
}
