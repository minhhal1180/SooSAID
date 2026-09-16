import { ApiErrorCode } from '../../contracts/generated/api-contract';

/**
 * Lỗi nghiệp vụ của domain.
 *
 * Service ném `DomainError`; `DomainExceptionFilter` map sang HTTP status +
 * envelope lỗi của Rule 6.2. Domain không biết gì về HTTP.
 *
 * Threat model – "Error response không lộ stack trace": `message` ở đây là thông
 * điệp an toàn để trả cho client. Chi tiết kỹ thuật đi vào `internalContext`,
 * chỉ để log, không bao giờ serialize ra response.
 */
export class DomainError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details: unknown[] = [],
    readonly internalContext: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

/** HTTP status tương ứng từng mã lỗi (ADR-003). */
export const HTTP_STATUS_BY_ERROR_CODE: Readonly<Record<ApiErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  CASE_INVALID_TRANSITION: 409,
  CASE_ALREADY_ACCEPTED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  GUIDANCE_NOT_APPROVED: 409,
  CONSENT_REQUIRED: 403,
  RATE_LIMITED: 429,
  PROVIDER_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

// --- Factory cho các lỗi hay dùng, để service không phải nhớ mã lỗi ---------

export const DomainErrors = {
  notFound(resource: string, context: Record<string, unknown> = {}): DomainError {
    // Không tiết lộ id/thuộc tính của resource ngoài scope người gọi (TC-025):
    // "không tồn tại" và "không có quyền" trả cùng một thông điệp.
    return new DomainError(
      ApiErrorCode.NOT_FOUND,
      `Không tìm thấy ${resource} hoặc bạn không có quyền truy cập.`,
      [],
      context,
    );
  },

  forbidden(reason: string, context: Record<string, unknown> = {}): DomainError {
    return new DomainError(ApiErrorCode.FORBIDDEN, reason, [], context);
  },

  unauthenticated(reason = 'Yêu cầu chưa được xác thực.'): DomainError {
    return new DomainError(ApiErrorCode.UNAUTHENTICATED, reason);
  },

  validation(message: string, details: unknown[] = []): DomainError {
    return new DomainError(ApiErrorCode.VALIDATION_FAILED, message, details);
  },

  conflict(message: string, context: Record<string, unknown> = {}): DomainError {
    return new DomainError(ApiErrorCode.CONFLICT, message, [], context);
  },

  rateLimited(message: string, retryAfterSeconds: number): DomainError {
    return new DomainError(ApiErrorCode.RATE_LIMITED, message, [{ retryAfterSeconds }]);
  },

  providerUnavailable(provider: string, context: Record<string, unknown> = {}): DomainError {
    // Không trả raw error của provider cho client (TDD §10.1).
    return new DomainError(
      ApiErrorCode.PROVIDER_UNAVAILABLE,
      `Dịch vụ ${provider} tạm thời không khả dụng. Hãy dùng phương án dự phòng.`,
      [],
      context,
    );
  },
};
