import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { SafeLogger } from '../../common/logging/safe-logger';
import type { TxContext, UnitOfWork } from '../unit-of-work';
import type { PgTxContext } from './pg-executor';

/**
 * Unit of Work cho PostgreSQL – transaction thật.
 *
 * Mọi command đổi trạng thái đi qua đây để bản ghi nghiệp vụ và dòng
 * `outbox_events` cùng commit hoặc cùng rollback (ADR-005).
 */
@Injectable()
export class PgUnitOfWork implements UnitOfWork {
  private readonly logger = new SafeLogger().setContext('persistence');

  constructor(private readonly pool: Pool) {}

  async runInTransaction<T>(work: (tx: TxContext) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx: PgTxContext = { driver: 'postgres', client };

    try {
      await client.query('BEGIN');
      const result = await work(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Rollback thất bại thường có nghĩa connection đã hỏng; release() bên
        // dưới sẽ loại nó khỏi pool. Không che lỗi gốc.
        this.logger.error('transaction_rollback_failed', { result: 'FAILURE' });
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async onShutdown(): Promise<void> {
    await this.pool.end();
  }
}
