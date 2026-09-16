import type { DomainEventType } from '../../../contracts/generated/api-contract';

/**
 * Domain event – đơn vị giao tiếp bất đồng bộ giữa các module (ADR-005).
 *
 * Event được ghi vào bảng `outbox_events` TRONG CÙNG transaction với thay đổi
 * nghiệp vụ, rồi mới được phát đi. Đó là điều kiện để `TC-023` đúng: push
 * provider chết thì ca vẫn commit và thông báo được retry.
 */

export type AggregateType =
  | 'EmergencyCase'
  | 'Triage'
  | 'Video'
  | 'Guidance'
  | 'Dispatch'
  | 'Handover'
  | 'Notification';

/** Event khi được ghi vào outbox (chưa có id/thời điểm do DB cấp). */
export interface DomainEventInput {
  readonly aggregateType: AggregateType;
  readonly aggregateId: string;
  readonly eventType: DomainEventType;
  /**
   * Payload phải TỐI THIỂU (Rule 11 + threat model "Location leakage").
   * Không nhét hồ sơ sức khỏe, số điện thoại đầy đủ hay URL media có chữ ký vào
   * đây: outbox được đọc bởi nhiều handler và dễ lọt vào log.
   */
  readonly payload: Record<string, unknown>;
}

/** Event đã nằm trong outbox, sẵn sàng phát. */
export interface StoredDomainEvent extends DomainEventInput {
  readonly id: string;
  readonly occurredAt: Date;
  readonly retryCount: number;
}
