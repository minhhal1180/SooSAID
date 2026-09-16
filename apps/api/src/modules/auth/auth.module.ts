import { Module } from '@nestjs/common';
import { AuthController } from './controller/auth.controller';
import { DevAuthController } from './controller/dev-auth.controller';
import { AuthService } from './service/auth.service';
import { OtpService } from './service/otp.service';

/**
 * Module xác thực.
 *
 * `TokenService` và `RateLimiterService` do `SecurityModule` (@Global) cung cấp;
 * `UsersService` do `UsersModule` (@Global) cung cấp.
 */
@Module({
  controllers: [AuthController, DevAuthController],
  providers: [AuthService, OtpService],
  exports: [AuthService],
})
export class AuthModule {}
