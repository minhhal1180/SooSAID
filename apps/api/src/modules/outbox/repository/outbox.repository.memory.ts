import { randomUUID } from 'node:crypto';
import type { DomainEventType } from '../../../contracts/generated/api-contract';
import type { MemoryDb } from '../../../persistence/memory/memory-db';
import type { OutboxEventRow } from '../../../persistence/rows';
import type { TxContext } from '../../../persistence/unit-of-work';
import type { AggregateType, DomainEventInput, StoredDomainEvent } from '../entity/domain-event';
import type { OutboxRepositoryPort } from './outbox.repository.port';

/** Cài đặt outbox cho driver `memory` (ADR-004) – chỉ dùng local demo/test. */
export class MemoryOutboxRepository implements OutboxRepositoryPort {
  constructor(private readonly db: MemoryDb) {}

  async append(_tx: TxContext, event: DomainEventInput): Promise<StoredDomainEvent> {
    const now = new Date();
    const row: OutboxEventRow = {
      id: randomUUID(),
      aggregate_type: event.aggregateType,
      aggregate_id: event.aggregateId,
      event_type: event.eventType,
      payload: event.payload,
      published_at: null,
      retry_count: 0,
      created_at: now,
      updated_at: now,
      created_by: null,
      updated_by: null,
    };
    this.db.outboxEvents.insert(row);
    return toStoredEvent(row);
  }

  async findUnpublished(limit: number): Promise<StoredDomainEvent[]> {
    return this.db.outboxEvents
      .findMany((row) => row.published_at === null)
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .slice(0, limit)
      .map(toStoredEvent);
  }

  async markPublished(eventId: string): Promise<void> {
    this.db.outboxEvents.update(eventId, { published_at: new Date() });
  }

  async markFailed(eventId: string): Promise<void> {
    const row = this.db.outboxEvents.findById(eventId);
    if (row) this.db.outboxEvents.update(eventId, { retry_count: row.retry_count + 1 });
  }

  async countUnpublished(): Promise<number> {
    return this.db.outboxEvents.findMany((row) => row.published_at === null).length;
  }
}

function toStoredEvent(row: OutboxEventRow): StoredDomainEvent {
  return {
    id: row.id,
    aggregateType: row.aggregate_type as AggregateType,
    aggregateId: row.aggregate_id,
    eventType: row.event_type as DomainEventType,
    payload: row.payload,
    occurredAt: row.created_at,
    retryCount: row.retry_count,
  };
}
