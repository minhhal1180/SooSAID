import { randomUUID } from 'node:crypto';
import type { MemoryDb } from '../../persistence/memory/memory-db';
import type { IdempotencyKeyRow } from '../../persistence/rows';
import type { TxContext } from '../../persistence/unit-of-work';
import type { IdempotencyRecord, IdempotencyRepositoryPort } from './idempotency.port';

export class MemoryIdempotencyRepository implements IdempotencyRepositoryPort {
  constructor(private readonly db: MemoryDb) {}

  async find(key: string): Promise<IdempotencyRecord | null> {
    const row = this.db.idempotencyKeys.findOne(
      (candidate) => candidate.key === key && candidate.expires_at > new Date(),
    );
    return row ? toRecord(row) : null;
  }

  async reserve(
    _tx: TxContext,
    input: {
      key: string;
      userId: string | null;
      endpoint: string;
      requestHash: string;
      expiresAt: Date;
    },
  ): Promise<IdempotencyRecord | null> {
    // Node chạy đơn luồng nên đoạn kiểm tra rồi ghi này là atomic trong phạm vi
    // một process. Không đúng khi chạy nhiều instance — thêm một lý do driver
    // `memory` chỉ dành cho local (ADR-004).
    if (this.db.idempotencyKeys.findOne((row) => row.key === input.key)) return null;

    const now = new Date();
    const row: IdempotencyKeyRow = {
      id: randomUUID(),
      key: input.key,
      user_id: input.userId,
      endpoint: input.endpoint,
      request_hash: input.requestHash,
      response_code: null,
      response_body: null,
      expires_at: input.expiresAt,
      created_at: now,
      updated_at: now,
      created_by: input.userId,
      updated_by: null,
    };
    this.db.idempotencyKeys.insert(row);
    return toRecord(row);
  }

  async complete(
    _tx: TxContext,
    key: string,
    responseCode: number,
    responseBody: Record<string, unknown>,
  ): Promise<void> {
    const row = this.db.idempotencyKeys.findOne((candidate) => candidate.key === key);
    if (row) {
      this.db.idempotencyKeys.update(row.id, {
        response_code: responseCode,
        response_body: responseBody,
      });
    }
  }

  async deleteExpired(now: Date): Promise<number> {
    const expired = this.db.idempotencyKeys.findMany((row) => row.expires_at <= now);
    for (const row of expired) this.db.idempotencyKeys.delete(row.id);
    return expired.length;
  }
}

function toRecord(row: IdempotencyKeyRow): IdempotencyRecord {
  return {
    key: row.key,
    endpoint: row.endpoint,
    requestHash: row.request_hash,
    responseCode: row.response_code,
    responseBody: row.response_body,
    expiresAt: row.expires_at,
  };
}
