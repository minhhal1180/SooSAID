/**
 * Kiểu dòng dữ liệu (row) khớp 1-1 với bảng trong `db/migrations/`.
 *
 * Dùng chung cho cả hai driver: driver `postgres` trả đúng các shape này từ
 * `pg`, driver `memory` lưu đúng các shape này trong Map. Nhờ vậy code map
 * row -> entity chỉ viết một lần, và một bug mapping không thể chỉ xuất hiện ở
 * một driver.
 *
 * Quy ước: tên field giữ nguyên snake_case như trong SQL. Việc đổi sang camelCase
 * xảy ra ở tầng mapper của từng module, không ở đây.
 */

import type {
  AssignmentStatus,
  AssignmentType,
  CaseStatus,
  UserRole,
} from '../contracts/generated/api-contract';

/** Cột bắt buộc theo Rule 4.1 (migration 0002). */
export interface AuditColumns {
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
}

/** Điểm toạ độ. PostGIS lưu `geography(Point,4326)`; driver memory lưu cặp số. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface UserRow extends AuditColumns {
  id: string;
  phone: string | null;
  email: string | null;
  full_name: string | null;
  status: string;
  locale: string;
}

export interface UserRoleRow extends AuditColumns {
  id: string;
  user_id: string;
  role: UserRole;
  organization_id: string | null;
}

export interface DeviceRow extends AuditColumns {
  id: string;
  user_id: string | null;
  platform: 'ios' | 'android' | 'web';
  push_token: string | null;
  app_version: string | null;
  last_seen_at: Date | null;
}

export interface EmergencyProfileRow extends AuditColumns {
  id: string;
  user_id: string;
  blood_type: string | null;
  allergies: string[];
  chronic_conditions: string[];
  medications: string[];
  preferred_facility: string | null;
  special_note: string | null;
  consent_share_in_emergency: boolean;
  version: number;
}

export interface EmergencyContactRow extends AuditColumns {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  relation: string | null;
  priority: number;
  notify_by_push: boolean;
  notify_by_sms: boolean;
}

export interface ServiceAreaRow extends AuditColumns {
  id: string;
  code: string;
  name: string;
  /** Hộp bao (bounding box) của polygon – đủ cho driver memory khớp service area. */
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number } | null;
  active: boolean;
  routing_priority: number;
}

export interface MedicalFacilityRow extends AuditColumns {
  id: string;
  code: string | null;
  name: string;
  facility_type: string;
  phone: string | null;
  address: string | null;
  location: GeoPoint;
  capabilities: Record<string, unknown>;
  service_area_id: string | null;
  active: boolean;
}

export interface LocalResourceRow extends AuditColumns {
  id: string;
  resource_type: string;
  name: string;
  location: GeoPoint;
  address: string | null;
  access_instruction: string | null;
  organization_id: string | null;
  metadata: Record<string, unknown>;
  active: boolean;
}

export interface AmbulanceUnitRow extends AuditColumns {
  id: string;
  code: string;
  display_name: string;
  status: string;
  current_location: GeoPoint | null;
  service_area_id: string | null;
  last_location_at: Date | null;
  capabilities: Record<string, unknown>;
}

/** Thành viên kíp xe (migration 0003) – nền tảng cho quyền truy cập của kíp. */
export interface AmbulanceUnitMemberRow extends AuditColumns {
  id: string;
  ambulance_unit_id: string;
  user_id: string;
  crew_role: string | null;
  active_from: Date;
  /** NULL = còn hiệu lực. */
  active_to: Date | null;
}

export interface ResponderRow extends AuditColumns {
  id: string;
  user_id: string;
  organization_id: string | null;
  certification_status: string;
  available: boolean;
  current_location: GeoPoint | null;
  last_location_at: Date | null;
  skills: string[];
}

export interface EmergencyCaseRow extends AuditColumns {
  id: string;
  code: string;
  trigger_source: string;
  caller_user_id: string | null;
  device_id: string | null;
  service_area_id: string | null;
  active_operator_id: string | null;
  status: CaseStatus;
  number_of_patients: number;
  first_location: GeoPoint | null;
  latest_location: GeoPoint | null;
  latest_accuracy_meters: number | null;
  address_text: string | null;
  access_note: string | null;
  media_consent: boolean;
  emergency_profile_snapshot: Record<string, unknown> | null;
  accepted_at: Date | null;
  closed_at: Date | null;
}

