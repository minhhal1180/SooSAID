import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, CacheDriver, type AppConfig } from '../config/app-config';
import { SafeLogger } from '../logging/safe-logger';
import { CACHE_PORT, type CachePort } from './cache.port';
import { MemoryCacheAdapter } from './memory-cache.adapter';
import { RedisCacheAdapter } from './redis-cache.adapter';

/**
 * Chọn driver cache một lần lúc bootstrap (ADR-007).
 * Service nghiệp vụ chỉ inject `CACHE_PORT`, không biết driver nào đang chạy.
 */
@Global()
@Module({
  providers: [
    {
      provide: CACHE_PORT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): CachePort => {
        const logger = new SafeLogger().setContext('cache');

        if (config.cache.driver === CacheDriver.REDIS) {
          logger.log('cache_driver_selected', { driver: 'redis' });
          return new RedisCacheAdapter(config.cache.redisUrl);
        }

        logger.warn('cache_driver_memory_non_distributed', { driver: 'memory' });
        return new MemoryCacheAdapter();
      },
    },
  ],
  exports: [CACHE_PORT],
})
export class CacheModule implements OnApplicationShutdown {
  constructor(@Inject(CACHE_PORT) private readonly cache: CachePort) {}

  async onApplicationShutdown(): Promise<void> {
    await this.cache.onShutdown();
  }
}
