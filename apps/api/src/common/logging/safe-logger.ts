import { Injectable, LoggerService, Scope } from '@nestjs/common';

/**
 * Logger tuân Rule 11.
 *
 * KHÔNG được log: CCCD, số điện thoại đầy đủ, hình ảnh, video URL có chữ ký,
 * thông tin y tế, OTP, raw token.
 * ĐƯỢC log: caseId, userId, event, timestamp, status, requestId.
 *
 * Thay vì tin vào kỷ luật của người viết code, logger này **lọc chủ động**:
 * mọi field không nằm trong allow-list bị loại bỏ, và giá trị dạng số điện
 * thoại / token / URL có chữ ký bị che ngay cả khi lọt vào field hợp lệ.
 */

/** Chỉ những khóa này được phép xuất hiện nguyên vẹn trong log có cấu trúc. */
const ALLOWED_CONTEXT_KEYS: ReadonlySet<string> = new Set([
  'requestId',
  'caseId',
  'caseCode',
  'userId',
  'actorUserId',
  'operatorId',
  'deviceId',
  'assignmentId',
  'sessionId',
  'handoverId',
  'event',
  'eventType',
  'status',
  'fromStatus',
  'toStatus',
  'role',
  'roles',
  'provider',
  'driver',
  'channel',
  'templateCode',
  'durationMs',
  'attempt',
  'result',
  'errorCode',
  'method',
  'path',
  'statusCode',
  'count',
  'serviceAreaId',
  'questionnaireVersion',
  'guidanceCode',
  'guidanceVersion',
]);

const REDACTED = '[REDACTED]';

/**
 * Khớp chuỗi trông như số điện thoại VN/quốc tế: 8–15 chữ số, cho phép dấu
 * cách/chấm/gạch xen giữa.
 *
 * Hai lookaround `(?<![\w-])` / `(?![\w-])` là thiết yếu, không phải tinh chỉnh:
 * thiếu chúng thì `SOS-20260916-000021` và UUID `2222...-2222-...` cũng bị che,
 * làm mất chính những trường mà Rule 11 CHO PHÉP log (`caseCode`, `userId`) và
 * khiến log vô dụng khi truy vết sự cố.
 */
const PHONE_LIKE = /(?<![\w-])(\+?\d(?:[\s.-]?\d){7,14})(?![\w-])/g;
/** Khớp JWT hoặc presigned URL (query có chữ ký). */
const TOKEN_LIKE = /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g;
const SIGNED_URL_LIKE = /\bhttps?:\/\/\S*[?&](?:X-Amz-Signature|signature|token|sig)=\S*/gi;

/** Che một phần số điện thoại: chỉ giữ 3 số cuối để đối soát. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return REDACTED;
  return `***${digits.slice(-3)}`;
}

/** Che các mẫu nhạy cảm trong một chuỗi tự do (message của log). */
export function redactText(text: string): string {
  return text
    .replace(SIGNED_URL_LIKE, REDACTED)
    .replace(TOKEN_LIKE, REDACTED)
    .replace(PHONE_LIKE, (match) => maskPhone(match));
}

/** Lọc context: bỏ mọi khóa ngoài allow-list, che giá trị nhạy cảm còn sót. */
export function redactContext(context: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (!ALLOWED_CONTEXT_KEYS.has(key)) continue;
    safe[key] = typeof value === 'string' ? redactText(value) : value;
  }
  return safe;
}

export interface LogContext extends Record<string, unknown> {
  requestId?: string;
  caseId?: string;
  userId?: string;
}

@Injectable({ scope: Scope.TRANSIENT })
export class SafeLogger implements LoggerService {
  private scopeName = 'app';

  setContext(scopeName: string): this {
    this.scopeName = scopeName;
    return this;
  }

  log(message: string, context: LogContext = {}): void {
    this.write('info', message, context);
  }

  warn(message: string, context: LogContext = {}): void {
    this.write('warn', message, context);
  }

  /**
   * `error` KHÔNG nhận đối tượng Error trực tiếp: stack trace có thể chứa giá trị
   * biến nhạy cảm. Gọi bên gọi tự rút gọn thành mã lỗi + context an toàn.
   */
  error(message: string, context: LogContext = {}): void {
    this.write('error', message, context);
  }

  debug(message: string, context: LogContext = {}): void {
    this.write('debug', message, context);
  }

  verbose(message: string, context: LogContext = {}): void {
    this.write('debug', message, context);
  }

  private write(level: string, message: string, context: LogContext): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      scope: this.scopeName,
      message: redactText(message),
      ...redactContext(context),
    };
    // Một dòng JSON mỗi log để hệ thống log tập trung parse được (TDD §20).
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  }
}
