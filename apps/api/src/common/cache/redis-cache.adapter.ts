import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import type { CachePort } from './cache.port';

/**
 * Driver cache Redis – driver chính thức theo Rule 3.1.
 *
 * Dùng cho: rate limit (TC-026, TC-027), OTP tạm thời, khóa ngắn hạn khi
 * accept case. KHÔNG lưu trạng thái nghiệp vụ (TDD §3.1).
 */
@Injectable()
export class RedisCacheAdapter implements CachePort {
  readonly driverName = 'redis' as const;

  private readonly client: Redis;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, {
      // Rate limit không được chặn luồng tạo ca cấp cứu: nếu Redis chậm/chết,
      // lệnh fail nhanh và caller quyết định fail-open hay fail-closed.
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    // Đặt TTL chỉ ở lần tăng đầu tiên -> cửa sổ cố định, không bị "trượt" vô hạn
    // khi client spam liên tục.
    const results = await this.client
      .multi()
      .incr(key)
      .expire(key, ttlSeconds, 'NX')
      .exec();

    const incrementResult = results?.[0]?.[1];
    return typeof incrementResult === 'number' ? incrementResult : Number(incrementResult ?? 0);
  }

  async ttl(key: string): Promise<number> {
    const seconds = await this.client.ttl(key);
    return seconds > 0 ? seconds : 0;
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, 'locked', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async releaseLock(key: string): Promise<void> {
    await this.client.del(key);
  }

  async onShutdown(): Promise<void> {
    await this.client.quit();
  }
}
