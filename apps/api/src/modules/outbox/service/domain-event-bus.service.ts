import { Injectable } from '@nestjs/common';
import { SafeLogger } from '../../../common/logging/safe-logger';
import type { StoredDomainEvent } from '../entity/domain-event';

/**
 * Bus phát domain event trong tiến trình.
 *
 * Module đăng ký handler ở `onModuleInit`. Đây là cách duy nhất để một module
 * phản ứng với việc xảy ra trong module khác mà không import service của nhau
 * (Rule 2.2 – Module Isolation).
 *
 * Một handler lỗi KHÔNG làm hỏng handler khác: `OutboxDispatcher` cần biết
 * "event này đã phát xong hay chưa", còn từng handler tự chịu trách nhiệm retry
 * nội bộ của mình (ví dụ `notification_deliveries.attempt_count`).
 */

export type DomainEventHandler = (event: StoredDomainEvent) => Promise<void>;

interface RegisteredHandler {
  readonly name: string;
  readonly handle: DomainEventHandler;
}

@Injectable()
export class DomainEventBus {
  private readonly logger = new SafeLogger().setContext('event-bus');
  private readonly handlers: RegisteredHandler[] = [];

  /** `name` chỉ dùng để log; đặt theo tên module đăng ký. */
  subscribe(name: string, handle: DomainEventHandler): void {
    this.handlers.push({ name, handle });
    this.logger.log('event_handler_registered', { event: name, count: this.handlers.length });
  }

  /**
   * Phát event tới mọi handler. Trả về `true` khi TẤT CẢ handler thành công —
   * chỉ khi đó `OutboxDispatcher` mới đánh dấu event là đã publish.
   */
  async publish(event: StoredDomainEvent): Promise<boolean> {
    const results = await Promise.allSettled(
      this.handlers.map((handler) => handler.handle(event)),
    );

    let allSucceeded = true;
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        allSucceeded = false;
        this.logger.error('event_handler_failed', {
          event: this.handlers[index].name,
          eventType: event.eventType,
          caseId: typeof event.payload.caseId === 'string' ? event.payload.caseId : undefined,
          errorCode: (result.reason as Error)?.name ?? 'UnknownError',
        });
      }
    });

    return allSucceeded;
  }

  /** Số handler đã đăng ký – dùng cho health check và test. */
  get handlerCount(): number {
    return this.handlers.length;
  }
}
