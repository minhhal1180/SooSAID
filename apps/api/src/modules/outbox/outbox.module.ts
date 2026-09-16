import { Global, Module } from '@nestjs/common';
import { repositoryProvider } from '../../persistence/persistence.module';
import { MemoryOutboxRepository } from './repository/outbox.repository.memory';
import { PgOutboxRepository } from './repository/outbox.repository.postgres';
import { OUTBOX_REPOSITORY } from './repository/outbox.repository.port';
import { DomainEventBus } from './service/domain-event-bus.service';
import { OutboxDispatcher } from './service/outbox-dispatcher.service';
import { OutboxService } from './service/outbox.service';

/**
 * Module Outbox – @Global vì gần như mọi module nghiệp vụ đều cần ghi event,
 * và mọi module tiêu thụ event đều cần `DomainEventBus` để đăng ký handler.
 */
@Global()
@Module({
  providers: [
    repositoryProvider(OUTBOX_REPOSITORY, PgOutboxRepository, MemoryOutboxRepository),
    OutboxService,
    DomainEventBus,
    OutboxDispatcher,
  ],
  exports: [OutboxService, DomainEventBus, OutboxDispatcher],
})
export class OutboxModule {}
