import { randomUUID } from 'node:crypto';
import { SafeLogger } from '../../../common/logging/safe-logger';
import type {
  NotificationChannel,
  NotificationProviderPort,
  SendNotificationInput,
  SendNotificationResult,
} from './notification-provider.port';

/**
 * Adapter thông báo mặc định trong Pilot.
 *
 * Không gửi gì ra ngoài: chỉ ghi nhận đã "gửi" để kiểm thử được luồng outbox →
 * notification → delivery tracking (TC-014, TC-023) mà không cần FCM/APNs/SMS.
 *
 * Log chỉ chứa `templateCode` và `channel`; **không** chứa người nhận
 * (push token hay số điện thoại) — Rule 11.
 */
export class MockNotificationProvider implements NotificationProviderPort {
  readonly name = 'mock';

  private readonly logger = new SafeLogger().setContext('notification');

  supports(_channel: NotificationChannel): boolean {
    return true;
  }

  async send(input: SendNotificationInput): Promise<SendNotificationResult> {
    this.logger.log('notification_dispatched', {
      provider: this.name,
      channel: input.channel,
      templateCode: input.templateCode,
      caseId: input.variables.caseId,
    });
    return { delivered: true, providerMessageId: randomUUID(), errorCode: null };
  }
}
