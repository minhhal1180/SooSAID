import { Inject, Injectable } from '@nestjs/common';
import { CACHE_PORT, type CachePort } from '../cache/cache.port';
import { DomainErrors } from '../errors/domain-error';
import { SafeLogger } from '../logging/safe-logger';

/**
 * Rate limit cho các endpoint nhạy cảm (threat model; TC-026, TC-027).
 *
 * Nguyên tắc quan trọng về hướng fail:
 *  - OTP (`failClosed = true`): cache chết -> TỪ CHỐI. Không được để cache chết
 *    trở thành cách vượt giới hạn và spam nhà cung cấp SMS.
 *  - Tạo ca S.O.S (`failClosed = false`): cache chết -> CHO QUA và ghi cảnh báo.
 *    Chặn một ca cấp cứu thật vì Redis lỗi là thiệt hại lớn hơn nhiều so với
 *    việc lọt vài ca trùng — TC-027 cũng yêu cầu "không chặn luồng hợp lệ".
 */

const SECONDS_PER_HOUR = 3600;

export interface RateLimitRule {
  /** Tiền tố khóa, ví dụ `otp` hoặc `sos-create`. */
  readonly bucket: string;
  readonly limit: number;
  readonly windowSeconds: number;
  readonly failClosed: boolean;
  readonly message: string;
}

export const RateLimitRules = {
  otpRequest: (limitPerHour: number): RateLimitRule => ({
    bucket: 'otp-request',
    limit: limitPerHour,
    windowSeconds: SECONDS_PER_HOUR,
    failClosed: true,
    message: 'Bạn đã yêu cầu mã OTP quá nhiều lần. Vui lòng thử lại sau.',
  }),
  sosCreate: (limitPerHour: number): RateLimitRule => ({
    bucket: 'sos-create',
    limit: limitPerHour,
    windowSeconds: SECONDS_PER_HOUR,
    failClosed: false,
    message: 'Hệ thống ghi nhận quá nhiều yêu cầu từ thiết bị này trong thời gian ngắn.',
  }),
};

@Injectable()
export class RateLimiterService {
  private readonly logger = new SafeLogger().setContext('rate-limit');

  constructor(@Inject(CACHE_PORT) private readonly cache: CachePort) {}

  /**
   * Tăng bộ đếm cho `subject` và ném `RATE_LIMITED` nếu vượt ngưỡng.
   * `subject` phải là định danh đã băm/che (userId, deviceId) — không truyền số
   * điện thoại thô vào đây vì nó trở thành khóa cache và đi vào log lỗi.
   */
  async consume(rule: RateLimitRule, subject: string): Promise<void> {
    const key = `ratelimit:${rule.bucket}:${subject}`;

    let count: number;
    try {
      count = await this.cache.increment(key, rule.windowSeconds);
    } catch {
      if (rule.failClosed) {
        this.logger.error('rate_limit_backend_unavailable_fail_closed', { event: rule.bucket });
        throw DomainErrors.rateLimited(rule.message, rule.windowSeconds);
      }
      this.logger.warn('rate_limit_backend_unavailable_fail_open', { event: rule.bucket });
      return;
    }

    if (count > rule.limit) {
      const retryAfterSeconds = (await this.cache.ttl(key)) || rule.windowSeconds;
      this.logger.warn('rate_limit_exceeded', { event: rule.bucket, count });
      throw DomainErrors.rateLimited(rule.message, retryAfterSeconds);
    }
  }
}
