import { Global, Module } from '@nestjs/common';
import { RateLimiterService } from './rate-limiter.service';
import { TokenService } from './token.service';

/**
 * Hạ tầng bảo mật dùng chung.
 *
 * @Global vì `JwtAuthGuard` (đăng ký toàn cục), `AuthModule` và
 * `RealtimeGateway` đều cần `TokenService`; `auth` và `emergency-case` đều cần
 * `RateLimiterService`.
 */
@Global()
@Module({
  providers: [TokenService, RateLimiterService],
  exports: [TokenService, RateLimiterService],
})
export class SecurityModule {}
