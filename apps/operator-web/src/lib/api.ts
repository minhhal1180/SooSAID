import type { ApiResponse } from '@/contracts/generated/api-contract';

/**
 * Client gọi API.
 *
 * Tự gỡ envelope của Rule 6.2 / ADR-003 và biến lỗi thành `ApiClientError` mang
 * theo `code` + `requestId` — nhờ đó UI hiển thị được đúng thông điệp và người
 * vận hành đối chiếu được với log server.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/v1';

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId: string,
    readonly status: number,
    readonly details: unknown[] = [],
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
  /** Bắt buộc cho các POST có thể bị retry (FR-002). */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    cache: 'no-store',
  });

  // 204 No Content không có body để parse.
  if (response.status === 204) return undefined as T;

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiClientError(
      'INVALID_RESPONSE',
      'Máy chủ trả về dữ liệu không đọc được.',
      '',
      response.status,
    );
  }

  if (!payload.success) {
    throw new ApiClientError(
      payload.error.code,
      payload.error.message,
      payload.requestId,
      response.status,
      payload.error.details ?? [],
    );
  }

  return payload.data;
}

/** Sinh Idempotency-Key. `crypto.randomUUID` có sẵn trong mọi trình duyệt hiện đại. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
