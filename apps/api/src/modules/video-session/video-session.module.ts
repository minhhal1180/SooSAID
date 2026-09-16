import { Module } from '@nestjs/common';
import { APP_CONFIG, VideoProviderName, type AppConfig } from '../../common/config/app-config';
import { SafeLogger } from '../../common/logging/safe-logger';
import { repositoryProvider } from '../../persistence/persistence.module';
import { EmergencyCaseModule } from '../emergency-case/emergency-case.module';
import { VideoSessionController } from './controller/video-session.controller';
import { LiveKitVideoProvider } from './entity/livekit-video.provider';
import { MockVideoProvider } from './entity/mock-video.provider';
import { VIDEO_PROVIDER, type VideoProviderPort } from './entity/video-provider.port';
import {
  MemoryVideoSessionRepository,
  PgVideoSessionRepository,
  VIDEO_SESSION_REPOSITORY,
} from './repository/video-session.repository';
import { VideoSessionService } from './service/video-session.service';

/**
 * Module video. Driver được chọn bằng env `VIDEO_PROVIDER` (ADR-006) — thêm
 * Twilio/Agora chỉ cần một class mới và một nhánh ở đây.
 */
@Module({
  imports: [EmergencyCaseModule],
  controllers: [VideoSessionController],
  providers: [
    repositoryProvider(
      VIDEO_SESSION_REPOSITORY,
      PgVideoSessionRepository,
      MemoryVideoSessionRepository,
    ),
    {
      provide: VIDEO_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): VideoProviderPort => {
        const logger = new SafeLogger().setContext('video-session');

        if (config.video.provider === VideoProviderName.LIVEKIT) {
          logger.log('video_provider_selected', { provider: 'livekit' });
          return new LiveKitVideoProvider(
            config.video.livekitUrl,
            config.video.livekitApiKey,
            config.video.livekitApiSecret,
          );
        }

        logger.warn('video_provider_mock_no_real_media', { provider: 'mock' });
        // Driver mock ký token bằng access secret: nó chỉ dùng nội bộ và không
        // rời khỏi hệ thống, nên không cần secret riêng.
        return new MockVideoProvider(config.auth.accessSecret);
      },
    },
    VideoSessionService,
  ],
  exports: [VideoSessionService],
})
export class VideoSessionModule {}
