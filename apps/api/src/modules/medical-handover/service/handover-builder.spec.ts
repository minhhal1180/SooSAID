import { CaseStatus } from '../../../contracts/generated/api-contract';
import type { EmergencyCaseRow } from '../../../persistence/rows';
import {
  HANDOVER_PAYLOAD_SCHEMA_VERSION,
  buildHandoverPayload,
  type HandoverSourceData,
} from './handover-builder';

/**
 * Hồ sơ bàn giao là tài liệu giao cho nhân viên y tế. Test kiểm tra hai điều:
 * nội dung ĐẦY ĐỦ theo FR-013, và nội dung KHÔNG chứa kết luận y khoa (Rule 1.2).
 *
 * Mapping: TC-018.
 */
describe('buildHandoverPayload', () => {
  const generatedAt = new Date('2026-09-13T09:00:00.000Z');

  const caseRow: EmergencyCaseRow = {
    id: 'case-1',
    code: 'SOS-20260913-000001',
    trigger_source: 'sos_button',
    caller_user_id: 'caller-1',
    device_id: 'device-1',
    service_area_id: 'area-a',
    active_operator_id: 'operator-1',
    status: CaseStatus.HANDOVER_PENDING,
    number_of_patients: 1,
    first_location: { lat: 21.02, lng: 105.84 },
    latest_location: { lat: 21.021, lng: 105.841 },
    latest_accuracy_meters: 12,
    address_text: 'Nha A, tang 2',
    access_note: 'Vao cong chinh',
    media_consent: false,
    emergency_profile_snapshot: null,
    accepted_at: new Date('2026-09-13T08:00:30.000Z'),
    closed_at: null,
    created_at: new Date('2026-09-13T08:00:00.000Z'),
    updated_at: generatedAt,
    created_by: 'caller-1',
    updated_by: 'operator-1',
  };

  const source: HandoverSourceData = {
    caseRow,
    statusHistory: [
      { at: '2026-09-13T08:00:00.000Z', fromStatus: null, toStatus: 'CREATED', reason: null, changedBy: 'caller-1' },
      { at: '2026-09-13T08:00:01.000Z', fromStatus: 'CREATED', toStatus: 'QUEUED', reason: null, changedBy: null },
      { at: '2026-09-13T08:00:30.000Z', fromStatus: 'QUEUED', toStatus: 'ACCEPTED', reason: null, changedBy: 'operator-1' },
      { at: '2026-09-13T08:02:00.000Z', fromStatus: 'ACCEPTED', toStatus: 'DISPATCHED', reason: null, changedBy: 'operator-1' },
      { at: '2026-09-13T08:09:00.000Z', fromStatus: 'EN_ROUTE', toStatus: 'ON_SCENE', reason: null, changedBy: 'crew-1' },
    ],
    notes: [
      { at: '2026-09-13T08:03:00.000Z', noteType: 'clinical_observation', text: 'Nguoi benh con phan ung', authorUserId: 'clinician-1' },
    ],
    triageSubmissions: [
      {
        submittedAt: '2026-09-13T08:00:45.000Z',
        questionnaireVersion: 'pilot-1',
        answers: [{ questionCode: 'responsive', value: 'yes' }],
      },
    ],
    guidanceLog: [
      { at: '2026-09-13T08:01:30.000Z', action: 'displayed', guidanceCode: 'GUIDE-CALL-115', guidanceVersion: 1, title: 'Goi ho tro' },
    ],
    assignments: [
      { assignmentType: 'AMBULANCE_UNIT', status: 'ARRIVED', assignedAt: '2026-09-13T08:02:00.000Z', acceptedAt: '2026-09-13T08:02:30.000Z', arrivedAt: '2026-09-13T08:09:00.000Z' },
    ],
    locationTrail: [
      { capturedAt: '2026-09-13T08:00:00.000Z', lat: 21.02, lng: 105.84, accuracyMeters: 25 },
      { capturedAt: '2026-09-13T08:00:20.000Z', lat: 21.021, lng: 105.841, accuracyMeters: 12 },
    ],
    mediaReferences: [],
    emergencyProfileSnapshot: null,
  };

  it('gồm đủ các phần bắt buộc theo FR-013', () => {
    const payload = buildHandoverPayload(source, generatedAt);

    expect(payload.schemaVersion).toBe(HANDOVER_PAYLOAD_SCHEMA_VERSION);
    expect(payload.case.code).toBe('SOS-20260913-000001');
    expect(payload.triage).toHaveLength(1);
    expect(payload.guidancePerformed).toHaveLength(1);
    expect(payload.assignments).toHaveLength(1);
    expect(payload.locationTrail).toHaveLength(2);
    expect(payload.notes).toHaveLength(1);
  });

  it('gộp mọi loại sự kiện vào một dòng thời gian xếp theo thứ tự', () => {
    const payload = buildHandoverPayload(source, generatedAt);
    const times = payload.timeline.map((entry) => entry.at);

    expect(times).toEqual([...times].sort());
    // 5 mốc trạng thái + 1 triage + 1 guidance + 1 note + 1 dispatch
    expect(payload.timeline).toHaveLength(9);
    expect(new Set(payload.timeline.map((e) => e.kind))).toEqual(
      new Set(['status', 'triage', 'guidance', 'note', 'dispatch']),
    );
  });

  it('trích đúng các mốc thời gian dùng cho KPI (FR-015)', () => {
    const payload = buildHandoverPayload(source, generatedAt);

    expect(payload.keyTimestamps.queuedAt).toBe('2026-09-13T08:00:01.000Z');
    expect(payload.keyTimestamps.acceptedAt).toBe('2026-09-13T08:00:30.000Z');
    expect(payload.keyTimestamps.onSceneAt).toBe('2026-09-13T08:09:00.000Z');
    // Ca này chưa từng vào VIDEO_CONNECTED -> null chứ không phải đoán.
    expect(payload.keyTimestamps.videoConnectedAt).toBeNull();
  });

  it('Rule 1.2: không chứa chẩn đoán, phân loại mức độ hay khuyến nghị xử trí', () => {
    const payload = buildHandoverPayload(source, generatedAt);
    const serialized = JSON.stringify(payload).toLowerCase();

    for (const forbidden of ['diagnosis', 'chan doan', 'severity', 'triagelevel', 'recommend']) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(payload.disclaimer).toContain('KHÔNG chứa chẩn đoán');
  });

  it('giữ nguyên văn ghi chú chuyên môn, không tóm tắt lại', () => {
    const payload = buildHandoverPayload(source, generatedAt);
    const noteEntry = payload.timeline.find((entry) => entry.kind === 'note');

    expect(noteEntry?.summary).toContain('Nguoi benh con phan ung');
  });

  it('không nhúng nội dung media, chỉ tham chiếu (Rule 4.2)', () => {
    const payload = buildHandoverPayload(
      {
        ...source,
        mediaReferences: [
          { mediaType: 'video', storageKey: 'cases/case-1/clip.mp4', checksumSha256: 'abc' },
        ],
      },
      generatedAt,
    );

    expect(payload.mediaReferences[0].storageKey).toBe('cases/case-1/clip.mp4');
    expect(JSON.stringify(payload)).not.toContain('base64');
  });

  it('hồ sơ sức khỏe chỉ xuất hiện khi được truyền vào (TC-015)', () => {
    const withoutProfile = buildHandoverPayload(source, generatedAt);
    expect(withoutProfile.emergencyProfileSnapshot).toBeNull();

    const withProfile = buildHandoverPayload(
      { ...source, emergencyProfileSnapshot: { bloodType: 'O', profileVersion: 2 } },
      generatedAt,
    );
    expect(withProfile.emergencyProfileSnapshot).toEqual({ bloodType: 'O', profileVersion: 2 });
  });
});
