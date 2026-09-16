import { Injectable } from '@nestjs/common';
import type { CachePort } from './cache.port';

/**
 * Driver cache in-memory – CHỈ dùng cho local demo/test (ADR-007).
 *
 * Không chia sẻ giữa các instance: rate limit và khóa chỉ đúng khi chạy một
 * process duy nhất. `AppConfig` chặn driver này ở production.
 */
interface CacheEntry {
  value: string;
  expiresAtMs: number;
}

@Injectable()
export class MemoryCacheAdapter implements CachePort {
  readonly driverName = 'memory' as const;

  private readonly entries = new Map<string, CacheEntry>();
  private readonly sweepTimer: NodeJS.Timeout;

  /** Chu kỳ dọn key hết hạn; Map không tự hết hạn như Redis. */
  private static readonly SWEEP_INTERVAL_MS = 30_000;

  constructor() {
    this.sweepTimer = setInterval(() => this.sweepExpired(), MemoryCacheAdapter.SWEEP_INTERVAL_MS);
    // Timer dọn rác không được giữ process sống (quan trọng cho test runner).
    this.sweepTimer.unref?.();
  }

  async get(key: string): Promise<string | null> {
    return this.readAlive(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, expiresAtMs: Date.now() + ttlSeconds * 1000 });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const existing = this.readAlive(key);
    if (!existing) {
      this.entries.set(key, { value: '1', expiresAtMs: Date.now() + ttlSeconds * 1000 });
      return 1;
    }
    const next = Number.parseInt(existing.value, 10) + 1;
    // Giữ nguyên expiresAtMs: cửa sổ cố định tính từ request đầu tiên.
    existing.value = String(next);
    return next;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.readAlive(key);
    if (!entry) return 0;
    return Math.max(0, Math.ceil((entry.expiresAtMs - Date.now()) / 1000));
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    if (this.readAlive(key)) return false;
    this.entries.set(key, { value: 'locked', expiresAtMs: Date.now() + ttlSeconds * 1000 });
    return true;
  }

  async releaseLock(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async onShutdown(): Promise<void> {
    clearInterval(this.sweepTimer);
    this.entries.clear();
  }

  private readAlive(key: string): CacheEntry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAtMs <= now) this.entries.delete(key);
    }
  }
}
