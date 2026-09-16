import { Module } from '@nestjs/common';
import { repositoryProvider } from '../../persistence/persistence.module';
import { EmergencyCaseModule } from '../emergency-case/emergency-case.module';
import { LocationController } from './controller/location.controller';
import { MemoryLocationRepository } from './repository/location.repository.memory';
import { PgLocationRepository } from './repository/location.repository.postgres';
import { LOCATION_REPOSITORY } from './repository/location.repository.port';
import { LocationService } from './service/location.service';

@Module({
  imports: [EmergencyCaseModule],
  controllers: [LocationController],
  providers: [
    repositoryProvider(LOCATION_REPOSITORY, PgLocationRepository, MemoryLocationRepository),
    LocationService,
  ],
  exports: [LocationService],
})
export class LocationModule {}
