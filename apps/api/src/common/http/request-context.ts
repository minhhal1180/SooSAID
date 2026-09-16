import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { UserRole } from '../../contracts/generated/api-contract';

/**
 * Ngữ cảnh của một request, truyền ngầm xuống mọi tầng.
 *
 * Mục đích chính là audit (FR-014): `AuditLogService` cần biết ai gọi, từ IP nào,
 * với requestId nào — mà không phải nhét các tham số đó vào chữ ký của từng
 * service nghiệp vụ.
 */

export interface AuthenticatedActor {
  readonly userId: string;
  readonly roles: readonly UserRole[];
  readonly serviceAreaIds: readonly string[];
}

export interface RequestContext {
  readonly requestId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  actor: AuthenticatedActor | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Trả về context hiện tại, hoặc null nếu đang chạy ngoài request (worker/test). */
export function currentRequestContext(): RequestContext | null {
  return storage.getStore() ?? null;
}

/** requestId hiện tại; sinh mới nếu đang ở ngoài request (job nền). */
export function currentRequestId(): string {
  return storage.getStore()?.requestId ?? `bg-${randomUUID()}`;
}

/** Actor hiện tại; null khi request chưa xác thực hoặc là job hệ thống. */
export function currentActor(): AuthenticatedActor | null {
  return storage.getStore()?.actor ?? null;
}

/** Chạy một hàm trong ngữ cảnh chỉ định – dùng cho outbox worker và test. */
export function runInRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export const REQUEST_ID_HEADER = 'x-request-id';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // Tôn trọng requestId do edge/ingress sinh ra để nối được trace xuyên tầng,
    // nhưng chỉ khi nó có dạng an toàn (tránh header injection vào log).
    const inbound = req.header(REQUEST_ID_HEADER);
    const requestId =
      inbound && /^[A-Za-z0-9_-]{8,64}$/.test(inbound) ? inbound : randomUUID();

    const context: RequestContext = {
      requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
      actor: null,
    };

    res.setHeader(REQUEST_ID_HEADER, requestId);
    // Gắn lên req để interceptor/filter đọc được kể cả khi ALS bị mất ngữ cảnh.
    (req as Request & { sosContext?: RequestContext }).sosContext = context;

    storage.run(context, () => next());
  }
}

/** Lấy context đã gắn vào request object (fallback khi ALS không khả dụng). */
export function contextFromRequest(req: unknown): RequestContext | null {
  return (req as { sosContext?: RequestContext } | null)?.sosContext ?? null;
}
