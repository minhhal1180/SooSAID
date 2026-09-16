import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { DomainEventType } from '../../../contracts/generated/api-contract';
import { SafeLogger } from '../../../common/logging/safe-logger';
import { UsersService } from '../../users/service/users.service';
import type { StoredDomainEvent } from '../../outbox/entity/domain-event';
import { DomainEventBus } from '../../outbox/service/domain-event-bus.service';
import {
  NotificationChannel,
  NotificationTemplate,
  NOTIFICATION_PROVIDER,
  type NotificationProviderPort,
} from '../entity/notification-provider.port';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepositoryPort,
} from '../repository/notification.repository';

/**
 * Thông báo cho người liên hệ khẩn cấp (FR-009, SOS-027).
 *
 * Module này là **consumer của outbox**: nó đăng ký handler với `DomainEventBus`
 * thay vì được `emergency-case` gọi trực tiếp (Rule 2.1 – Event Driven). Nhờ đó
 * nhà cung cấp push chết cũng không làm hỏng việc tạo ca (TC-023).
 *
 * Nội dung thông báo cố ý tối thiểu: chỉ có mã ca. Không có vị trí, không có
 * tình trạng người bệnh — thông báo hiện trên màn hình khoá (TDD §11.3).
 */
@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new SafeLogger().setContext('notification');

  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repository: NotificationRepositoryPort,
    @Inject(NOTIFICATION_PROVIDER) private readonly provider: NotificationProviderPort,
    private readonly eventBus: DomainEventBus,
    private readonly usersService: UsersService,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe('notification', (event) => this.handleEvent(event));
  }

  private async handleEvent(event: StoredDomainEvent): Promise<void> {
    if (event.eventType !== DomainEventType.CASE_CREATED) return;

    const caseId = readString(event.payload, 'caseId');
    const caseCode = readString(event.payload, 'code');
    const callerUserId = readString(event.payload, 'callerUserId');

    // Ca do tổng đài tạo hộ không có `callerUserId` nên không có danh bạ để báo.
    if (!caseId || !caseCode || !callerUserId) return;

    await this.notifyEmergencyContacts({
      caseId,
      caseCode,
      callerUserId,
      templateCode: NotificationTemplate.EMERGENCY_CONTACT_CASE_CREATED,
    });
  }

  /**
   * Gửi cho người liên hệ khẩn cấp của người tạo ca.
   *
   * Chỉ gửi tới liên hệ đã bật kênh tương ứng (`notify_by_push`/`notify_by_sms`)
   * — đây là opt-in theo FR-009, không phải mặc định gửi hết.
   */
  private async notifyEmergencyContacts(input: {
    caseId: string;
    caseCode: string;
    callerUserId: string;
    templateCode: NotificationTemplate;
  }): Promise<void> {
    const { caseId, caseCode, callerUserId, templateCode } = input;
    const contacts = await this.usersService.listContactsForNotification(callerUserId);

    for (const contact of contacts) {
      const channel = contact.notify_by_push
        ? NotificationChannel.PUSH
        : contact.notify_by_sms
          ? NotificationChannel.SMS
          : null;
      if (!channel) continue;

      const delivery = await this.repository.createIfAbsent({
        key: { caseId, templateCode, recipient: contact.phone },
        channel,
      });
      // `null` = đã có bản ghi cho đúng (ca, mẫu, người nhận) này. Outbox có thể
      // phát lại event; người thân không được nhận hai lần cùng một tin.
      if (!delivery) continue;

      try {
        const result = await this.provider.send({
          channel,
          recipient: contact.phone,
          templateCode,
          variables: { caseId, caseCode },
        });

        if (result.delivered) {
          await this.repository.markSent(delivery.id, result.providerMessageId);
        } else {
          await this.repository.markFailed(delivery.id, result.errorCode ?? 'UNKNOWN');
        }
      } catch (error) {
        // Ghi nhận thất bại nhưng KHÔNG ném lỗi ra ngoài: một người nhận lỗi
        // không được chặn những người còn lại.
        await this.repository.markFailed(
          delivery.id,
          (error as Error)?.name ?? 'PROVIDER_ERROR',
        );
        this.logger.warn('notification_send_failed', { caseId, channel, templateCode });
      }
    }
  }

  async listDeliveriesByCase(caseId: string) {
    const rows = await this.repository.listByCase(caseId);
    return {
      items: rows.map((row) => ({
        id: row.id,
        channel: row.channel,
        templateCode: row.template_code,
        status: row.status,
        attemptCount: row.attempt_count,
        sentAt: row.sent_at?.toISOString() ?? null,
        // KHÔNG trả `recipient`: cột này là băm và cũng không cần lộ ra API.
      })),
    };
  }

}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}
