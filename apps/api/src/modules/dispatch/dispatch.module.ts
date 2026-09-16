import { Module } from '@nestjs/common';
import { repositoryProvider } from '../../persistence/persistence.module';
import { DirectoryModule } from '../directory/directory.module';
import { EmergencyCaseModule } from '../emergency-case/emergency-case.module';
import { AssignmentController, CaseDispatchController } from './controller/dispatch.controller';
import {
  DISPATCH_REPOSITORY,
  MemoryDispatchRepository,
  PgDispatchRepository,
} from './repository/dispatch.repository';
import { DispatchService } from './service/dispatch.service';

/**
 * Module điều phối.
 *
 * `CaseAssignmentCheckerModule` (@Global, khai báo riêng) chịu trách nhiệm cung
 * cấp `CASE_ASSIGNMENT_CHECKER_PORT` cho `emergency-case`, nên module này import
 * `EmergencyCaseModule` một chiều mà không tạo vòng phụ thuộc.
 */
@Module({
  imports: [EmergencyCaseModule, DirectoryModule],
  controllers: [CaseDispatchController, AssignmentController],
  providers: [
    repositoryProvider(DISPATCH_REPOSITORY, PgDispatchRepository, MemoryDispatchRepository),
    DispatchService,
  ],
  exports: [DispatchService],
})
export class DispatchModule {}
