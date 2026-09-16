/**
 * Port cache/coordination (Rule 3.1 – Redis; ADR-007 cho driver `memory`).
 *
 * Giới hạn có chủ đích: chỉ đủ cho rate limit, OTP tạm thời và khóa ngắn hạn.
 * TDD §3.1: **Redis không phải source of truth** — không được lưu trạng thái ca
 * cấp cứu ở đây. Redis chết thì realtime degrade, nhưng dữ liệu ca vẫn nguyên vẹn
 * trong PostgreSQL.
 */
export interface CachePort {
  readonly driverName: 'redis' | 'memory';

  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;

  /**
   * Tăng bộ đếm và trả giá trị mới. TTL chỉ được đặt ở lần tăng đầu tiên, nên
   * cửa sổ rate limit là cửa sổ cố định tính từ request đầu tiên.
   */
  increment(key: string, ttlSeconds: number): Promise<number>;

  /** Số giây còn lại của key, hoặc 0 nếu không còn/không có TTL. */
  ttl(key: string): Promise<number>;

  /** Khóa phân tán ngắn hạn; trả false nếu đã có người giữ khóa. */
  acquireLock(key: string, ttlSeconds: number): Promise<boolean>;
  releaseLock(key: string): Promise<void>;

  onShutdown(): Promise<void>;
}

export const CACHE_PORT = Symbol('CACHE_PORT');
