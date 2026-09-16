import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import type { ApiSuccess } from '../../contracts/generated/api-contract';
import { contextFromRequest, currentRequestId } from './request-context';

/**
 * Bọc mọi response thành công vào envelope của Rule 6.2 / ADR-003:
 *   { success: true, data: <payload>, requestId: "..." }
 *
 * Controller trả payload trần. Nếu controller tự bọc envelope, response sẽ bị
 * lồng hai lớp — đó là lý do có `assertNotAlreadyEnveloped` bên dưới: lỗi này
 * phải nổ ngay khi phát triển, không được lọt ra client.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiSuccess<unknown>> {
    // WebSocket message không dùng envelope HTTP.
    if (context.getType() !== 'http') {
      return next.handle() as Observable<ApiSuccess<unknown>>;
    }

    const request = context.switchToHttp().getRequest<unknown>();
    const requestId = contextFromRequest(request)?.requestId ?? currentRequestId();

    return next.handle().pipe(
      map((payload: unknown) => {
        assertNotAlreadyEnveloped(payload);
        return { success: true as const, data: payload ?? null, requestId };
      }),
    );
  }
}

function assertNotAlreadyEnveloped(payload: unknown): void {
  if (
    payload !== null &&
    typeof payload === 'object' &&
    'success' in payload &&
    ('data' in payload || 'error' in payload)
  ) {
    throw new Error(
      'Controller đã tự bọc envelope. Theo ADR-003, controller phải trả payload trần; ' +
        'ResponseEnvelopeInterceptor chịu trách nhiệm bọc.',
    );
  }
}
