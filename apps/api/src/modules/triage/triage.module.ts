import { Module } from '@nestjs/common';
import { repositoryProvider } from '../../persistence/persistence.module';
import { EmergencyCaseModule } from '../emergency-case/emergency-case.module';
import { TriageController, TriageQuestionnaireController } from './controller/triage.controller';
import {
  MemoryTriageRepository,
  PgTriageRepository,
  TRIAGE_REPOSITORY,
} from './repository/triage.repository';
import { TriageService } from './service/triage.service';

@Module({
  imports: [EmergencyCaseModule],
  controllers: [TriageQuestionnaireController, TriageController],
  providers: [
    repositoryProvider(TRIAGE_REPOSITORY, PgTriageRepository, MemoryTriageRepository),
    TriageService,
  ],
  exports: [TriageService],
})
export class TriageModule {}
