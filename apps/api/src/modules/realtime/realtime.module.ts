import { Module } from '@nestjs/common';
import { EmergencyCaseModule } from '../emergency-case/emergency-case.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [EmergencyCaseModule],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
