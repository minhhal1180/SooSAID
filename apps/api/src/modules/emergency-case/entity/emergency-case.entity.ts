import {
  CaseStatus,
  TriggerSource,
  casePhaseOf,
  type EmergencyCaseView,
  type LocationSample,
} from '../../../contracts/generated/api-contract';
import type { EmergencyCaseRow } from '../../../persistence/rows';

/**
 * Chuyển row DB thành view model trả ra API.
 *
 * Chỗ này cũng là **tầng field-level authorization** mà TDD §10.1 yêu cầu:
 * `emergency_profile_snapshot` (dữ liệu sức khỏe) KHÔNG BAO GIỜ đi qua hàm này.
 * Muốn đọc hồ sơ sức khỏe của một ca phải gọi endpoint riêng, có audit riêng và
 * kiểm tra consent riêng (Rule 5.1, TC-015).
 */

/** Tiền tố kênh realtime theo ca (TDD §10.2: `case:<uuid>`). */
export const CASE_REALTIME_CHANNEL_PREFIX = 'case';

export function caseRealtimeChannel(caseId: string): string {
  return `${CASE_REALTIME_CHANNEL_PREFIX}:${caseId}`;
}

export function toEmergencyCaseView(row: EmergencyCaseRow): EmergencyCaseView {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    phase: casePhaseOf(row.status),
    triggerSource: row.trigger_source as TriggerSource,
    numberOfPatients: row.number_of_patients,
    serviceAreaId: row.service_area_id,
    callerUserId: row.caller_user_id,
    activeOperatorId: row.active_operator_id,
    latestLocation: toLatestLocationSample(row),
    addressText: row.address_text,
    accessNote: row.access_note,
    mediaConsent: row.media_consent,
    createdAt: row.created_at.toISOString(),
    acceptedAt: row.accepted_at?.toISOString() ?? null,
    closedAt: row.closed_at?.toISOString() ?? null,
    updatedAt: row.updated_at.toISOString(),
    realtimeChannel: caseRealtimeChannel(row.id),
  };
}

function toLatestLocationSample(row: EmergencyCaseRow): LocationSample | null {
  if (!row.latest_location) return null;
  return {
    lat: row.latest_location.lat,
    lng: row.latest_location.lng,
    accuracyMeters: row.latest_accuracy_meters,
    // `latest_location` trên bảng case là ảnh chụp mới nhất; thời điểm đo chi
    // tiết nằm ở bảng `case_locations` (module location).
    capturedAt: row.updated_at.toISOString(),
    addressText: row.address_text,
    accessNote: row.access_note,
  };
}

/** Ca đang hoạt động: còn cần theo dõi/điều phối. */
export function isActiveCase(status: CaseStatus): boolean {
  return (
    status !== CaseStatus.CLOSED &&
    status !== CaseStatus.CANCELLED &&
    status !== CaseStatus.FALSE_ALARM
  );
}
