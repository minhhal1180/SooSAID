'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  CaseStatus,
  NoteType,
  UserRole,
  type EmergencyCaseView,
  type NearbyResult,
} from '@/contracts/generated/api-contract';
import { AppShell, useRequiredSession } from '@/components/app-shell';
import { CaseStatusBadge, CASE_STATUS_LABEL, elapsedLabel } from '@/components/case-status';
import { LocationPanel, type NearbyResourceView } from '@/components/location-panel';
import { ApiClientError, apiRequest } from '@/lib/api';
import { connectRealtime, type RealtimeConnection } from '@/lib/realtime';

/**
 * Workspace xử lý một ca (W02, SOS-015).
 *
 * Bố cục theo TDD §8.2: cột trái vị trí, cột giữa video + hướng dẫn, cột phải
 * triage/ghi chú/trạng thái/điều phối/bàn giao — để người trực nhìn thấy mọi
 * thứ cần thiết mà không phải chuyển màn hình.
 */

interface TriageItem {
  id: string;
  questionnaireVersion: string;
  answers: Array<{ questionCode: string; value: string }>;
  submittedAt: string;
}

interface TimelineData {
  statusHistory: Array<{ at: string; fromStatus: string | null; toStatus: string; reason: string | null }>;
  notes: Array<{ id: string; at: string; noteType: string; text: string }>;
}

interface GuidanceItem {
  id: string;
  code: string;
  version: number;
  title: string;
  content: { summary?: string; steps?: Array<{ order: number; text: string }> };
  drillOnly: boolean;
}

interface AssignmentItem {
  id: string;
  assignmentType: string;
  status: string;
  assignedAt: string;
}

interface DispatchCandidates {
  ambulanceUnits: Array<{ id: string; code: string; displayName: string; status: string }>;
  responders: Array<{ id: string; userId: string; skills: string[]; distanceMeters: number }>;
}

const TRIAGE_ANSWER_LABEL: Readonly<Record<string, string>> = {
  yes: 'Có',
  no: 'Không',
  unknown: 'Không rõ',
};

const TRIAGE_QUESTION_LABEL: Readonly<Record<string, string>> = {
  responsive: 'Có phản ứng khi gọi',
  breathing_visible: 'Thấy lồng ngực di động',
  visible_bleeding: 'Có chảy máu thấy rõ',
  able_to_speak: 'Nói được thành câu',
  recent_fall_or_impact: 'Vừa ngã/va đập',
  scene_hazard: 'Hiện trường còn nguy hiểm',
};

