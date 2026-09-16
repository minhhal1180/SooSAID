import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiErrorCode, type ApiErrorBody } from '../../contracts/generated/api-contract';
import { DomainError, HTTP_STATUS_BY_ERROR_CODE } from '../errors/domain-error';
import { SafeLogger } from '../logging/safe-logger';
import { contextFromRequest, currentRequestId } from './request-context';

/**
 * Map mọi exception về envelope lỗi của Rule 6.2 / ADR-003.
 *
 * Ba nguồn exception:
 *   1. `DomainError`   – lỗi nghiệp vụ, có mã riêng, message an toàn cho client.
 *   2. `HttpException` – chủ yếu từ ValidationPipe và guard của Nest.
 *   3. Còn lại          – lỗi lập trình/hạ tầng: trả 500 với message chung chung.
 *
 * Threat model: response lỗi KHÔNG BAO GIỜ chứa stack trace hay message gốc của
 * exception không xác định — chúng có thể lộ cấu trúc DB, đường dẫn file, hoặc
 * giá trị dữ liệu nhạy cảm.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new SafeLogger().setContext('http');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;

    const http = host.switchToHttp();
    const request = http.getRequest<{ method?: string; url?: string }>();
    const response = http.getResponse<Response>();
    const requestId = contextFromRequest(request)?.requestId ?? currentRequestId();

    const { status, body, internalContext } = this.translate(exception, requestId);

    this.logger.warn('request_failed', {
      requestId,
      method: request?.method,
      path: request?.url,
      statusCode: status,
      errorCode: body.error.code,
      ...internalContext,
    });

    response.status(status).json(body);
  }

  private translate(
    exception: unknown,
    requestId: string,
  ): { status: number; body: ApiErrorBody; internalContext: Record<string, unknown> } {
    if (exception instanceof DomainError) {
      return {
        status: HTTP_STATUS_BY_ERROR_CODE[exception.code],
        body: {
          success: false,
          error: {
            code: exception.code,
            message: exception.message,
            details: exception.details,
          },
          requestId,
        },
        internalContext: exception.internalContext,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      // ValidationPipe trả { message: string[] } – đó là danh sách field lỗi,
      // an toàn để trả về vì chỉ mô tả ràng buộc schema, không chứa dữ liệu.
      const details =
        typeof payload === 'object' && payload !== null && 'message' in payload
          ? toDetails((payload as { message: unknown }).message)
          : [];

      return {
        status,
        body: {
          success: false,
          error: {
            code: mapHttpStatusToErrorCode(status),
            message: defaultMessageForStatus(status),
            details,
          },
          requestId,
        },
        internalContext: {},
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        success: false,
        error: {
          code: ApiErrorCode.INTERNAL_ERROR,
          message: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại hoặc dùng phương án dự phòng.',
          details: [],
        },
        requestId,
      },
      // Tên lớp exception là đủ để lần ra trong log mà không lộ nội dung.
      internalContext: { errorCode: (exception as Error)?.name ?? 'UnknownError' },
    };
  }
}

function toDetails(message: unknown): unknown[] {
  if (Array.isArray(message)) return message;
  if (typeof message === 'string') return [message];
  return [];
}

function mapHttpStatusToErrorCode(status: number): ApiErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return ApiErrorCode.VALIDATION_FAILED;
    case HttpStatus.UNAUTHORIZED:
      return ApiErrorCode.UNAUTHENTICATED;
    case HttpStatus.FORBIDDEN:
      return ApiErrorCode.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ApiErrorCode.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ApiErrorCode.CONFLICT;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ApiErrorCode.RATE_LIMITED;
    case HttpStatus.SERVICE_UNAVAILABLE:
      return ApiErrorCode.PROVIDER_UNAVAILABLE;
    default:
      return ApiErrorCode.INTERNAL_ERROR;
  }
}

function defaultMessageForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'Dữ liệu gửi lên không hợp lệ.';
    case HttpStatus.UNAUTHORIZED:
      return 'Yêu cầu chưa được xác thực.';
    case HttpStatus.FORBIDDEN:
      return 'Bạn không có quyền thực hiện thao tác này.';
    case HttpStatus.NOT_FOUND:
      return 'Không tìm thấy tài nguyên hoặc bạn không có quyền truy cập.';
    case HttpStatus.CONFLICT:
      return 'Thao tác xung đột với trạng thái hiện tại.';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.';
    default:
      return 'Đã xảy ra lỗi hệ thống.';
  }
}
