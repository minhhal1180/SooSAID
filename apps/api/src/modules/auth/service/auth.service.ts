import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../common/config/app-config';
import { CACHE_PORT, type CachePort } from '../../../common/cache/cache.port';
import { DomainErrors } from '../../../common/errors/domain-error';
import { SafeLogger, maskPhone } from '../../../common/logging/safe-logger';
import { RateLimiterService, RateLimitRules } from '../../../common/security/rate-limiter.service';
import { TokenService, type IssuedTokenPair } from '../../../common/security/token.service';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../persistence/unit-of-work';
import { AuditAction, AuditResourceType, AuditResult } from '../../audit-log/entity/audit-action';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { UsersService } from '../../users/service/users.service';
import { OtpService } from './otp.service';

/**
 * Đăng nhập bằng OTP cho người dân (SOS-003).
 *
 * Ngoài phạm vi MVP (SOS-004): tổng đài/admin phải dùng OIDC/MFA riêng, KHÔNG
 * dùng OTP tiêu dùng. Tài khoản có vai trò nghiệp vụ bị từ chối ở luồng này —
 * xem `assertNotPrivilegedAccount` bên dưới.
 */

/** Vai trò không được phép đăng nhập bằng OTP người dân. */
const OTP_FORBIDDEN_ROLES = [
  'OPERATOR_115',
  'CLINICIAN',
  'AMBULANCE_CREW',
  'FACILITY_USER',
  'ADMIN',
  'AUDITOR',
] as const;

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: { id: string; roles: string[] };
}

export interface RequestOtpResult {
  /** Chỉ tồn tại cho đúng số demo khi cờ dev được bật. */
  demoOtp?: string;
  delivery: 'mock' | 'in_app_demo';
}

@Injectable()
export class AuthService {
  private readonly logger = new SafeLogger().setContext('auth');

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    private readonly otpService: OtpService,
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
    private readonly rateLimiter: RateLimiterService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Gửi OTP. Luôn trả 202 bất kể số điện thoại có tồn tại hay không — phản hồi
   * khác nhau sẽ biến endpoint này thành công cụ dò xem ai đã đăng ký.
   */
  async requestOtp(phone: string): Promise<RequestOtpResult> {
    // Fail-closed: cache chết thì từ chối, không để cache chết thành cách spam
    // nhà cung cấp SMS (TC-026).
    await this.rateLimiter.consume(
      RateLimitRules.otpRequest(this.config.rateLimit.otpPerHour),
      hashSubject(phone),
    );

    const otp = await this.otpService.issue(phone);

    const isInAppDemo =
      this.config.auth.demoOtpAutofill && phone === this.config.auth.demoPhone;

    // Pilot chạy SMS_PROVIDER=mock. Adapter SMS thật được cắm ở đây khi đơn vị
    // triển khai có nhà cung cấp và cơ chế đồng ý phù hợp (TDD §11.3).
    this.logger.log('otp_requested', {
      event: isInAppDemo ? 'demo_in_app_delivery' : 'sms_dispatch',
      provider: isInAppDemo ? 'in_app_demo' : 'mock',
    });

    await this.auditLog.record({
      action: AuditAction.AUTH_OTP_REQUESTED,
      resourceType: AuditResourceType.USER,
      // Chỉ lưu dạng che – audit log có thể được export (Rule 11).
      metadata: { phoneMasked: maskPhone(phone) },
    });

    return isInAppDemo
      ? { delivery: 'in_app_demo', demoOtp: otp }
      : { delivery: 'mock' };
  }

