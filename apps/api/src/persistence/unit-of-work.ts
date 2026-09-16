/**
 * Unit of Work – ranh giới transaction dùng chung cho mọi module.
 *
 * Lý do tồn tại: Outbox Pattern (Rule 2.1 / ADR-005) đòi hỏi bản ghi nghiệp vụ
 * và dòng `outbox_events` phải commit TRONG CÙNG MỘT transaction. Nếu tách ra,
 * hệ thống sẽ hoặc mất event (commit case xong crash trước khi ghi outbox),
 * hoặc phát event cho một case chưa tồn tại.
 *
 * `TxContext` là handle mờ: repository nhận nó và tự biết cách dùng, còn service
 * nghiệp vụ chỉ chuyền tay, không mở ra xem.
 */

export interface TxContext {
  readonly driver: 'postgres' | 'memory';
}

export interface UnitOfWork {
  /**
   * Chạy `work` trong một transaction. Ném lỗi -> rollback toàn bộ.
   *
   * Lưu ý với driver `memory` (ADR-004): KHÔNG có rollback thật. Thay đổi đã ghi
   * vào Map sẽ ở lại. Đây là một trong những lý do driver `memory` bị cấm ở
   * production và integration test phải chạy trên PostgreSQL.
   */
  runInTransaction<T>(work: (tx: TxContext) => Promise<T>): Promise<T>;

  /** Kiểm tra kết nối phục vụ health check. */
  healthCheck(): Promise<boolean>;

  onShutdown(): Promise<void>;
}

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');
