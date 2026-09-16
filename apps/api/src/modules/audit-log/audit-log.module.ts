import { Global, Module } from '@nestjs/common';
import { repositoryProvider } from '../../persistence/persistence.module';
import { AuditLogController } from './controller/audit-log.controller';
import { MemoryAuditLogRepository } from './repository/audit-log.repository.memory';
import { PgAuditLogRepository } from './repository/audit-log.repository.postgres';
import { AUDIT_LOG_REPOSITORY } from './repository/audit-log.repository.port';
import { AuditLogService } from './service/audit-log.service';

/**
 * @Global vì mọi module chạm dữ liệu nhạy cảm đều phải ghi audit (Rule 5.1).
 * Bắt từng module import thủ công chỉ tạo cơ hội để ai đó "quên".
 */
@Global()
@Module({
  controllers: [AuditLogController],
  providers: [
    repositoryProvider(AUDIT_LOG_REPOSITORY, PgAuditLogRepository, MemoryAuditLogRepository),
    AuditLogService,
  ],
  exports: [AuditLogService],
})
export class AuditLogModule {}
