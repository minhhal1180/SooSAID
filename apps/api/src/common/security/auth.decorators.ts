import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserRole } from '../../contracts/generated/api-contract';
import { DomainErrors } from '../errors/domain-error';
import type { AuthenticatedActor } from '../http/request-context';
import { contextFromRequest } from '../http/request-context';

/**
 * Deny-by-default: `JwtAuthGuard` được đăng ký global, nên MỌI endpoint đều yêu
 * cầu xác thực trừ khi gắn `@Public()`. Quên gắn decorator nghĩa là endpoint bị
 * khóa, không phải bị mở — đúng hướng an toàn (threat model).
 */

export const IS_PUBLIC_KEY = 'sos:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const REQUIRED_ROLES_KEY = 'sos:requiredRoles';

/**
 * Giới hạn endpoint theo role code (ADR-002). Nhận role code cụ thể
 * (`OPERATOR_115`), KHÔNG nhận nhóm khái niệm (`MEDICAL_STAFF`).
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(REQUIRED_ROLES_KEY, roles);

/** Lấy actor đã xác thực từ request context. */
export const CurrentActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedActor => {
    const actor = contextFromRequest(ctx.switchToHttp().getRequest())?.actor;
    if (!actor) throw DomainErrors.unauthenticated();
    return actor;
  },
);
