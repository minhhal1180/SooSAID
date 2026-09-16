'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { UserRole } from '@/contracts/generated/api-contract';
import { ApiClientError, apiRequest } from '@/lib/api';
import { loadSession, saveSession, type OperatorSession } from '@/lib/session';

/**
 * Màn hình đăng nhập của người trực.
 *
 * Đang dùng endpoint `POST /v1/auth/dev/login` — lối vào DÀNH RIÊNG cho môi
 * trường phát triển/diễn tập, backend chặn cứng ở production. Cổng OIDC/MFA
 * thật là hạng mục SOS-004 chưa được dựng; giao diện nói rõ điều đó thay vì
 * giả vờ đây là đăng nhập thật.
 */

const ROLE_OPTIONS: Array<{ role: UserRole; label: string; description: string }> = [
  {
    role: UserRole.OPERATOR_115,
    label: 'Tổng đài viên',
    description: 'Tiếp nhận ca, điều phối kíp xe, đóng ca',
  },
  {
    role: UserRole.CLINICIAN,
    label: 'Bác sĩ trực',
    description: 'Video call, gửi hướng dẫn, chốt hồ sơ bàn giao',
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = useState<UserRole>(UserRole.OPERATOR_115);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loadSession()) router.replace('/queue');
  }, [router]);

  async function handleLogin(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const session = await apiRequest<OperatorSession>('/auth/dev/login', {
        method: 'POST',
        body: { role },
      });
      saveSession(session);
      router.push('/queue');
    } catch (cause) {
      setError(
        cause instanceof ApiClientError
          ? `${cause.message} (mã ${cause.code})`
          : 'Không kết nối được tới máy chủ API. Kiểm tra backend đã chạy chưa.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
      <div className="panel" style={{ width: 'min(460px, 100%)' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22 }}>S.O.S Aid</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Bảng điều khiển tổng đài &amp; bác sĩ trực
        </p>

        <div
          className="error-box"
          style={{ borderColor: 'var(--warning)', color: 'var(--warning)', marginBottom: 16 }}
        >
          Đây là môi trường <strong>diễn tập/mô phỏng</strong>. Đăng nhập tạm thời không có
          mật khẩu và chỉ hoạt động khi <span className="mono">AUTH_DEV_OPERATOR_LOGIN=true</span>.
          Cổng xác thực OIDC/MFA theo SOS-004 chưa được triển khai.
        </div>

        <label className="muted" htmlFor="role-select">
          Vai trò trực
        </label>
        <select
          id="role-select"
          value={role}
          onChange={(event) => setRole(event.target.value as UserRole)}
          style={{ marginTop: 6, marginBottom: 4 }}
        >
          {ROLE_OPTIONS.map((option) => (
            <option key={option.role} value={option.role}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="muted" style={{ marginTop: 4 }}>
          {ROLE_OPTIONS.find((option) => option.role === role)?.description}
        </p>

        {error && (
          <div className="error-box" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}

        <button className="primary" onClick={handleLogin} disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Đang vào ca trực…' : 'Vào ca trực'}
        </button>
      </div>
    </main>
  );
}