export interface CaseLocationRow extends AuditColumns {
  id: string;
  case_id: string;
  location: GeoPoint;
  accuracy_meters: number | null;
  altitude_meters: number | null;
  address_text: string | null;
  access_note: string | null;
  source: string;
  captured_at: Date;
  received_at: Date;
}

export interface TriageSubmissionRow extends AuditColumns {
  id: string;
  case_id: string;
  questionnaire_version: string;
  answers: Array<{ questionCode: string; value: string }>;
  submitted_by: string | null;
}

export interface CaseStatusHistoryRow extends AuditColumns {
  id: string;
  case_id: string;
  from_status: CaseStatus | null;
  to_status: CaseStatus;
  reason: string | null;
  changed_by: string | null;
  changed_at: Date;
  metadata: Record<string, unknown>;
}

export interface VideoSessionRow extends AuditColumns {
  id: string;
  case_id: string;
  provider: string;
  provider_room_id: string;
  status: string;
  recording_enabled: boolean;
  started_at: Date | null;
  ended_at: Date | null;
  metadata: Record<string, unknown>;
}

export interface MediaAssetRow extends AuditColumns {
  id: string;
  case_id: string | null;
  video_session_id: string | null;
  media_type: string;
  storage_key: string;
  mime_type: string | null;
  size_bytes: number | null;
  checksum_sha256: string | null;
  encryption_key_ref: string | null;
  retention_class: string;
  deleted_at: Date | null;
}

export interface DispatchAssignmentRow extends AuditColumns {
  id: string;
  case_id: string;
  assignment_type: AssignmentType;
  ambulance_unit_id: string | null;
  responder_id: string | null;
  status: AssignmentStatus;
  priority: string;
  assigned_by: string | null;
  assigned_at: Date;
  accepted_at: Date | null;
  arrived_at: Date | null;
  completed_at: Date | null;
}

export interface GuidanceCatalogRow extends AuditColumns {
  id: string;
  code: string;
  version: number;
  title: string;
  content: Record<string, unknown>;
  approval_status: string;
  approved_by: string | null;
  approved_at: Date | null;
  effective_from: Date | null;
  retired_at: Date | null;
}

export interface GuidanceEventRow extends AuditColumns {
  id: string;
  case_id: string;
  guidance_id: string | null;
  action: string;
  actor_user_id: string | null;
  metadata: Record<string, unknown>;
}

export interface CaseNoteRow extends AuditColumns {
  id: string;
  case_id: string;
  author_user_id: string | null;
  note_type: string;
  text: string;
}

export interface HandoverRow extends AuditColumns {
  id: string;
  case_id: string;
  version: number;
  receiving_facility_id: string | null;
  ambulance_unit_id: string | null;
  payload: Record<string, unknown>;
  status: string;
  finalized_by: string | null;
  finalized_at: Date | null;
}

export interface NotificationDeliveryRow extends AuditColumns {
  id: string;
  case_id: string | null;
  channel: string;
  recipient: string;
  template_code: string;
  status: string;
  provider_message_id: string | null;
  attempt_count: number;
  last_error: string | null;
  sent_at: Date | null;
}

export interface ConsentRecordRow extends AuditColumns {
  id: string;
  user_id: string | null;
  case_id: string | null;
  consent_type: string;
  policy_version: string;
  granted: boolean;
  context: Record<string, unknown>;
  recorded_at: Date;
}

export interface AuditLogRow extends AuditColumns {
  id: string;
  actor_user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  case_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  result: string;
  metadata: Record<string, unknown>;
}

export interface IdempotencyKeyRow extends AuditColumns {
  id: string;
  key: string;
  user_id: string | null;
  endpoint: string;
  request_hash: string;
  response_code: number | null;
  response_body: Record<string, unknown> | null;
  expires_at: Date;
}

export interface OutboxEventRow extends AuditColumns {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  published_at: Date | null;
  retry_count: number;
}
