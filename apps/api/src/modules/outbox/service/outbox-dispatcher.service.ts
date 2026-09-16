import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { SafeLogger } from '../../../common/logging/safe-logger';
import { OUTBOX_REPOSITORY, type OutboxRepositoryPort } from '../repository/outbox.repository.port';
import { DomainEventBus } from './domain-event-bus.service';

/**
 * Worker đọc `outbox_events` và phát cho các handler đã đăng ký (ADR-005).
 *
 * Bảo đảm: **at-least-once**. Một event có thể được phát lại nếu process chết
 * sau khi handler chạy nhưng trước khi `markPublished` kịp ghi. Do đó mọi handler
 * phải idempotent — ví dụ `NotificationService` khoá theo
 * `(case_id, template_code, recipient)` thay vì tạo bản ghi mù quáng.
 */
@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new SafeLogger().setContext('outbox');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  /** Chu kỳ poll. Đủ nhanh để hàng đợi operator thấy ca mới gần như tức thì. */
  private static readonly POLL_INTERVAL_MS = 1_000;
  /** Số event xử lý mỗi vòng – giới hạn để một burst không chiếm hết event loop. */
  private static readonly BATCH_SIZE = 50;
  /**
   * Quá ngưỡng này thì dừng retry tự động và để con người xử lý (dead letter).
   * Runbook: alert khi có event vượt ngưỡng.
   */
  private static readonly MAX_RETRY_BEFORE_DEAD_LETTER = 10;

  constructor(
    @Inject(OUTBOX_REPOSITORY) private readonly repository: OutboxRepositoryPort,
    private readonly eventBus: DomainEventBus,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.drainOnce();
    }, OutboxDispatcher.POLL_INTERVAL_MS);
    this.timer.unref?.();
    this.logger.log('outbox_dispatcher_started', { count: this.eventBus.handlerCount });
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Xử lý một lô event. Public để test và để endpoint health có thể ép chạy
   * ngay thay vì chờ tới chu kỳ poll tiếp theo.
   */
  async drainOnce(): Promise<number> {
    // Chống chồng lấn: một vòng chậm không được kéo theo vòng thứ hai chạy song
    // song trên cùng dữ liệu.
    if (this.running) return 0;
    this.running = true;

    try {
      const events = await this.repository.findUnpublished(OutboxDispatcher.BATCH_SIZE);
      let publishedCount = 0;

      for (const event of events) {
        if (event.retryCount >= OutboxDispatcher.MAX_RETRY_BEFORE_DEAD_LETTER) {
          this.logger.error('outbox_event_dead_letter', {
            eventType: event.eventType,
            attempt: event.retryCount,
            caseId: readCaseId(event.payload),
          });
          continue;
        }

        const succeeded = await this.eventBus.publish(event);
        if (succeeded) {
          await this.repository.markPublished(event.id);
          publishedCount += 1;
        } else {
          await this.repository.markFailed(event.id);
        }
      }

      return publishedCount;
    } catch {
      // Outbox lỗi không được làm sập API: ca cấp cứu vẫn phải tạo được.
      this.logger.error('outbox_drain_failed', { result: 'FAILURE' });
      return 0;
    } finally {
      this.running = false;
    }
  }
}

function readCaseId(payload: Record<string, unknown>): string | undefined {
  return typeof payload.caseId === 'string' ? payload.caseId : undefined;
}
