import type { PgExecutor } from '../../persistence/postgres/pg-executor';
import type { IdempotencyKeyRow } from '../../persistence/rows';
import type { TxContext } from '../../persistence/unit-of-work';
import type { IdempotencyRecord, IdempotencyRepositoryPort } from './idempotency.port';

export class PgIdempotencyRepository implements IdempotencyRepositoryPort {
  constructor(private readonly executor: PgExecutor) {}

  async find(key: string): Promise<IdempotencyRecord | null> {
    const row = await this.executor.queryOne<IdempotencyKeyRow>(
      undefined,
      `SELECT * FROM idempotency_keys WHERE key = $1 AND expires_at > now()`,
      [key],
    );
    return row ? toRecord(row) : null;
  }

  async reserve(
    tx: TxContext,
    input: {
      key: string;
      userId: string | null;
      endpoint: string;
      requestHash: string;
      expiresAt: Date;
    },
  ): Promise<IdempotencyRecord | null> {
    // ON CONFLICT DO NOTHING + RETURNING: chỉ request ĐẦU TIÊN nhận được dòng.
    // Đây là chỗ UNIQUE constraint của DB làm việc thay cho khoá ứng dụng, nên
    // đúng cả khi chạy nhiều instance API (TC-002).
    const row = await this.executor.queryOne<IdempotencyKeyRow>(
      tx,
      `INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $2)
       ON CONFLICT ON CONSTRAINT uq_idempotency_keys_key DO NOTHING
       RETURNING *`,
      [input.key, input.userId, input.endpoint, input.requestHash, input.expiresAt],
    );
    return row ? toRecord(row) : null;
  }

  async complete(
    tx: TxContext,
    key: string,
    responseCode: number,
    responseBody: Record<string, unknown>,
  ): Promise<void> {
    await this.executor.query(
      tx,
      `UPDATE idempotency_keys
          SET response_code = $2, response_body = $3::jsonb
        WHERE key = $1`,
      [key, responseCode, JSON.stringify(responseBody)],
    );
  }

  async deleteExpired(now: Date): Promise<number> {
    const rows = await this.executor.query<{ id: string }>(
      undefined,
      `DELETE FROM idempotency_keys WHERE expires_at <= $1 RETURNING id`,
      [now],
    );
    return rows.length;
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
