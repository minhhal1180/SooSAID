import { Injectable } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import type { TxContext } from '../unit-of-work';

/** TxContext của driver postgres: bọc client đang giữ transaction. */
export interface PgTxContext extends TxContext {
  readonly driver: 'postgres';
  readonly client: PoolClient;
}

export function isPgTx(tx: TxContext | undefined): tx is PgTxContext {
  return tx?.driver === 'postgres';
}

/**
 * Điểm thực thi SQL duy nhất của driver postgres.
 *
 * Nhận `tx` tuỳ chọn: có `tx` thì chạy trên client đang giữ transaction (để ghi
 * nghiệp vụ và ghi outbox nằm chung một commit — ADR-005); không có thì lấy
 * connection mới từ pool.
 *
 * Luôn dùng tham số hoá ($1, $2...). Không nối chuỗi SQL ở bất kỳ đâu.
 */
@Injectable()
export class PgExecutor {
  constructor(readonly pool: Pool) {}

  async query<R>(tx: TxContext | undefined, sql: string, params: unknown[] = []): Promise<R[]> {
    const runner = isPgTx(tx) ? tx.client : this.pool;
    const result = await runner.query(sql, params as never[]);
    return result.rows as R[];
  }

  async queryOne<R>(
    tx: TxContext | undefined,
    sql: string,
    params: unknown[] = [],
  ): Promise<R | null> {
    const rows = await this.query<R>(tx, sql, params);
    return rows[0] ?? null;
  }
}
