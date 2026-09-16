import { Module } from '@nestjs/common';
import { repositoryProvider } from '../../persistence/persistence.module';
import { EmergencyCaseModule } from '../emergency-case/emergency-case.module';
import {
  CaseGuidanceController,
  FirstAidGuideCatalogController,
} from './controller/first-aid-guide.controller';
import {
  GUIDANCE_REPOSITORY,
  MemoryGuidanceRepository,
  PgGuidanceRepository,
} from './repository/guidance.repository';
import { FirstAidGuideService } from './service/first-aid-guide.service';

@Module({
  imports: [EmergencyCaseModule],
  controllers: [FirstAidGuideCatalogController, CaseGuidanceController],
  providers: [
    repositoryProvider(GUIDANCE_REPOSITORY, PgGuidanceRepository, MemoryGuidanceRepository),
    FirstAidGuideService,
  ],
  exports: [FirstAidGuideService],
})
export class FirstAidGuideModule {}
