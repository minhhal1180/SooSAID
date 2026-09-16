import type { EmergencyCaseRow } from '../../../persistence/rows';
import { casePhaseOf } from '../../../contracts/generated/api-contract';

/**
 * Dựng nội dung hồ sơ bàn giao (FR-013).
 *
 * Hàm thuần, không I/O — dễ kiểm thử và dễ rà soát: đây là tài liệu được giao
 * cho nhân viên y tế, nên nội dung của nó phải suy ra được hoàn toàn từ đầu vào.
 *
 * Nguyên tắc nội dung (TDD §7.2 bước 9, FR-013):
 *  - Chỉ gồm SỰ KIỆN đã xảy ra và DỮ LIỆU đã ghi nhận.
 *  - KHÔNG có kết luận, không đánh giá mức độ, không gợi ý xử trí (Rule 1.2).
 *  - Media chỉ ở dạng tham chiếu (`storage_key`), không nhúng nội dung (Rule 4.2).
 */

/** Phiên bản cấu trúc payload – đổi cấu trúc thì tăng số này. */
export const HANDOVER_PAYLOAD_SCHEMA_VERSION = 1;

export interface HandoverSourceData {
  readonly caseRow: EmergencyCaseRow;
  readonly statusHistory: Array<{
    at: string;
    fromStatus: string | null;
    toStatus: string;
    reason: string | null;
    changedBy: string | null;
  }>;
  readonly notes: Array<{ at: string; noteType: string; text: string; authorUserId: string | null }>;
  readonly triageSubmissions: Array<{
    submittedAt: string;
    questionnaireVersion: string;
    answers: Array<{ questionCode: string; value: string }>;
  }>;
  readonly guidanceLog: Array<{
    at: string;
    action: string;
    guidanceCode: string | null;
    guidanceVersion: number | null;
    title: string | null;
  }>;
  readonly assignments: Array<{
    assignmentType: string;
    status: string;
    assignedAt: string;
    acceptedAt: string | null;
    arrivedAt: string | null;
  }>;
  readonly locationTrail: Array<{
    capturedAt: string;
    lat: number;
    lng: number;
    accuracyMeters: number | null;
  }>;
  readonly mediaReferences: Array<{
    mediaType: string;
    storageKey: string;
    checksumSha256: string | null;
  }>;
  /** Ảnh chụp hồ sơ sức khỏe – chỉ có khi người dùng đã đồng ý chia sẻ. */
  readonly emergencyProfileSnapshot: Record<string, unknown> | null;
}

export interface HandoverPayload {
  schemaVersion: number;
  generatedAt: string;
  case: {
    id: string;
    code: string;
    status: string;
    phase: string;
    triggerSource: string;
    numberOfPatients: number;
    createdAt: string;
    acceptedAt: string | null;
    addressText: string | null;
    accessNote: string | null;
  };
  /** Vị trí gần nhất; toạ độ chi tiết nằm ở `locationTrail`. */
  latestLocation: { lat: number; lng: number; accuracyMeters: number | null } | null;
  timeline: Array<{ at: string; kind: string; summary: string; actorUserId: string | null }>;
  triage: HandoverSourceData['triageSubmissions'];
  guidancePerformed: HandoverSourceData['guidanceLog'];
  assignments: HandoverSourceData['assignments'];
  locationTrail: HandoverSourceData['locationTrail'];
  notes: HandoverSourceData['notes'];
  mediaReferences: HandoverSourceData['mediaReferences'];
  emergencyProfileSnapshot: Record<string, unknown> | null;
  /** Các mốc thời gian dùng cho KPI (FR-015). */
  keyTimestamps: Record<string, string | null>;
  disclaimer: string;
}

const HANDOVER_DISCLAIMER =
  'Hồ sơ này ghi lại dữ liệu và diễn biến do hệ thống S.O.S Aid thu thập trong giai đoạn ' +
  'trước khi lực lượng y tế tiếp cận. Hồ sơ KHÔNG chứa chẩn đoán, không thay thế bệnh án ' +
  'và không thay thế đánh giá chuyên môn của nhân viên y tế.';

