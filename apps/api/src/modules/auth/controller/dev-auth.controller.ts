import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { UserRole } from '../../../contracts/generated/api-contract';
import { APP_CONFIG, type AppConfig } from '../../../common/config/app-config';
import { DomainErrors } from '../../../common/errors/domain-error';
import { SafeLogger } from '../../../common/logging/safe-logger';
import { Public } from '../../../common/security/auth.decorators';
import { TokenService } from '../../../common/security/token.service';
import { UsersService } from '../../users/service/users.service';
import { AuditAction, AuditResourceType } from '../../audit-log/entity/audit-action';
import { AuditLogService } from '../../audit-log/service/audit-log.service';

/**
 * Đăng nhập tài khoản nghiệp vụ cho môi trường PHÁT TRIỂN / DIỄN TẬP.
 *
 * Vì sao tồn tại: SOS-004 quy định operator/clinician/admin phải dùng OIDC/MFA,
 * và `AuthService` CỐ Ý từ chối họ ở luồng OTP tiêu dùng. Cổng OIDC là hạng mục
 * hạ tầng chưa được dựng trong vòng này, nên dashboard cần một lối vào tạm để
 * chạy được kịch bản demo/diễn tập.
 *
 * Ba lớp chặn để nó không bao giờ lọt ra production:
 *   1. `AppConfig` từ chối khởi động nếu `AUTH_DEV_OPERATOR_LOGIN=true` khi
 *      `NODE_ENV=production`.
 *   2. Endpoint trả 403 khi cờ tắt.
 *   3. Chỉ chấp nhận các tài khoản mô phỏng có sẵn trong seed; không tạo tài
 *      khoản mới và không nhận `userId` tuỳ ý từ client.
 *
 * KHÔNG thay thế cho SOS-004. Xem `docs/decision-log/README.md` – Open Decisions.
 */

/** Số điện thoại của tài khoản mô phỏng tương ứng từng vai trò (khớp seed). */
const DEV_ACCOUNT_BY_ROLE: Readonly<Record<string, string>> = {
  [UserRole.OPERATOR_115]: '+84900000002',
  [UserRole.CLINICIAN]: '+84900000003',
  [UserRole.AMBULANCE_CREW]: '+84900000004',
  [UserRole.LOCAL_RESPONDER]: '+84900000005',
  [UserRole.ADMIN]: '+84900000006',
};

export class DevOperatorLoginDto {
  @IsIn(Object.keys(DEV_ACCOUNT_BY_ROLE))
  role!: string;
}

@Controller('auth/dev')
export class DevAuthController {
  private readonly logger = new SafeLogger().setContext('auth');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  async devLogin(@Body() body: DevOperatorLoginDto) {
    if (!this.config.auth.devOperatorLogin) {
      throw DomainErrors.forbidden(
        'Đăng nhập dev đang tắt. Tài khoản nghiệp vụ phải dùng cổng xác thực OIDC/MFA.',
      );
    }

    const phone = DEV_ACCOUNT_BY_ROLE[body.role];
    const user = await this.usersService.findByPhone(phone);
    if (!user) {
      throw DomainErrors.notFound('tài khoản mô phỏng', { role: body.role });
    }

    const roles = await this.usersService.listRoles(user.id);
    const serviceAreaIds = await this.usersService.listServiceAreaIds(user.id);
    const tokens = this.tokenService.issuePair({ userId: user.id, roles, serviceAreaIds });

    // Dùng cửa dev vẫn phải để lại dấu vết như mọi lần đăng nhập khác.
    await this.auditLog.record({
      action: AuditAction.AUTH_LOGIN_SUCCEEDED,
      resourceType: AuditResourceType.USER,
      resourceId: user.id,
      metadata: { roles: roles.join(','), devLogin: true },
    });
    this.logger.warn('dev_operator_login_used', { userId: user.id, roles: roles.join(',') });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSeconds: tokens.expiresInSeconds,
      user: { id: user.id, fullName: user.full_name, roles },
      devLogin: true,
    };
  }
}
