import { createHash, randomUUID } from 'node:crypto';
import type { MemoryDb } from '../../../persistence/memory/memory-db';
import type { PgExecutor } from '../../../persistence/postgres/pg-executor';
import type { NotificationDeliveryRow } from '../../../persistence/rows';

/**
 * Theo dõi từng lần gửi thông báo (SOS-027, TC-014).
 *
 * Idempotency: outbox bảo đảm at-least-once, nên handler có thể chạy lại cùng
 * một event. Khoá `(case_id, template_code, recipient_hash)` bảo đảm người thân
 * không nhận hai lần cùng một thông báo cho cùng một ca.
 */

export const DeliveryStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

export interface DeliveryKey {
  readonly caseId: string | null;
  readonly templateCode: string;
  readonly recipient: string;
}

export interface NotificationRepositoryPort {
  /**
   * Tạo bản ghi gửi nếu chưa tồn tại. Trả `null` nếu đã có (đã gửi hoặc đang
   * gửi) — caller bỏ qua, không gửi lại.
   */
  createIfAbsent(input: {
    key: DeliveryKey;
    channel: string;
  }): Promise<NotificationDeliveryRow | null>;

  markSent(deliveryId: string, providerMessageId: string | null): Promise<void>;
  markFailed(deliveryId: string, errorCode: string): Promise<void>;
  listByCase(caseId: string): Promise<NotificationDeliveryRow[]>;
}

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');

/**
 * Cột `recipient` lưu BĂM của địa chỉ nhận, không lưu số điện thoại/push token
 * thô: bảng này được đọc khi tra cứu sự cố gửi tin và không cần biết địa chỉ thật.
 */
export function hashRecipient(recipient: string): string {
  return createHash('sha256').update(recipient).digest('hex');
}

export class PgNotificationRepository implements NotificationRepositoryPort {
  constructor(private readonly executor: PgExecutor) {}

  async createIfAbsent(input: {
    key: DeliveryKey;
    channel: string;
  }): Promise<NotificationDeliveryRow | null> {
    const recipientHash = hashRecipient(input.key.recipient);

    const existing = await this.executor.queryOne<NotificationDeliveryRow>(
      undefined,
      `SELECT * FROM notification_deliveries
        WHERE case_id IS NOT DISTINCT FROM $1
          AND template_code = $2
          AND recipient = $3`,
      [input.key.caseId, input.key.templateCode, recipientHash],
    );
    if (existing) return null;

    const rows = await this.executor.query<NotificationDeliveryRow>(
      undefined,
      `INSERT INTO notification_deliveries
         (case_id, channel, recipient, template_code, status, attempt_count)
       VALUES ($1, $2, $3, $4, $5, 1)
       RETURNING *`,
      [input.key.caseId, input.channel, recipientHash, input.key.templateCode, DeliveryStatus.PENDING],
    );
    return rows[0];
  }

  async markSent(deliveryId: string, providerMessageId: string | null): Promise<void> {
    await this.executor.query(
      undefined,
      `UPDATE notification_deliveries
          SET status = $2, provider_message_id = $3, sent_at = now()
        WHERE id = $1`,
      [deliveryId, DeliveryStatus.SENT, providerMessageId],
    );
  }

  async markFailed(deliveryId: string, errorCode: string): Promise<void> {
    await this.executor.query(
      undefined,
      `UPDATE notification_deliveries
          SET status = $2, last_error = $3, attempt_count = attempt_count + 1
        WHERE id = $1`,
      [deliveryId, DeliveryStatus.FAILED, errorCode],
    );
  }

  async listByCase(caseId: string): Promise<NotificationDeliveryRow[]> {
    return this.executor.query<NotificationDeliveryRow>(
      undefined,
      `SELECT * FROM notification_deliveries WHERE case_id = $1 ORDER BY created_at ASC`,
      [caseId],
    );
  }
}

export class MemoryNotificationRepository implements NotificationRepositoryPort {
  constructor(private readonly db: MemoryDb) {}

  async createIfAbsent(input: {
    key: DeliveryKey;
    channel: string;
  }): Promise<NotificationDeliveryRow | null> {
    const recipientHash = hashRecipient(input.key.recipient);

    const existing = this.db.notificationDeliveries.findOne(
      (row) =>
        row.case_id === input.key.caseId &&
        row.template_code === input.key.templateCode &&
        row.recipient === recipientHash,
    );
    if (existing) return null;

    const now = new Date();
    return this.db.notificationDeliveries.insert({
      id: randomUUID(),
      case_id: input.key.caseId,
      channel: input.channel,
      recipient: recipientHash,
      template_code: input.key.templateCode,
      status: DeliveryStatus.PENDING,
      provider_message_id: null,
      attempt_count: 1,
      last_error: null,
      sent_at: null,
      created_at: now,
      updated_at: now,
      created_by: null,
      updated_by: null,
    } satisfies NotificationDeliveryRow);
  }

  async markSent(deliveryId: string, providerMessageId: string | null): Promise<void> {
    this.db.notificationDeliveries.update(deliveryId, {
      status: DeliveryStatus.SENT,
      provider_message_id: providerMessageId,
      sent_at: new Date(),
    });
  }

  async markFailed(deliveryId: string, errorCode: string): Promise<void> {
    const row = this.db.notificationDeliveries.findById(deliveryId);
    if (!row) return;
    this.db.notificationDeliveries.update(deliveryId, {
      status: DeliveryStatus.FAILED,
      last_error: errorCode,
      attempt_count: row.attempt_count + 1,
    });
  }

  async listByCase(caseId: string): Promise<NotificationDeliveryRow[]> {
    return this.db.notificationDeliveries
      .findMany((row) => row.case_id === caseId)
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  }
}
