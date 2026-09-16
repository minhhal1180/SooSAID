import { Inject, Injectable } from '@nestjs/common';
import type { TxContext } from '../../../persistence/unit-of-work';
import type { DomainEventInput, StoredDomainEvent } from '../entity/domain-event';
import { OUTBOX_REPOSITORY, type OutboxRepositoryPort } from '../repository/outbox.repository.port';

/**
 * API duy nhất mà module nghiệp vụ dùng để phát domain event.
 *
 * Bắt buộc truyền `tx`: event phải nằm cùng transaction với thay đổi nghiệp vụ.
 * Chữ ký hàm được thiết kế để KHÔNG thể gọi ngoài transaction — đó là cách
 * cưỡng chế Outbox Pattern bằng kiểu dữ liệu thay vì bằng tài liệu.
 */
@Injectable()
export class OutboxService {
  constructor(
    @Inject(OUTBOX_REPOSITORY) private readonly repository: OutboxRepositoryPort,
  ) {}

  async append(tx: TxContext, event: DomainEventInput): Promise<StoredDomainEvent> {
    return this.repository.append(tx, event);
  }

  /** Ghi nhiều event trong cùng transaction, giữ nguyên thứ tự truyền vào. */
  async appendAll(tx: TxContext, events: DomainEventInput[]): Promise<StoredDomainEvent[]> {
    const stored: StoredDomainEvent[] = [];
    for (const event of events) {
      stored.push(await this.repository.append(tx, event));
    }
    return stored;
  }

  async backlogSize(): Promise<number> {
    return this.repository.countUnpublished();
  }
}
