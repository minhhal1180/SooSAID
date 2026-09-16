'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api';
import { clearSession, loadSession, type OperatorSession } from '@/lib/session';

/**
 * Khung chung cho các trang cần đăng nhập: kiểm tra phiên, hiển thị băng cảnh
 * báo môi trường, và cho phép kết thúc ca trực.
 *
 * Băng cảnh báo là yêu cầu vận hành, không phải trang trí: người trực phải luôn
 * thấy rõ mình đang ở chế độ mô phỏng hay dữ liệu không bền vững (runbook §
 * degraded-mode banner).
 */

interface HealthSnapshot {
  status: string;
  environment: string;
  degraded: { persistence: boolean; cache: boolean; video: boolean };
  policy: { recordingEnabled: boolean; emsIntegrationMode: string };
}

export function AppShell({
  children,
  session,
  connectionState,
}: {
  children: React.ReactNode;
  session: OperatorSession;
  connectionState?: 'connected' | 'disconnected';
}) {
  const router = useRouter();
  const [health, setHealth] = useState<HealthSnapshot | null>(null);

  useEffect(() => {
    apiRequest<HealthSnapshot>('/health')
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  function endShift(): void {
    clearSession();
    router.push('/');
  }

  const warnings = buildWarnings(health, session.devLogin);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {warnings.length > 0 && <div className="env-banner">{warnings.join(' · ')}</div>}

      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '12px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-panel)',
        }}
      >
        <div className="row">
          <strong style={{ fontSize: 17 }}>S.O.S Aid</strong>
          <span className="muted">Trực cấp cứu</span>
        </div>

        <div className="row">
          {connectionState && (
            <span
              className={`badge ${connectionState === 'connected' ? 'badge-active' : 'badge-warn'}`}
              title={
                connectionState === 'connected'
                  ? 'Đang nhận cập nhật thời gian thực'
                  : 'Mất kết nối realtime – danh sách có thể chậm, hãy tải lại'
              }
            >
              {connectionState === 'connected' ? 'Realtime: đang bật' : 'Realtime: mất kết nối'}
            </span>
          )}
          <span className="muted">
            {session.user.fullName ?? session.user.id} · {session.user.roles.join(', ')}
          </span>
          <button onClick={endShift}>Kết thúc ca</button>
        </div>
      </header>

      <main style={{ flex: 1, padding: 20 }}>{children}</main>
    </div>
  );
}

function buildWarnings(health: HealthSnapshot | null, devLogin: boolean): string[] {
  const warnings: string[] = [];

  if (devLogin) warnings.push('ĐĂNG NHẬP DIỄN TẬP (không qua OIDC/MFA)');
  if (!health) return warnings;

  if (health.policy.emsIntegrationMode === 'mock') {
    warnings.push('CHẾ ĐỘ MÔ PHỎNG – không kết nối 115 thật');
  }
  if (health.degraded.persistence) {
    warnings.push('DỮ LIỆU KHÔNG BỀN VỮNG (driver memory)');
  }
  if (health.degraded.video) {
    warnings.push('VIDEO KHÔNG KHẢ DỤNG – dùng phương án thoại');
  }

  return warnings;
}

/** Hook dùng chung: lấy phiên, đẩy về trang đăng nhập nếu chưa có. */
export function useRequiredSession(): OperatorSession | null {
  const router = useRouter();
  const [session, setSession] = useState<OperatorSession | null>(null);

  useEffect(() => {
    const existing = loadSession();
    if (!existing) {
      router.replace('/');
      return;
    }
    setSession(existing);
  }, [router]);

  return session;
}
