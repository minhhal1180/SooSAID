'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaseStatus, type EmergencyCaseView } from '@/contracts/generated/api-contract';
import { AppShell, useRequiredSession } from '@/components/app-shell';
import { CaseStatusBadge, elapsedLabel } from '@/components/case-status';
import { ApiClientError, apiRequest } from '@/lib/api';
import { connectRealtime, type RealtimeConnection } from '@/lib/realtime';

/**
 * Hàng đợi ca cấp cứu (W01, SOS-014).
 *
 * Realtime chỉ là TÍN HIỆU để tải lại; danh sách luôn được dựng từ snapshot
 * REST (TDD §10.3, TC-010). Cách này hơi tốn request hơn nhưng loại bỏ hẳn lớp
 * lỗi "danh sách trên màn hình khác dữ liệu thật" — thứ không chấp nhận được
 * trong một hàng đợi cấp cứu.
 */

/** Poll dự phòng khi realtime mất kết nối (runbook: Redis down → REST polling). */
const FALLBACK_POLL_INTERVAL_MS = 10_000;
/** Nhịp cập nhật nhãn "bao lâu rồi" để người trực thấy thời gian chờ tăng lên. */
const CLOCK_TICK_MS = 1_000;

export default function QueuePage() {
  const router = useRouter();
  const session = useRequiredSession();

  const [cases, setCases] = useState<EmergencyCaseView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const connectionRef = useRef<RealtimeConnection | null>(null);

  const loadQueue = useCallback(async (): Promise<void> => {
    if (!session) return;
    try {
      setCases(await apiRequest<EmergencyCaseView[]>('/operator/queue', { token: session.accessToken }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : 'Không tải được hàng đợi.');
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;

    void loadQueue();

    const connection = connectRealtime(session.accessToken, {
      onConnectionChange: setConnected,
      // Mọi event hàng đợi đều dẫn tới một lần tải lại snapshot.
      onQueueEvent: () => void loadQueue(),
      onResync: () => void loadQueue(),
    });
    connectionRef.current = connection;

    return () => {
      connection.disconnect();
      connectionRef.current = null;
    };
  }, [session, loadQueue]);

  // Poll dự phòng: chỉ chạy khi realtime đang mất kết nối.
  useEffect(() => {
    if (connected) return;
    const timer = setInterval(() => void loadQueue(), FALLBACK_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [connected, loadQueue]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  async function acceptCase(caseId: string): Promise<void> {
    if (!session) return;
    setAcceptingId(caseId);
    setError(null);

    try {
      await apiRequest(`/operator/cases/${caseId}/accept`, {
        method: 'POST',
        token: session.accessToken,
      });
      router.push(`/cases/${caseId}`);
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.code === 'CASE_ALREADY_ACCEPTED') {
        // TC-007: người khác đã nhận. Thông báo rõ rồi làm mới danh sách.
        setError('Ca này vừa được đồng nghiệp khác tiếp nhận.');
        void loadQueue();
      } else {
        setError(cause instanceof ApiClientError ? cause.message : 'Không tiếp nhận được ca.');
      }
    } finally {
      setAcceptingId(null);
    }
  }

  // Ca chưa có người nhận luôn nằm trên cùng, cũ nhất trước.
  const sortedCases = useMemo(() => {
    return [...cases].sort((a, b) => {
      const aWaiting = a.status === CaseStatus.QUEUED ? 0 : 1;
      const bWaiting = b.status === CaseStatus.QUEUED ? 0 : 1;
      if (aWaiting !== bWaiting) return aWaiting - bWaiting;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }, [cases]);

  const waitingCount = sortedCases.filter((item) => item.status === CaseStatus.QUEUED).length;

  if (!session) return null;

  return (
    <AppShell session={session} connectionState={connected ? 'connected' : 'disconnected'}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>
          Hàng đợi ca cấp cứu{' '}
          <span className="muted" style={{ fontSize: 15 }}>
            ({waitingCount} chờ tiếp nhận / {sortedCases.length} đang mở)
          </span>
        </h1>
        <button onClick={() => void loadQueue()}>Tải lại</button>
      </div>

      {error && (
        <div className="error-box" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      {sortedCases.length === 0 ? (
        <div className="panel">
          <p className="muted" style={{ margin: 0 }}>
            Không có ca nào đang mở. Ca mới sẽ tự xuất hiện tại đây.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {sortedCases.map((item) => (
            <div
              key={item.id}
              className="panel"
              style={{
                display: 'flex',
                gap: 16,
                alignItems: 'center',
                justifyContent: 'space-between',
                borderLeft:
                  item.status === CaseStatus.QUEUED
                    ? '4px solid var(--urgent)'
                    : '4px solid var(--border)',
              }}
            >
              <div>
                <div className="row">
                  <strong className="mono">{item.code}</strong>
                  <CaseStatusBadge status={item.status} />
                  {item.numberOfPatients > 1 && (
                    <span className="badge badge-warn">{item.numberOfPatients} nạn nhân</span>
                  )}
                </div>
                <div className="muted" style={{ marginTop: 6 }}>
                  Tạo {elapsedLabel(item.createdAt, now)}
                  {item.addressText ? ` · ${item.addressText}` : ''}
                  {item.latestLocation
                    ? ` · ${item.latestLocation.lat.toFixed(5)}, ${item.latestLocation.lng.toFixed(5)}`
                    : ' · chưa có toạ độ'}
                </div>
                {item.accessNote && (
                  <div className="muted" style={{ marginTop: 2 }}>
                    Tiếp cận: {item.accessNote}
                  </div>
                )}
              </div>

              <div className="row">
                {item.status === CaseStatus.QUEUED ? (
                  <button
                    className="primary"
                    onClick={() => void acceptCase(item.id)}
                    disabled={acceptingId === item.id}
                  >
                    {acceptingId === item.id ? 'Đang nhận…' : 'Tiếp nhận'}
                  </button>
                ) : (
                  <button onClick={() => router.push(`/cases/${item.id}`)}>Mở ca</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