export function buildHandoverPayload(
  source: HandoverSourceData,
  generatedAt: Date,
): HandoverPayload {
  const { caseRow } = source;

  return {
    schemaVersion: HANDOVER_PAYLOAD_SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    case: {
      id: caseRow.id,
      code: caseRow.code,
      status: caseRow.status,
      phase: casePhaseOf(caseRow.status),
      triggerSource: caseRow.trigger_source,
      numberOfPatients: caseRow.number_of_patients,
      createdAt: caseRow.created_at.toISOString(),
      acceptedAt: caseRow.accepted_at?.toISOString() ?? null,
      addressText: caseRow.address_text,
      accessNote: caseRow.access_note,
    },
    latestLocation: caseRow.latest_location
      ? {
          lat: caseRow.latest_location.lat,
          lng: caseRow.latest_location.lng,
          accuracyMeters: caseRow.latest_accuracy_meters,
        }
      : null,
    timeline: buildTimeline(source),
    triage: source.triageSubmissions,
    guidancePerformed: source.guidanceLog,
    assignments: source.assignments,
    locationTrail: source.locationTrail,
    notes: source.notes,
    mediaReferences: source.mediaReferences,
    emergencyProfileSnapshot: source.emergencyProfileSnapshot,
    keyTimestamps: buildKeyTimestamps(source),
    disclaimer: HANDOVER_DISCLAIMER,
  };
}

/** Gộp mọi loại sự kiện thành một dòng thời gian duy nhất, xếp theo thời điểm. */
function buildTimeline(source: HandoverSourceData): HandoverPayload['timeline'] {
  const entries: HandoverPayload['timeline'] = [];

  for (const change of source.statusHistory) {
    entries.push({
      at: change.at,
      kind: 'status',
      summary: change.fromStatus
        ? `Trạng thái ${change.fromStatus} → ${change.toStatus}${change.reason ? ` (${change.reason})` : ''}`
        : `Khởi tạo ở trạng thái ${change.toStatus}`,
      actorUserId: change.changedBy,
    });
  }

  for (const submission of source.triageSubmissions) {
    entries.push({
      at: submission.submittedAt,
      kind: 'triage',
      summary: `Gửi phiếu quan sát (bộ câu hỏi ${submission.questionnaireVersion}, ${submission.answers.length} câu)`,
      actorUserId: null,
    });
  }

  for (const guidance of source.guidanceLog) {
    entries.push({
      at: guidance.at,
      kind: 'guidance',
      summary: `Hướng dẫn ${guidance.guidanceCode ?? 'không rõ'} – ${guidance.action}`,
      actorUserId: null,
    });
  }

  for (const note of source.notes) {
    entries.push({
      at: note.at,
      kind: 'note',
      // Ghi chú đưa nguyên văn: đây là nhận định của nhân viên y tế, tóm tắt lại
      // sẽ làm mất thông tin.
      summary: `[${note.noteType}] ${note.text}`,
      actorUserId: note.authorUserId,
    });
  }

  for (const assignment of source.assignments) {
    entries.push({
      at: assignment.assignedAt,
      kind: 'dispatch',
      summary: `Điều phối ${assignment.assignmentType} (trạng thái ${assignment.status})`,
      actorUserId: null,
    });
  }

  return entries.sort((a, b) => a.at.localeCompare(b.at));
}

/** Các mốc dùng để tính KPI trong báo cáo pilot (FR-015). */
function buildKeyTimestamps(source: HandoverSourceData): Record<string, string | null> {
  const firstStatusAt = (status: string): string | null =>
    source.statusHistory.find((entry) => entry.toStatus === status)?.at ?? null;

  return {
    createdAt: source.caseRow.created_at.toISOString(),
    queuedAt: firstStatusAt('QUEUED'),
    acceptedAt: firstStatusAt('ACCEPTED'),
    videoConnectedAt: firstStatusAt('VIDEO_CONNECTED'),
    dispatchedAt: firstStatusAt('DISPATCHED'),
    enRouteAt: firstStatusAt('EN_ROUTE'),
    onSceneAt: firstStatusAt('ON_SCENE'),
    handoverPendingAt: firstStatusAt('HANDOVER_PENDING'),
  };
}
