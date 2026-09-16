import { Module } from '@nestjs/common';
import { repositoryProvider } from '../../persistence/persistence.module';
import { DirectoryModule } from '../directory/directory.module';
import { EmergencyCaseController } from './controller/emergency-case.controller';
import { OperatorController } from './controller/operator.controller';
import { MemoryEmergencyCaseRepository } from './repository/emergency-case.repository.memory';
import { PgEmergencyCaseRepository } from './repository/emergency-case.repository.postgres';
import { EMERGENCY_CASE_REPOSITORY } from './repository/emergency-case.repository.port';
import { EmergencyCaseService } from './service/emergency-case.service';

/**
 * Module ca cấp cứu.
 *
 * Phụ thuộc vào `EMERGENCY_PROFILE_SNAPSHOT_PORT` và `CASE_ASSIGNMENT_CHECKER_PORT`
 * do `UsersModule` và `DispatchModule` đăng ký (@Global) — nhờ vậy module này
 * không import ngược hai module kia và tránh circular dependency.
 */
@Module({
  imports: [DirectoryModule],
  controllers: [EmergencyCaseController, OperatorController],
  providers: [
    repositoryProvider(
      EMERGENCY_CASE_REPOSITORY,
      PgEmergencyCaseRepository,
      MemoryEmergencyCaseRepository,
    ),
    EmergencyCaseService,
  ],
  exports: [EmergencyCaseService],
})
export class EmergencyCaseModule {}
