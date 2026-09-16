import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '../../contracts/generated/api-contract';
import { DomainErrors } from '../errors/domain-error';
import { contextFromRequest } from '../http/request-context';
import { REQUIRED_ROLES_KEY } from './auth.decorators';

/**
 * Tầng RBAC thô (Rule 5.2 / ADR-002): chỉ kiểm tra actor có ÍT NHẤT MỘT role
 * được liệt kê hay không.
 *
 * Đây KHÔNG phải tầng phân quyền cuối cùng. Quyền trên một ca cụ thể (theo
 * service area, theo assignment, theo quyền sở hữu) do `CaseAccessPolicy` quyết
 * định ở tầng service — vì controller không biết ca nào trước khi đọc DB.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      REQUIRED_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const actor = contextFromRequest(context.switchToHttp().getRequest())?.actor;
    if (!actor) throw DomainErrors.unauthenticated();

    const allowed = actor.roles.some((role) => requiredRoles.includes(role));
    if (!allowed) {
      throw DomainErrors.forbidden('Vai trò của bạn không được phép thực hiện thao tác này.', {
        userId: actor.userId,
        roles: actor.roles.join(','),
      });
    }
    return true;
  }
}
