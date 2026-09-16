import { Module } from '@nestjs/common';
import { repositoryProvider } from '../../persistence/persistence.module';
import { MockNotificationProvider } from './entity/mock-notification.provider';
import { NOTIFICATION_PROVIDER } from './entity/notification-provider.port';
import {
  MemoryNotificationRepository,
  NOTIFICATION_REPOSITORY,
  PgNotificationRepository,
} from './repository/notification.repository';
import { NotificationService } from './service/notification.service';

/**
 * Module thông báo.
 *
 * Không có controller: module này chỉ tiêu thụ domain event từ outbox. Bề mặt
 * đọc (trạng thái gửi của một ca) được ghép vào báo cáo của `medical-handover`.
 *
 * `PUSH_PROVIDER=mock` trong Pilot. Cắm FCM/APNs khi đơn vị triển khai có
 * credential và cơ chế đồng ý phù hợp (TDD §11.3).
 */
@Module({
  providers: [
    repositoryProvider(
      NOTIFICATION_REPOSITORY,
      PgNotificationRepository,
      MemoryNotificationRepository,
    ),
    { provide: NOTIFICATION_PROVIDER, useClass: MockNotificationProvider },
    NotificationService,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