  /** Xác thực OTP và cấp cặp token. Tạo tài khoản người dân nếu lần đầu. */
  async verifyOtp(phone: string, otp: string): Promise<LoginResult> {
    const verified = await this.otpService.verify(phone, otp);

    if (!verified) {
      await this.auditLog.record({
        action: AuditAction.AUTH_LOGIN_FAILED,
        resourceType: AuditResourceType.USER,
        result: AuditResult.FAILURE,
        metadata: { phoneMasked: maskPhone(phone) },
      });
      throw DomainErrors.unauthenticated('Mã OTP không đúng hoặc đã hết hạn.');
    }

    let user = await this.usersService.findByPhone(phone);
    if (!user) {
      user = await this.unitOfWork.runInTransaction((tx) =>
        this.usersService.createCitizen(tx, phone),
      );
    }

    const roles = await this.usersService.listRoles(user.id);
    this.assertNotPrivilegedAccount(roles);

    const serviceAreaIds = await this.usersService.listServiceAreaIds(user.id);
    const tokens = this.tokenService.issuePair({ userId: user.id, roles, serviceAreaIds });
    await this.rememberSession(user.id, tokens);

    await this.auditLog.record({
      action: AuditAction.AUTH_LOGIN_SUCCEEDED,
      resourceType: AuditResourceType.USER,
      resourceId: user.id,
      metadata: { roles: roles.join(',') },
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSeconds: tokens.expiresInSeconds,
      user: { id: user.id, roles },
    };
  }

  /**
   * Refresh token rotation: token cũ bị thu hồi ngay khi cấp token mới.
   * Nếu một refresh token bị đánh cắp và dùng lại sau khi chủ nhân đã refresh,
   * lần dùng đó sẽ thất bại vì phiên không còn trong danh sách hợp lệ.
   */
  async refresh(refreshToken: string): Promise<LoginResult> {
    const claims = this.tokenService.verifyRefreshToken(refreshToken);

    const sessionKey = this.sessionKey(claims.sub, claims.jti);
    const session = await this.cache.get(sessionKey);
    if (!session) {
      throw DomainErrors.unauthenticated('Phiên đăng nhập không còn hiệu lực.');
    }
    await this.cache.delete(sessionKey);

    const user = await this.usersService.findById(claims.sub);
    if (!user || user.status !== 'ACTIVE') {
      throw DomainErrors.unauthenticated('Tài khoản không còn hoạt động.');
    }

    const roles = await this.usersService.listRoles(user.id);
    const serviceAreaIds = await this.usersService.listServiceAreaIds(user.id);
    const tokens = this.tokenService.issuePair({ userId: user.id, roles, serviceAreaIds });
    await this.rememberSession(user.id, tokens);

    await this.auditLog.record({
      action: AuditAction.AUTH_TOKEN_REFRESHED,
      resourceType: AuditResourceType.USER,
      resourceId: user.id,
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSeconds: tokens.expiresInSeconds,
      user: { id: user.id, roles },
    };
  }

  /** Thu hồi một phiên (remote logout – threat model "Lost phone"). */
  async revokeSession(userId: string, refreshTokenId: string): Promise<void> {
    await this.cache.delete(this.sessionKey(userId, refreshTokenId));
  }

  private async rememberSession(userId: string, tokens: IssuedTokenPair): Promise<void> {
    await this.cache.set(
      this.sessionKey(userId, tokens.refreshTokenId),
      'active',
      this.config.auth.refreshTtlSeconds,
    );
  }

  private sessionKey(userId: string, refreshTokenId: string): string {
    return `session:${userId}:${refreshTokenId}`;
  }

  private assertNotPrivilegedAccount(roles: readonly string[]): void {
    const privileged = roles.filter((role) =>
      (OTP_FORBIDDEN_ROLES as readonly string[]).includes(role),
    );
    if (privileged.length > 0) {
      // SOS-004: "Operator không dùng consumer OTP". Cho phép sẽ hạ toàn bộ mức
      // bảo vệ của tài khoản có quyền xem dữ liệu y tế xuống bằng một mã 6 số.
      throw DomainErrors.forbidden(
        'Tài khoản nghiệp vụ phải đăng nhập qua cổng xác thực riêng, không dùng OTP.',
      );
    }
  }
}

/** Băm số điện thoại trước khi dùng làm khoá rate limit (Rule 11). */
function hashSubject(phone: string): string {
  return createHash('sha256').update(phone).digest('hex').slice(0, 32);
}
