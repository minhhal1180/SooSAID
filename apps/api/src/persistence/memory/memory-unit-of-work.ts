import { Injectable } from '@nestjs/common';
import type { TxContext, UnitOfWork } from '../unit-of-work';

/** Handle transaction giả cho driver `memory`. */
export const MEMORY_TX: TxContext = { driver: 'memory' };

/**
 * Unit of Work cho driver `memory` (ADR-004).
 *
 * KHÔNG có transaction thật: `runInTransaction` chỉ chạy `work` rồi trả kết quả.
 * Nếu `work` ném lỗi giữa chừng, các thay đổi đã ghi vào Map SẼ Ở LẠI — khác
 * hoàn toàn PostgreSQL. Đây là lý do integration test bắt buộc chạy trên driver
 * `postgres` trước khi một tính năng được coi là Done (Rule 15).
 */
@Injectable()
export class MemoryUnitOfWork implements UnitOfWork {
  async runInTransaction<T>(work: (tx: TxContext) => Promise<T>): Promise<T> {
    return work(MEMORY_TX);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async onShutdown(): Promise<void> {
    // Không có kết nối nào để đóng.
  }
}
