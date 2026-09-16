import { Global, Module } from '@nestjs/common';
import { repositoryProvider } from '../../persistence/persistence.module';
import { EMERGENCY_PROFILE_SNAPSHOT_PORT } from '../emergency-case/service/case-collaboration.ports';
import { UsersController } from './controller/users.controller';
import { MemoryUsersRepository } from './repository/users.repository.memory';
import { PgUsersRepository } from './repository/users.repository.postgres';
import { USERS_REPOSITORY } from './repository/users.repository.port';
import { UsersService } from './service/users.service';

/**
 * Module người dùng.
 *
 * @Global vì `auth`, `emergency-case` và `notification` đều cần đọc dữ liệu
 * người dùng, và vì module này đăng ký `EMERGENCY_PROFILE_SNAPSHOT_PORT` mà
 * `emergency-case` phụ thuộc vào.
 */
@Global()
@Module({
  controllers: [UsersController],
  providers: [
    repositoryProvider(USERS_REPOSITORY, PgUsersRepository, MemoryUsersRepository),
    UsersService,
    // `UsersService` là cài đặt của port; bind lại token để `emergency-case`
    // inject được mà không import `UsersService` trực tiếp (Rule 2.2).
    { provide: EMERGENCY_PROFILE_SNAPSHOT_PORT, useExisting: UsersService },
  ],
  exports: [UsersService, EMERGENCY_PROFILE_SNAPSHOT_PORT],
})
export class UsersModule {}
