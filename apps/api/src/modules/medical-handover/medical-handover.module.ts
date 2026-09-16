import { Module } from '@nestjs/common';
import { repositoryProvider } from '../../persistence/persistence.module';
import {
  EMERGENCY_CASE_REPOSITORY,
} from '../emergency-case/repository/emergency-case.repository.port';
import { MemoryEmergencyCaseRepository } from '../emergency-case/repository/emergency-case.repository.memory';
import { PgEmergencyCaseRepository } from '../emergency-case/repository/emergency-case.repository.postgres';
import { DispatchModule } from '../dispatch/dispatch.module';
import { EmergencyCaseModule } from '../emergency-case/emergency-case.module';
import { FirstAidGuideModule } from '../first-aid-guide/first-aid-guide.module';
import { LocationModule } from '../location/location.module';
import { TriageModule } from '../triage/triage.module';
import {
  MedicalHandoverController,
  ReportingController,
} from './controller/medical-handover.controller';
import {
  HANDOVER_REPOSITORY,
  MemoryHandoverRepository,
  PgHandoverRepository,
} from './repository/handover.repository';
import { MedicalHandoverService } from './service/medical-handover.service';
import { ReportingService } from './service/reporting.service';

/**
 * Module bàn giao và báo cáo.
 *
 * Đây là module duy nhất hợp pháp đọc chéo nhiều domain, vì bản chất của hồ sơ
 * bàn giao là tổng hợp. Nó làm việc đó qua service công khai của từng module,
 * không qua repository của chúng (Rule 2.2).
 *
 * `ReportingService` là ngoại lệ có cân nhắc: nó cần truy vấn thống kê trên
 * `emergency_cases` mà không service nào expose, nên module này tự tạo một
 * instance repository riêng (lớp bọc không trạng thái) thay vì ép
 * `EmergencyCaseService` phình ra các hàm báo cáo.
 */
@Module({
  imports: [
    EmergencyCaseModule,
    TriageModule,
    FirstAidGuideModule,
    DispatchModule,
    LocationModule,
  ],
  controllers: [MedicalHandoverController, ReportingController],
  providers: [
    repositoryProvider(HANDOVER_REPOSITORY, PgHandoverRepository, MemoryHandoverRepository),
    repositoryProvider(
      EMERGENCY_CASE_REPOSITORY,
      PgEmergencyCaseRepository,
      MemoryEmergencyCaseRepository,
    ),
    MedicalHandoverService,
    ReportingService,
  ],
  exports: [MedicalHandoverService, ReportingService],
})
export class MedicalHandoverModule {}
