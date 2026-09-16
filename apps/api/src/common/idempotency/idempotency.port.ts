import type { TxContext } from '../../persistence/unit-of-work';

/**
 * Lưu kết quả của một request có `Idempotency-Key` để retry trả lại đúng kết
 * quả cũ thay vì tạo bản ghi thứ hai (FR-002, TC-002, TC-003).
 *
 * Vì sao quan trọng với S.O.S Aid: người đang hoảng loạn bấm nút nhiều lần, và
 * mạng di động hay timeout rồi client tự retry. Không có idempotency thì một sự
 * cố sinh ra 5 ca cấp cứu và 5 lần điều xe.
 */
export interface IdempotencyRecord {
  readonly key: string;
  readonly endpoint: string;
  readonly requestHash: string;
  readonly responseCode: number | null;
  readonly responseBody: Record<string, unknown> | null;
  readonly expiresAt: Date;
}

export interface IdempotencyRepositoryPort {
  find(key: string): Promise<IdempotencyRecord | null>;

  /**
   * Đặt chỗ cho key. Trả về `null` nếu key đã tồn tại (một request khác đã
   * chiếm chỗ) — đây là điểm cưỡng chế atomic, dựa trên UNIQUE constraint.
   */
  reserve(
    tx: TxContext,
    input: {
      key: string;
      userId: string | null;
      endpoint: string;
      requestHash: string;
      expiresAt: Date;
    },
  ): Promise<IdempotencyRecord | null>;

  /** Ghi lại response để lần retry sau trả về y hệt. */
  complete(
    tx: TxContext,
    key: string,
    responseCode: number,
    responseBody: Record<string, unknown>,
  ): Promise<void>;

  /** Dọn key hết hạn; gọi định kỳ để bảng không phình vô hạn. */
  deleteExpired(now: Date): Promise<number>;
}

export const IDEMPOTENCY_REPOSITORY = Symbol('IDEMPOTENCY_REPOSITORY');
