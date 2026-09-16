import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DomainErrors } from '../errors/domain-error';
import { contextFromRequest } from '../http/request-context';
import { IS_PUBLIC_KEY } from './auth.decorators';
import { TokenService } from './token.service';

/**
 * Guard xác thực toàn cục. Đọc `Authorization: Bearer <JWT>`, verify, rồi gắn
 * actor vào request context để tầng dưới (audit, policy) dùng lại.
 *
 * Rule 11: KHÔNG log token, kể cả một phần.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.header('authorization');

    // Endpoint public vẫn giải mã token nếu có: một số luồng (ví dụ tạo ca ở chế
    // độ khách) cần biết actor khi có, nhưng không bắt buộc.
    if (!header) {
      if (isPublic) return true;
      throw DomainErrors.unauthenticated('Thiếu Authorization header.');
    }

    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      if (isPublic) return true;
      throw DomainErrors.unauthenticated('Authorization header không đúng định dạng Bearer.');
    }

    try {
      const claims = this.tokenService.verifyAccessToken(token);
      const ctx = contextFromRequest(request);
      if (ctx) {
        ctx.actor = {
          userId: claims.sub,
          roles: claims.roles,
          serviceAreaIds: claims.serviceAreaIds,
        };
      }
      return true;
    } catch (error) {
      if (isPublic) return true;
      throw error;
    }
  }
}
