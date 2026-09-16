import { createHash } from 'node:crypto';
import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { ApiErrorCode } from '../../contracts/generated/api-contract';
import { repositoryProvider } from '../../persistence/persistence.module';
import type { TxContext } from '../../persistence/unit-of-work';
import { DomainError } from '../errors/domain-error';
import { IDEMPOTENCY_REPOSITORY, type IdempotencyRepositoryPort } from './idempotency.port';
import { MemoryIdempotencyRepository } from './idempotency.repository.memory';
import { PgIdempotencyRepository } from './idempotency.repository.postgres';

/**
 * Thực thi ngữ nghĩa `Idempotency-Key` (FR-002).
 *
 * Ba tình huống khi nhận một key:
 *   1. Key mới                        -> đặt chỗ, chạy nghiệp vụ, lưu response.
 *   2. Key đã có + CÙNG request hash   -> trả lại response cũ (TC-002).
 *   3. Key đã có + KHÁC request hash   -> 409 IDEMPOTENCY_CONFLICT: client đang
 *      tái sử dụng key cho một yêu cầu khác, đó là lỗi của client chứ không phải
 *      retry.
 */

/**
 * Key sống 24 giờ. Đủ dài để phủ mọi lần retry hợp lý của mobile (kể cả sau khi
 * người dùng mất mạng một lúc lâu), đủ ngắn để bảng không phình.
 */
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Trạng thái chờ khi request đầu tiên còn đang xử lý. */
export interface IdempotentReplay {
  readonly replayed: true;
  readonly responseCode: number;
  readonly responseBody: Record<string, unknown>;
}

@Injectable()
export class IdempotencyService {
  constructor(
    @Inject(IDEMPOTENCY_REPOSITORY) private readonly repository: IdempotencyRepositoryPort,
  ) {}

  /** Băm body để phát hiện client dùng lại key cho request khác. */
  hashRequest(body: unknown): string {
    return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
  }

  /**
   * Kiểm tra key trước khi chạy nghiệp vụ.
   * Trả `null` nghĩa là "chưa từng thấy, cứ chạy tiếp".
   */
  async findReplay(
    key: string,
    endpoint: string,
    requestHash: string,
  ): Promise<IdempotentReplay | null> {
    const existing = await this.repository.find(key);
    if (!existing) return null;

    if (existing.endpoint !== endpoint || existing.requestHash !== requestHash) {
      throw new DomainError(
        ApiErrorCode.IDEMPOTENCY_CONFLICT,
        'Idempotency-Key này đã được dùng cho một yêu cầu khác. Hãy sinh key mới.',
      );
    }

    if (existing.responseCode === null || existing.responseBody === null) {
      // Request đầu tiên vẫn đang chạy. Trả 409 thay vì chạy song song: chạy
      // song song có thể tạo ca thứ hai, đúng thứ idempotency sinh ra để tránh.
      throw new DomainError(
        ApiErrorCode.IDEMPOTENCY_CONFLICT,
        'Yêu cầu trước với key này đang được xử lý. Vui lòng chờ kết quả.',
      );
    }

    return {
      replayed: true,
      responseCode: existing.responseCode,
      responseBody: existing.responseBody,
    };
  }

  /** Đặt chỗ key trong transaction. Ném 409 nếu bị request khác chiếm trước. */
  async reserve(
    tx: TxContext,
    input: { key: string; userId: string | null; endpoint: string; requestHash: string },
  ): Promise<void> {
    const reserved = await this.repository.reserve(tx, {
      ...input,
      expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
    });

    if (!reserved) {
      throw new DomainError(
        ApiErrorCode.IDEMPOTENCY_CONFLICT,
        'Yêu cầu trùng lặp đang được xử lý.',
      );
    }
  }

  async complete(
    tx: TxContext,
    key: string,
    responseCode: number,
    responseBody: Record<string, unknown>,
  ): Promise<void> {
    await this.repository.complete(tx, key, responseCode, responseBody);
  }

  async purgeExpired(): Promise<number> {
    return this.repository.deleteExpired(new Date());
  }
}

@Global()
@Module({
  providers: [
    repositoryProvider(IDEMPOTENCY_REPOSITORY, PgIdempotencyRepository, MemoryIdempotencyRepository),
    IdempotencyService,
  ],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
