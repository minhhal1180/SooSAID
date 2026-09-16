import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CacheModule } from './common/cache/cache.module';
import { APP_CONFIG, buildAppConfig, type AppConfig } from './common/config/app-config';
import { DomainExceptionFilter } from './common/http/domain-exception.filter';
import { RequestContextMiddleware } from './common/http/request-context';
import { ResponseEnvelopeInterceptor } from './common/http/response-envelope.interceptor';
import { IdempotencyModule } from './common/idempotency/idempotency.service';
import { JwtAuthGuard } from './common/security/jwt-auth.guard';
import { RolesGuard } from './common/security/roles.guard';
import { SecurityModule } from './common/security/security.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { AuthModule } from './modules/auth/auth.module';
import { DirectoryModule } from './modules/directory/directory.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { CaseAssignmentCheckerModule } from './modules/dispatch/service/case-assignment-checker.service';
import { EmergencyCaseModule } from './modules/emergency-case/emergency-case.module';
import { FirstAidGuideModule } from './modules/first-aid-guide/first-aid-guide.module';
import { HealthModule } from './modules/health/health.controller';
import { LocationModule } from './modules/location/location.module';
import { MedicalHandoverModule } from './modules/medical-handover/medical-handover.module';
import { NotificationModule } from './modules/notification/notification.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { TriageModule } from './modules/triage/triage.module';
import { UsersModule } from './modules/users/users.module';
import { VideoSessionModule } from './modules/video-session/video-session.module';
import { MemorySeederModule } from './persistence/memory/memory-seeder';
import { PersistenceModule } from './persistence/persistence.module';

/**
 * Cấu hình ứng dụng, nạp một lần và chia sẻ toàn cục.
 * Tách thành module riêng để mọi module khác inject `APP_CONFIG` mà không phải
 * import gì thêm.
 */
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: (): AppConfig => buildAppConfig() }],
  exports: [APP_CONFIG],
})
class ConfigModule {}

/**
 * Modular Monolith (Rule 2.1 / ADR-005).
 *
 * Thứ tự import phản ánh tầng phụ thuộc: hạ tầng -> hạ tầng dùng chung ->
 * domain. Các module @Global (`UsersModule`, `DispatchModule`'s checker,
 * `OutboxModule`, `AuditLogModule`) cung cấp port mà domain phụ thuộc vào,
 * nên chúng phải có mặt trước domain trong danh sách.
 *
 * Guard, interceptor và filter được đăng ký TOÀN CỤC ở đây thay vì rải trên
 * từng controller: bảo mật và định dạng response phải là mặc định, không phải
 * thứ ai đó nhớ thì thêm (deny-by-default).
 */
@Module({
  imports: [
    // --- Hạ tầng ---
    ConfigModule,
    PersistenceModule,
    MemorySeederModule,
    CacheModule,
    SecurityModule,
    IdempotencyModule,

    // --- Hạ tầng dùng chung theo domain ---
    AuditLogModule,
    OutboxModule,
    UsersModule,
    CaseAssignmentCheckerModule,

    // --- Domain ---
    AuthModule,
    DirectoryModule,
    EmergencyCaseModule,
    LocationModule,
    TriageModule,
    VideoSessionModule,
    FirstAidGuideModule,
    DispatchModule,
    NotificationModule,
    MedicalHandoverModule,
    RealtimeModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    // Thứ tự có ý nghĩa: xác thực trước, phân quyền sau.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Chạy sớm nhất có thể để mọi log và audit về sau đều có `requestId`.
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
