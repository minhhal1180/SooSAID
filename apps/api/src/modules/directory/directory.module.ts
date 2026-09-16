import { Module } from '@nestjs/common';
import { repositoryProvider } from '../../persistence/persistence.module';
import { DirectoryController } from './controller/directory.controller';
import { MemoryDirectoryRepository } from './repository/directory.repository.memory';
import { PgDirectoryRepository } from './repository/directory.repository.postgres';
import { DIRECTORY_REPOSITORY } from './repository/directory.repository.port';
import { DirectoryService } from './service/directory.service';

/**
 * Module danh bạ. Export `DirectoryService` để `emergency-case` xác định service
 * area và `dispatch` chọn kíp xe/người hỗ trợ — giao tiếp xuyên module qua
 * service công khai, không qua repository (Rule 2.2).
 */
@Module({
  controllers: [DirectoryController],
  providers: [
    repositoryProvider(DIRECTORY_REPOSITORY, PgDirectoryRepository, MemoryDirectoryRepository),
    DirectoryService,
  ],
  exports: [DirectoryService],
})
export class DirectoryModule {}
