import type { TxContext } from '../../../persistence/unit-of-work';
import type { DomainEventInput, StoredDomainEvent } from '../entity/domain-event';

/**
 * Port của outbox. Chỉ `OutboxService` và `OutboxDispatcher` được dùng — module
 * nghiệp vụ khác đi qua `OutboxService.append()` (Rule 2.2).
 */
export interface OutboxRepositoryPort {
  /** Ghi event trong CÙNG transaction với thay đổi nghiệp vụ. `tx` là bắt buộc. */
  append(tx: TxContext, event: DomainEventInput): Promise<StoredDomainEvent>;

  /** Lấy các event chưa phát, cũ nhất trước, để giữ đúng thứ tự xảy ra. */
  findUnpublished(limit: number): Promise<StoredDomainEvent[]>;

  markPublished(eventId: string): Promise<void>;

  /** Ghi nhận một lần phát thất bại để tính backoff và phát hiện event kẹt. */
  markFailed(eventId: string): Promise<void>;

  /** Số event chưa phát – golden signal `outbox backlog` trong runbook. */
  countUnpublished(): Promise<number>;
}

export const OUTBOX_REPOSITORY = Symbol('OUTBOX_REPOSITORY');
