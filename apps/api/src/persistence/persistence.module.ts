import { Global, Inject, Module, type OnApplicationShutdown, type Provider } from '@nestjs/common';
import { Pool } from 'pg';
import { APP_CONFIG, PersistenceDriver, type AppConfig } from '../common/config/app-config';
import { SafeLogger } from '../common/logging/safe-logger';
import { MemoryDb } from './memory/memory-db';
import { MemoryUnitOfWork } from './memory/memory-unit-of-work';
import { PgExecutor } from './postgres/pg-executor';
import { PgUnitOfWork } from './postgres/pg-unit-of-work';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work';

/**
 * Chọn driver persistence một lần lúc bootstrap (ADR-004).
 *
 * Module nghiệp vụ chỉ inject token repository của mình; chúng không biết — và
 * không được biết — driver nào đang chạy.
 */

/** Thời gian tối đa chờ một connection rảnh trước khi coi là DB quá tải. */
const PG_CONNECTION_TIMEOUT_MS = 5_000;
/** Đóng connection nhàn rỗi để không giữ slot của Postgres vô ích. */
const PG_IDLE_TIMEOUT_MS = 30_000;
const PG_MAX_POOL_SIZE = 20;

/**
 * Tạo provider cho một repository có hai cài đặt.
 *
 * Dùng ở `providers` của từng feature module:
 * ```ts
 * repositoryProvider(EMERGENCY_CASE_REPOSITORY, PgEmergencyCaseRepository, MemoryEmergencyCaseRepository)
 * ```
 *
 * Kiểu trả về cố ý là `unknown`: DI của Nest định danh bằng token chứ không bằng
 * kiểu, và việc hai cài đặt cùng thoả một port đã được cưỡng chế ở chỗ khai báo
 * class (`implements XRepositoryPort`). Ràng buộc quan hệ kiểu ở đây chỉ khiến
 * TypeScript phải suy luận một supertype chung và báo lỗi giả.
 */
export function repositoryProvider(
  token: symbol,
  PostgresImpl: new (executor: PgExecutor) => unknown,
  MemoryImpl: new (db: MemoryDb) => unknown,
): Provider {
  return {
    provide: token,
    inject: [APP_CONFIG, PgExecutor, MemoryDb],
    useFactory: (config: AppConfig, executor: PgExecutor, memoryDb: MemoryDb): unknown =>
      config.persistence.driver === PersistenceDriver.POSTGRES
        ? new PostgresImpl(executor)
        : new MemoryImpl(memoryDb),
  };
}

/**
 * Pool dùng chung. Khi chạy driver `memory`, pool vẫn được tạo nhưng KHÔNG kết
 * nối (pg chỉ mở connection ở lần query đầu tiên), nên không cần Postgres chạy.
 */
function createPool(config: AppConfig): Pool {
  return new Pool({
    connectionString: config.persistence.databaseUrl || undefined,
    max: PG_MAX_POOL_SIZE,
    idleTimeoutMillis: PG_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: PG_CONNECTION_TIMEOUT_MS,
  });
}

export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    MemoryDb,
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createPool(config),
    },
    {
      provide: PgExecutor,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new PgExecutor(pool),
    },
    {
      provide: UNIT_OF_WORK,
      inject: [APP_CONFIG, PG_POOL],
      useFactory: (config: AppConfig, pool: Pool): UnitOfWork => {
        const logger = new SafeLogger().setContext('persistence');

        if (config.persistence.driver === PersistenceDriver.POSTGRES) {
          logger.log('persistence_driver_selected', { driver: 'postgres' });
          return new PgUnitOfWork(pool);
        }

        // Cảnh báo mỗi lần khởi động: dữ liệu ca cấp cứu KHÔNG bền vững.
        logger.warn('persistence_driver_memory_non_durable', { driver: 'memory' });
        return new MemoryUnitOfWork();
      },
    },
  ],
  exports: [UNIT_OF_WORK, MemoryDb, PgExecutor],
})
export class PersistenceModule implements OnApplicationShutdown {
  constructor(@Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork) {}

  async onApplicationShutdown(): Promise<void> {
    await this.unitOfWork.onShutdown();
  }
}