export default function CaseWorkspacePage() {
  const router = useRouter();
  const params = useParams<{ caseId: string }>();
  const caseId = params.caseId;
  const session = useRequiredSession();

  const [caseData, setCaseData] = useState<EmergencyCaseView | null>(null);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [triage, setTriage] = useState<TriageItem[]>([]);
  const [guides, setGuides] = useState<GuidanceItem[]>([]);
  const [assignments, setAssignments] = useState<AssignmentItem[]>([]);
  const [candidates, setCandidates] = useState<DispatchCandidates | null>(null);
  const [resources, setResources] = useState<NearbyResult<NearbyResourceView> | null>(null);
  const [videoInfo, setVideoInfo] = useState<{ room: string; expiresAt: string } | null>(null);

  const [noteText, setNoteText] = useState('');
  const [statusReason, setStatusReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);

  const connectionRef = useRef<RealtimeConnection | null>(null);
  const token = session?.accessToken ?? null;

  /** Tải lại toàn bộ snapshot của ca – dùng cả khi mở trang và khi có event. */
  const loadCase = useCallback(async (): Promise<void> => {
    if (!token) return;

    try {
      const detail = await apiRequest<EmergencyCaseView>(`/emergency-cases/${caseId}`, { token });
      setCaseData(detail);
      setError(null);

      // Các phần phụ tải song song; phần nào lỗi thì bỏ qua phần đó chứ không
      // làm hỏng cả màn hình xử lý ca.
      const [timelineData, triageData, guideData, assignmentData] = await Promise.allSettled([
        apiRequest<TimelineData>(`/emergency-cases/${caseId}/timeline`, { token }),
        apiRequest<{ items: TriageItem[] }>(`/emergency-cases/${caseId}/triage`, { token }),
        apiRequest<{ items: GuidanceItem[] }>('/first-aid-guides', { token }),
        apiRequest<{ items: AssignmentItem[] }>(`/emergency-cases/${caseId}/dispatch`, { token }),
      ]);

      if (timelineData.status === 'fulfilled') setTimeline(timelineData.value);
      if (triageData.status === 'fulfilled') setTriage(triageData.value.items);
      if (guideData.status === 'fulfilled') setGuides(guideData.value.items);
      if (assignmentData.status === 'fulfilled') setAssignments(assignmentData.value.items);

      if (detail.latestLocation) {
        const { lat, lng } = detail.latestLocation;
        const nearby = await apiRequest<NearbyResult<NearbyResourceView>>(
          `/resources/nearby?lat=${lat}&lng=${lng}`,
          { token },
        ).catch(() => null);
        setResources(nearby);
      }
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : 'Không tải được dữ liệu ca.');
    }
  }, [caseId, token]);

  useEffect(() => {
    if (!token) return;

    void loadCase();

    const connection = connectRealtime(token, {
      onConnectionChange: setConnected,
      onCaseEvent: () => void loadCase(),
      onResync: () => void loadCase(),
    });
    connection.subscribeToCase(caseId);
    connectionRef.current = connection;

    return () => {
      connection.unsubscribeFromCase(caseId);
      connection.disconnect();
      connectionRef.current = null;
    };
  }, [caseId, token, loadCase]);

  /** Bọc mọi hành động: khoá nút, hiện lỗi rõ ràng, luôn tải lại snapshot. */
  async function runAction(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await loadCase();
    } catch (cause) {
      setError(
        cause instanceof ApiClientError
          ? `${cause.message} (mã ${cause.code})`
          : 'Thao tác không thực hiện được.',
      );
    } finally {
      setBusy(false);
    }
  }

  const transitionTo = (toStatus: CaseStatus) =>
    runAction(async () => {
      await apiRequest(`/emergency-cases/${caseId}/status`, {
        method: 'POST',
        token,
        body: { toStatus, reason: statusReason.trim() || undefined },
      });
      setStatusReason('');
    });

  const addNote = () =>
    runAction(async () => {
      await apiRequest(`/emergency-cases/${caseId}/notes`, {
        method: 'POST',
        token,
        body: { text: noteText.trim(), noteType: NoteType.CLINICAL_OBSERVATION },
      });
      setNoteText('');
    });

  const joinVideo = () =>
    runAction(async () => {
      const info = await apiRequest<{ room: string; expiresAt: string }>(
        `/emergency-cases/${caseId}/video/session`,
        { method: 'POST', token, body: {} },
      );
      setVideoInfo(info);
    });

  const sendGuidance = (guidanceId: string) =>
    runAction(async () => {
      await apiRequest(`/emergency-cases/${caseId}/guidance`, {
        method: 'POST',
        token,
        body: { guidanceId },
      });
    });

  const loadCandidates = () =>
    runAction(async () => {
      setCandidates(
        await apiRequest<DispatchCandidates>(`/emergency-cases/${caseId}/dispatch/candidates`, {
          token,
        }),
      );
    });

  const dispatchTo = (targetType: 'ambulance_unit' | 'local_responder', targetId: string) =>
    runAction(async () => {
      await apiRequest(`/emergency-cases/${caseId}/dispatch`, {
        method: 'POST',
        token,
        body: { targetType, targetId },
      });
    });

  const finalizeHandover = () =>
    runAction(async () => {
      await apiRequest(`/emergency-cases/${caseId}/handover`, {
        method: 'POST',
        token,
        body: {},
      });
    });

  if (!session) return null;

  const isClinician = session.user.roles.includes(UserRole.CLINICIAN);

  return (
    <AppShell session={session} connectionState={connected ? 'connected' : 'disconnected'}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <div className="row">
          <button onClick={() => router.push('/queue')}>← Hàng đợi</button>
          {caseData && (
            <>
              <strong className="mono" style={{ fontSize: 18 }}>
                {caseData.code}
              </strong>
              <CaseStatusBadge status={caseData.status} />
              <span className="muted">Tạo {elapsedLabel(caseData.createdAt)}</span>
            </>
          )}
        </div>
        <button onClick={() => void loadCase()}>Tải lại</button>
      </div>

      {error && (
        <div className="error-box" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      {!caseData ? (
        <div className="panel">
          <p className="muted" style={{ margin: 0 }}>
            Đang tải dữ liệu ca…
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(260px, 1fr) minmax(320px, 1.2fr) minmax(300px, 1fr)',
            gap: 16,
            alignItems: 'start',
          }}
        >
          {/* --- Cột trái: vị trí --- */}
          <LocationPanel
            location={caseData.latestLocation}
            addressText={caseData.addressText}
            accessNote={caseData.accessNote}
            resources={resources}
          />

          {/* --- Cột giữa: video + hướng dẫn --- */}
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="panel">
              <h2>Kết nối video</h2>
              {videoInfo ? (
                <>
                  <p style={{ margin: '0 0 6px' }}>
                    Phòng <span className="mono">{videoInfo.room}</span>
                  </p>
                  <p className="muted" style={{ marginTop: 0 }}>
                    Token hết hạn lúc {new Date(videoInfo.expiresAt).toLocaleTimeString('vi-VN')}.
                    Driver hiện tại là <span className="mono">mock</span> nên chưa có luồng media
                    thật; luồng nghiệp vụ và trạng thái ca vẫn chạy đúng.
                  </p>
                </>
              ) : (
                <p className="muted" style={{ marginTop: 0 }}>
                  Chưa tham gia phòng video của ca này.
                </p>
              )}
              <button className="primary" onClick={() => void joinVideo()} disabled={busy}>
                Tham gia phòng video
              </button>
              <p className="muted" style={{ marginBottom: 0 }}>
                Nếu video không kết nối được: chuyển sang thoại và tiếp tục xử lý ca bình thường.
              </p>
            </div>

            <div className="panel">
              <h2>Hướng dẫn sơ cấp cứu</h2>
              {guides.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  Chưa có nội dung hướng dẫn khả dụng.
                </p>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {guides.map((guide) => (
                    <div
                      key={guide.id}
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        padding: 10,
                      }}
                    >
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <strong>{guide.title}</strong>
                        {guide.drillOnly && (
                          <span className="badge badge-warn" title="Chưa được chuyên gia y tế phê duyệt">
                            Nội dung diễn tập
                          </span>
                        )}
                      </div>
                      {guide.content.summary && (
                        <p className="muted" style={{ margin: '4px 0' }}>
                          {guide.content.summary}
                        </p>
                      )}
                      <button onClick={() => void sendGuidance(guide.id)} disabled={busy}>
                        Gửi cho người tại hiện trường
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* --- Cột phải: triage, ghi chú, trạng thái, điều phối, bàn giao --- */}
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="panel">
              <h2>Dấu hiệu quan sát được</h2>
              {triage.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  Người tại hiện trường chưa gửi phiếu quan sát.
                </p>
              ) : (
                triage.map((submission) => (
                  <div key={submission.id} style={{ marginBottom: 10 }}>
                    <div className="muted">
                      {new Date(submission.submittedAt).toLocaleTimeString('vi-VN')} · bộ câu hỏi{' '}
                      {submission.questionnaireVersion}
                    </div>
                    <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                      {submission.answers.map((answer) => (
                        <li key={answer.questionCode}>
                          {TRIAGE_QUESTION_LABEL[answer.questionCode] ?? answer.questionCode}:{' '}
                          <strong>{TRIAGE_ANSWER_LABEL[answer.value] ?? answer.value}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
              <p className="muted" style={{ marginBottom: 0 }}>
                Đây là ghi nhận quan sát, không phải chẩn đoán.
              </p>
            </div>

            <div className="panel">
              <h2>Chuyển trạng thái</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                Hiện tại: <strong>{CASE_STATUS_LABEL[caseData.status]}</strong>
              </p>
              <input
                placeholder="Lý do (bắt buộc khi báo nhầm/hủy ca)"
                value={statusReason}
                onChange={(event) => setStatusReason(event.target.value)}
                style={{ marginBottom: 8 }}
              />
              <div className="row">
                <button onClick={() => void transitionTo(CaseStatus.DISPATCHED)} disabled={busy}>
                  Đã điều phối
                </button>
                <button
                  onClick={() => void transitionTo(CaseStatus.HANDOVER_PENDING)}
                  disabled={busy}
                >
                  Chuẩn bị bàn giao
                </button>
                {isClinician && (
                  <button onClick={() => void transitionTo(CaseStatus.HANDED_OVER)} disabled={busy}>
                    Đã bàn giao
                  </button>
                )}
                <button onClick={() => void transitionTo(CaseStatus.CLOSED)} disabled={busy}>
                  Đóng ca
                </button>
                <button
                  className="danger"
                  onClick={() => void transitionTo(CaseStatus.FALSE_ALARM)}
                  disabled={busy}
                >
                  Báo nhầm
                </button>
              </div>
            </div>

            <div className="panel">
              <h2>Điều phối</h2>
              {assignments.length > 0 && (
                <ul style={{ margin: '0 0 10px', paddingLeft: 18 }}>
                  {assignments.map((assignment) => (
                    <li key={assignment.id}>
                      {assignment.assignmentType === 'AMBULANCE_UNIT' ? 'Kíp xe' : 'Người hỗ trợ'} ·{' '}
                      <strong>{assignment.status}</strong>{' '}
                      <span className="muted">{elapsedLabel(assignment.assignedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}

              <button onClick={() => void loadCandidates()} disabled={busy}>
                Xem lực lượng khả dụng
              </button>

              {candidates && (
                <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                  {candidates.ambulanceUnits.map((unit) => (
                    <div key={unit.id} className="row" style={{ justifyContent: 'space-between' }}>
                      <span>
                        {unit.displayName} <span className="muted">({unit.code})</span>
                      </span>
                      <button
                        onClick={() => void dispatchTo('ambulance_unit', unit.id)}
                        disabled={busy}
                      >
                        Điều động
                      </button>
                    </div>
                  ))}
                  {candidates.responders.map((responder) => (
                    <div
                      key={responder.id}
                      className="row"
                      style={{ justifyContent: 'space-between' }}
                    >
                      <span>
                        Người hỗ trợ tại chỗ{' '}
                        <span className="muted">({responder.distanceMeters} m)</span>
                      </span>
                      <button
                        onClick={() => void dispatchTo('local_responder', responder.id)}
                        disabled={busy}
                      >
                        Điều động
                      </button>
                    </div>
                  ))}
                  {candidates.ambulanceUnits.length === 0 &&
                    candidates.responders.length === 0 && (
                      <p className="muted" style={{ margin: 0 }}>
                        Không có lực lượng nào sẵn sàng trong phạm vi.
                      </p>
                    )}
                </div>
              )}
            </div>

            <div className="panel">
              <h2>Ghi chú chuyên môn</h2>
              <textarea
                rows={3}
                placeholder="Ghi nhận diễn biến, thao tác đã hướng dẫn…"
                value={noteText}
                onChange={(event) => setNoteText(event.target.value)}
              />
              <button
                onClick={() => void addNote()}
                disabled={busy || noteText.trim().length === 0}
                style={{ marginTop: 8 }}
              >
                Thêm ghi chú
              </button>

              {timeline && timeline.notes.length > 0 && (
                <ul style={{ marginTop: 12, paddingLeft: 18 }}>
                  {timeline.notes.map((note) => (
                    <li key={note.id} style={{ marginBottom: 6 }}>
                      <span className="muted">
                        {new Date(note.at).toLocaleTimeString('vi-VN')} ·{' '}
                      </span>
                      {note.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="panel">
              <h2>Hồ sơ bàn giao</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                Chốt hồ sơ tạo một phiên bản bất biến gồm timeline, phiếu quan sát, hướng dẫn đã
                gửi và thông tin điều phối. Sửa nội dung = tạo phiên bản mới.
              </p>
              <button className="primary" onClick={() => void finalizeHandover()} disabled={busy}>
                Chốt hồ sơ bàn giao
              </button>
            </div>

            {timeline && (
              <div className="panel">
                <h2>Dòng thời gian</h2>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {timeline.statusHistory.map((entry, index) => (
                    <li key={`${entry.at}-${index}`}>
                      <span className="muted">
                        {new Date(entry.at).toLocaleTimeString('vi-VN')} ·{' '}
                      </span>
                      {entry.fromStatus
                        ? `${CASE_STATUS_LABEL[entry.fromStatus as CaseStatus] ?? entry.fromStatus} → `
                        : ''}
                      {CASE_STATUS_LABEL[entry.toStatus as CaseStatus] ?? entry.toStatus}
                      {entry.reason ? ` (${entry.reason})` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
