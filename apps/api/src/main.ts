import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { APP_CONFIG, loadDotEnv, type AppConfig } from './common/config/app-config';
import { SafeLogger } from './common/logging/safe-logger';

/**
 * Bootstrap API.
 *
 * `.env` được nạp TRƯỚC khi tạo Nest application vì `AppConfig` validate cấu
 * hình ngay lúc khởi tạo module — cấu hình sai phải làm process dừng ở đây, chứ
 * không phải khi request đầu tiên tới.
 */
async function bootstrap(): Promise<void> {
  loadDotEnv(process.cwd());

  const app = await NestFactory.create(AppModule, {
    // Dùng SafeLogger thay logger mặc định để không có đường nào log lọt dữ
    // liệu nhạy cảm (Rule 11).
    logger: new SafeLogger().setContext('bootstrap'),
    bufferLogs: false,
  });

  const config = app.get<AppConfig>(APP_CONFIG);

  app.setGlobalPrefix(config.globalPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      // `whitelist` + `forbidNonWhitelisted`: field lạ bị từ chối chứ không bị
      // âm thầm bỏ qua — người gọi biết ngay mình gửi sai contract.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      // Không trả giá trị đã gửi trong thông báo lỗi: body có thể chứa dữ liệu
      // sức khỏe hoặc toạ độ (Rule 11).
      validationError: { target: false, value: false },
    }),
  );

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
  });

  // Đóng kết nối DB/cache gọn gàng khi nhận SIGTERM (deploy/rolling restart).
  app.enableShutdownHooks();

  await app.listen(config.port);

  const logger = new SafeLogger().setContext('bootstrap');
  logger.log('api_started', {
    event: `port=${config.port} prefix=/${config.globalPrefix}`,
    driver: config.persistence.driver,
    provider: config.video.provider,
  });

  if (config.persistence.driver === 'memory') {
    logger.warn('running_with_non_durable_storage', { driver: 'memory' });
  }
}

void bootstrap();
