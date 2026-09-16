import type { DomainEventType } from '../../../contracts/generated/api-contract';
import type { OutboxEventRow } from '../../../persistence/rows';
import type { PgExecutor } from '../../../persistence/postgres/pg-executor';
import type { TxContext } from '../../../persistence/unit-of-work';
import type { AggregateType, DomainEventInput, StoredDomainEvent } from '../entity/domain-event';
import type { OutboxRepositoryPort } from './outbox.repository.port';

export class PgOutboxRepository implements OutboxRepositoryPort {
  constructor(private readonly executor: PgExecutor) {}

  async append(tx: TxContext, event: DomainEventInput): Promise<StoredDomainEvent> {
    const rows = await this.executor.query<OutboxEventRow>(
      tx,
      `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING *`,
      [event.aggregateType, event.aggregateId, event.eventType, JSON.stringify(event.payload)],
    );
    return toStoredEvent(rows[0]);
  }

  async findUnpublished(limit: number): Promise<StoredDomainEvent[]> {
    // FOR UPDATE SKIP LOCKED: nhiều instance cùng poll mà không giành nhau và
    // không phát trùng một event. Index `idx_outbox_unpublished` phục vụ câu này.
    const rows = await this.executor.query<OutboxEventRow>(
      undefined,
      `SELECT * FROM outbox_events
        WHERE published_at IS NULL
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    return rows.map(toStoredEvent);
  }

  async markPublished(eventId: string): Promise<void> {
    await this.executor.query(
      undefined,
      `UPDATE outbox_events SET published_at = now() WHERE id = $1`,
      [eventId],
    );
  }

  async markFailed(eventId: string): Promise<void> {
    await this.executor.query(
      undefined,
      `UPDATE outbox_events SET retry_count = retry_count + 1 WHERE id = $1`,
      [eventId],
    );
  }

  async countUnpublished(): Promise<number> {
    const row = await this.executor.queryOne<{ count: string }>(
      undefined,
      `SELECT count(*)::text AS count FROM outbox_events WHERE published_at IS NULL`,
    );
    return Number.parseInt(row?.count ?? '0', 10);
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
