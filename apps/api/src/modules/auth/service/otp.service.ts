import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CACHE_PORT, type CachePort } from '../../../common/cache/cache.port';
import { APP_CONFIG, type AppConfig } from '../../../common/config/app-config';
import { DomainErrors } from '../../../common/errors/domain-error';
import { SafeLogger } from '../../../common/logging/safe-logger';

/**
 * Sinh và kiểm tra OTP đăng nhập cho người dân (SOS-003).
 *
 * Quyết định bảo mật ghi rõ để người review đối chiếu với threat model:
 *  - OTP KHÔNG lưu dạng rõ: cache chỉ giữ SHA-256 của OTP + phone. Đọc được
 *    cache cũng không suy ra được mã.
 *  - Khoá cache là băm của số điện thoại, không phải số điện thoại — Redis và
 *    log không được chứa danh sách số thuê bao (Rule 11).
 *  - So sánh bằng `timingSafeEqual` để không rò rỉ thông tin qua thời gian.
 *  - Giới hạn số lần thử: hết lượt thì huỷ OTP, buộc yêu cầu mã mới.
 *  - Rate limit số lần YÊU CẦU mã nằm ở `AuthService`, fail-closed.
 *
 * Pilot dùng `SMS_PROVIDER=mock`: mã chỉ hiện trong log khi
 * `AUTH_OTP_DEV_ECHO=true`, và cấu hình này bị chặn ở production.
 */

const OTP_DIGITS = 6;
const OTP_TTL_SECONDS = 300;
const MAX_VERIFY_ATTEMPTS = 5;

interface OtpRecord {
  otpHash: string;
  attempts: number;
}

@Injectable()
export class OtpService {
  private readonly logger = new SafeLogger().setContext('auth');

  constructor(
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Sinh OTP mới, lưu bản băm, trả mã rõ để adapter SMS gửi đi. */
  async issue(phone: string): Promise<string> {
    const otp = String(randomInt(0, 10 ** OTP_DIGITS)).padStart(OTP_DIGITS, '0');
    const record: OtpRecord = { otpHash: this.hash(phone, otp), attempts: 0 };

    await this.cache.set(this.cacheKey(phone), JSON.stringify(record), OTP_TTL_SECONDS);

    if (this.config.auth.otpDevEcho) {
      // Chỉ bật ở máy cá nhân. `AppConfig` từ chối khởi động nếu bật ở production.
      this.logger.warn('otp_dev_echo_enabled', { event: `otp=${otp}` });
    }

    return otp;
  }

  /**
   * Kiểm tra OTP. Trả `true` khi đúng và huỷ mã ngay (dùng một lần).
   * Sai thì tăng bộ đếm; hết lượt thì huỷ mã luôn.
   */
  async verify(phone: string, otp: string): Promise<boolean> {
    const key = this.cacheKey(phone);
    const raw = await this.cache.get(key);
    if (!raw) return false;

    const record = JSON.parse(raw) as OtpRecord;

    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
      await this.cache.delete(key);
      throw DomainErrors.rateLimited(
        'Bạn đã nhập sai mã quá nhiều lần. Vui lòng yêu cầu mã mới.',
        OTP_TTL_SECONDS,
      );
    }

    const matched = this.constantTimeEquals(record.otpHash, this.hash(phone, otp));

    if (!matched) {
      record.attempts += 1;
      // Giữ nguyên TTL còn lại để việc nhập sai không kéo dài tuổi thọ của mã.
      const remainingTtl = (await this.cache.ttl(key)) || OTP_TTL_SECONDS;
      await this.cache.set(key, JSON.stringify(record), remainingTtl);
      return false;
    }

    await this.cache.delete(key);
    return true;
  }

  /** Băm ràng buộc theo số điện thoại: mã của người này không dùng cho người kia. */
  private hash(phone: string, otp: string): string {
    return createHash('sha256').update(`${phone}:${otp}`).digest('hex');
  }

  private cacheKey(phone: string): string {
    return `otp:${createHash('sha256').update(phone).digest('hex')}`;
  }

  private constantTimeEquals(a: string, b: string): boolean {
    const bufferA = Buffer.from(a, 'hex');
    const bufferB = Buffer.from(b, 'hex');
    if (bufferA.length !== bufferB.length) return false;
    return timingSafeEqual(bufferA, bufferB);
  }
}
