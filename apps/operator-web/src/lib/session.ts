'use client';

import type { UserRole } from '@/contracts/generated/api-contract';

/**
 * Phiên đăng nhập của người trực.
 *
 * Lưu trong `sessionStorage` chứ không phải `localStorage`: token biến mất khi
 * đóng tab. Máy trạm tổng đài thường dùng chung, nên phiên không được sống lâu
 * hơn ca trực (threat model – "Lost phone"/"Insider abuse").
 *
 * Đây là giải pháp cho Pilot. Khi dựng cổng OIDC theo SOS-004, thay bằng cookie
 * `HttpOnly; Secure; SameSite=Strict` do backend đặt.
 */

const SESSION_KEY = 'sos-aid.operator.session';

export interface OperatorSession {
  accessToken: string;
  refreshToken: string;
  user: { id: string; fullName: string | null; roles: UserRole[] };
  devLogin: boolean;
}

export function saveSession(session: OperatorSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Trình duyệt chặn storage (chế độ riêng tư): phiên chỉ sống trong bộ nhớ.
  }
}

export function loadSession(): OperatorSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as OperatorSession) : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Không có gì để xoá.
  }
}
