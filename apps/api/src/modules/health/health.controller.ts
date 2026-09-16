import { Controller, Get, Inject, Module } from '@nestjs/common';
import {
  APP_CONFIG,
  CacheDriver,
  PersistenceDriver,
  type AppConfig,
} from '../../common/config/app-config';
import { Public } from '../../common/security/auth.decorators';
import { UNIT_OF_WORK, type UnitOfWork } from '../../persistence/unit-of-work';
import { OutboxService } from '../outbox/service/outbox.service';
import { VideoSessionModule } from '../video-session/video-session.module';
import { VideoSessionService } from '../video-session/service/video-session.service';

/**
 * Health check (`/v1/health`).
 *
 * Trả về đủ thông tin để runbook quyết định mức độ sự cố (TDD §20) và để UI
 * hiển thị degraded mode một cách trung thực:
 *  - `degraded.persistence = true` khi đang chạy driver `memory` (ADR-004).
 *  - `video.healthy = false` -> client phải bật fallback thoại (TC-009).
 *  - `outboxBacklog` lớn -> event đang tồn đọng, cảnh báo theo runbook.
 *
 * Endpoint là public để load balancer gọi được, nhưng CỐ Ý không lộ chi tiết
 * hạ tầng (host DB, phiên bản, đường dẫn).
 */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly outbox: OutboxService,
    private readonly videoSession: VideoSessionService,
  ) {}

  @Get()
  @Public()
  async health() {
    const [databaseHealthy, videoHealth, outboxBacklog] = await Promise.all([
      this.unitOfWork.healthCheck(),
      this.videoSession.providerHealth(),
      this.outbox.backlogSize().catch(() => -1),
    ]);

    const usingMemoryPersistence =
      this.config.persistence.driver === PersistenceDriver.MEMORY;
    const usingMemoryCache = this.config.cache.driver === CacheDriver.MEMORY;

    return {
      status: databaseHealthy ? 'ok' : 'degraded',
      environment: this.config.nodeEnv,
      database: { healthy: databaseHealthy, driver: this.config.persistence.driver },
      cache: { driver: this.config.cache.driver },
      video: videoHealth,
      outboxBacklog,
      degraded: {
        // Nêu rõ thay vì im lặng: người vận hành phải biết dữ liệu ca cấp cứu
        // hiện KHÔNG bền vững nếu driver memory đang chạy.
        persistence: usingMemoryPersistence,
        cache: usingMemoryCache,
        video: !videoHealth.healthy,
      },
      policy: {
        recordingEnabled: this.config.policy.recordingEnabled,
        guidanceAllowDrillContent: this.config.policy.guidanceAllowDrillContent,
        emsIntegrationMode: this.config.policy.emsIntegrationMode,
      },
    };
  }
}

@Module({
  imports: [VideoSessionModule],
  controllers: [HealthController],
})
export class HealthModule {}
