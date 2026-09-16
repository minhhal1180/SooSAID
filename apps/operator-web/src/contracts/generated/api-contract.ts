/* eslint-disable */
// =============================================================================
// FILE ĐƯỢC SINH TỰ ĐỘNG – KHÔNG SỬA TRỰC TIẾP.
// Nguồn: packages/api-contract/src/index.ts
// Sinh lại bằng: npm run sync:contract
// =============================================================================

/**
 * S.O.S Aid – API contract dùng chung giữa backend, operator web và mobile.
 *
 * ĐÂY LÀ NGUỒN DUY NHẤT (single source of truth) cho enum/kiểu dữ liệu của
 * contract. File này được `scripts/sync-contract.mjs` sao chép sang:
 *   - apps/api/src/contracts/generated/api-contract.ts
 *   - apps/operator-web/src/contracts/generated/api-contract.ts
 * Không sửa bản copy; sửa ở đây rồi chạy `npm run sync:contract`.
 *
 * Nguồn nghiệp vụ: docs/api/openapi.yaml (Rule 6.1 – API First).
 */

// ---------------------------------------------------------------------------
// Envelope (Rule 6.2 / ADR-003)
// ---------------------------------------------------------------------------

export interface ApiSuccess<T> {
  success: true;
  data: T;
  requestId: string;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown[];
  };
  requestId: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorBody;

/** Bảng mã lỗi thống nhất – xem docs/decision-log/ADR-003-response-envelope.md */
export const ApiErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  CASE_INVALID_TRANSITION: 'CASE_INVALID_TRANSITION',
  CASE_ALREADY_ACCEPTED: 'CASE_ALREADY_ACCEPTED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  GUIDANCE_NOT_APPROVED: 'GUIDANCE_NOT_APPROVED',
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/** Gỡ envelope; ném lỗi nếu response báo thất bại. */
export function unwrap<T>(response: ApiResponse<T>): T {
  if (!response.success) {
    throw new Error(`[${response.error.code}] ${response.error.message}`);
  }
  return response.data;
}

// ---------------------------------------------------------------------------
// RBAC (Rule 5.2 / ADR-002)
// ---------------------------------------------------------------------------

/** Role code lưu trong DB và trong JWT claim `roles`. */
export const UserRole = {
  CITIZEN: 'CITIZEN',
  OPERATOR_115: 'OPERATOR_115',
  CLINICIAN: 'CLINICIAN',
  AMBULANCE_CREW: 'AMBULANCE_CREW',
  FACILITY_USER: 'FACILITY_USER',
  LOCAL_RESPONDER: 'LOCAL_RESPONDER',
  ADMIN: 'ADMIN',
  AUDITOR: 'AUDITOR',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/** Nhóm vai trò khái niệm theo Rule 5.2. Chỉ để đọc/nhóm, không lưu DB. */
export const RoleGroup = {
  USER: 'USER',
  SUPPORTER: 'SUPPORTER',
  MEDICAL_STAFF: 'MEDICAL_STAFF',
  ADMIN: 'ADMIN',
} as const;
export type RoleGroup = (typeof RoleGroup)[keyof typeof RoleGroup];

export const ROLE_GROUP_OF: Readonly<Record<UserRole, RoleGroup>> = {
  CITIZEN: RoleGroup.USER,
  LOCAL_RESPONDER: RoleGroup.SUPPORTER,
  OPERATOR_115: RoleGroup.MEDICAL_STAFF,
  CLINICIAN: RoleGroup.MEDICAL_STAFF,
  AMBULANCE_CREW: RoleGroup.MEDICAL_STAFF,
  FACILITY_USER: RoleGroup.MEDICAL_STAFF,
  ADMIN: RoleGroup.ADMIN,
  AUDITOR: RoleGroup.ADMIN,
};

// ---------------------------------------------------------------------------
// Case lifecycle (Rule 7.1 / ADR-001)
// ---------------------------------------------------------------------------

/** Trạng thái kỹ thuật canonical – khớp enum `case_status` trong PostgreSQL. */
export const CaseStatus = {
  CREATED: 'CREATED',
  QUEUED: 'QUEUED',
  ACCEPTED: 'ACCEPTED',
  VIDEO_CONNECTED: 'VIDEO_CONNECTED',
  DISPATCHED: 'DISPATCHED',
  EN_ROUTE: 'EN_ROUTE',
  ON_SCENE: 'ON_SCENE',
  HANDOVER_PENDING: 'HANDOVER_PENDING',
  HANDED_OVER: 'HANDED_OVER',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
  FALSE_ALARM: 'FALSE_ALARM',
} as const;
export type CaseStatus = (typeof CaseStatus)[keyof typeof CaseStatus];

/** 6 pha nghiệp vụ hiển thị cho người dân (Rule 7.1). Dẫn xuất, không lưu DB. */
export const CasePhase = {
  CREATED: 'CREATED',
  ALERTED: 'ALERTED',
  CONNECTING: 'CONNECTING',
  VIDEO_SUPPORT: 'VIDEO_SUPPORT',
  HANDOVER: 'HANDOVER',
  COMPLETED: 'COMPLETED',
} as const;
export type CasePhase = (typeof CasePhase)[keyof typeof CasePhase];

const CASE_PHASE_MAP: Readonly<Record<CaseStatus, CasePhase>> = {
  CREATED: CasePhase.CREATED,
  QUEUED: CasePhase.ALERTED,
  ACCEPTED: CasePhase.CONNECTING,
  VIDEO_CONNECTED: CasePhase.VIDEO_SUPPORT,
  DISPATCHED: CasePhase.VIDEO_SUPPORT,
  EN_ROUTE: CasePhase.VIDEO_SUPPORT,
  ON_SCENE: CasePhase.VIDEO_SUPPORT,
  HANDOVER_PENDING: CasePhase.HANDOVER,
  HANDED_OVER: CasePhase.HANDOVER,
  CLOSED: CasePhase.COMPLETED,
  CANCELLED: CasePhase.COMPLETED,
  FALSE_ALARM: CasePhase.COMPLETED,
};

/**
 * Ánh xạ trạng thái kỹ thuật -> pha hiển thị.
 * Một chiều: KHÔNG được suy ngược. Mọi logic nghiệp vụ branch theo CaseStatus.
 */
export function casePhaseOf(status: CaseStatus): CasePhase {
  return CASE_PHASE_MAP[status];
}

/** Trạng thái kết thúc: ca không còn nhận thao tác vận hành nào nữa. */
export const TERMINAL_CASE_STATUSES: readonly CaseStatus[] = [
  CaseStatus.CLOSED,
  CaseStatus.CANCELLED,
  CaseStatus.FALSE_ALARM,
];

export function isTerminalCaseStatus(status: CaseStatus): boolean {
  return TERMINAL_CASE_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export const AssignmentType = {
  AMBULANCE_UNIT: 'AMBULANCE_UNIT',
  LOCAL_RESPONDER: 'LOCAL_RESPONDER',
} as const;
export type AssignmentType = (typeof AssignmentType)[keyof typeof AssignmentType];

export const AssignmentStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  EN_ROUTE: 'EN_ROUTE',
  ARRIVED: 'ARRIVED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type AssignmentStatus = (typeof AssignmentStatus)[keyof typeof AssignmentStatus];

export const DispatchPriority = { NORMAL: 'normal', URGENT: 'urgent' } as const;
export type DispatchPriority = (typeof DispatchPriority)[keyof typeof DispatchPriority];

// ---------------------------------------------------------------------------
// Case metadata
// ---------------------------------------------------------------------------

export const TriggerSource = {
  SOS_BUTTON: 'sos_button',
  DRILL: 'drill',
  OPERATOR_CREATED: 'operator_created',
} as const;
export type TriggerSource = (typeof TriggerSource)[keyof typeof TriggerSource];

export const VideoParticipantRole = {
  CALLER: 'caller',
  OPERATOR: 'operator',
  CLINICIAN: 'clinician',
} as const;
export type VideoParticipantRole =
  (typeof VideoParticipantRole)[keyof typeof VideoParticipantRole];

export const NoteType = {
  GENERAL: 'general',
  CLINICAL_OBSERVATION: 'clinical_observation',
  ACCESS_INSTRUCTION: 'access_instruction',
} as const;
export type NoteType = (typeof NoteType)[keyof typeof NoteType];

export const GuidanceApprovalStatus = {
  DRAFT: 'DRAFT',
  APPROVED: 'APPROVED',
  EFFECTIVE: 'EFFECTIVE',
  RETIRED: 'RETIRED',
} as const;
export type GuidanceApprovalStatus =
  (typeof GuidanceApprovalStatus)[keyof typeof GuidanceApprovalStatus];

// ---------------------------------------------------------------------------
// Domain events (ADR-005)
// ---------------------------------------------------------------------------

export const DomainEventType = {
  CASE_CREATED: 'case.created',
  CASE_ACCEPTED: 'case.accepted',
  CASE_STATUS_CHANGED: 'case.status_changed',
  CASE_LOCATION_UPDATED: 'case.location_updated',
  TRIAGE_SUBMITTED: 'triage.submitted',
  VIDEO_SESSION_STARTED: 'video.session_started',
  GUIDANCE_DELIVERED: 'guidance.delivered',
  DISPATCH_CREATED: 'dispatch.created',
  DISPATCH_STATUS_CHANGED: 'dispatch.status_changed',
  HANDOVER_FINALIZED: 'handover.finalized',
  NOTIFICATION_REQUESTED: 'notification.requested',
} as const;
export type DomainEventType = (typeof DomainEventType)[keyof typeof DomainEventType];

/** Envelope realtime gửi qua WebSocket (TDD §10.3). */
export interface RealtimeEventEnvelope<P = Record<string, unknown>> {
  eventId: string;
  eventType: DomainEventType;
  caseId: string | null;
  occurredAt: string;
  sequence: number;
  payload: P;
}

// ---------------------------------------------------------------------------
// Payload DTO dùng chung
// ---------------------------------------------------------------------------

export interface LocationSample {
  lat: number;
  lng: number;
  accuracyMeters?: number | null;
  altitudeMeters?: number | null;
  capturedAt: string;
  addressText?: string | null;
  accessNote?: string | null;
}

export interface EmergencyCaseView {
  id: string;
  code: string;
  status: CaseStatus;
  /** Pha hiển thị cho người dân, dẫn xuất từ `status` (ADR-001). */
  phase: CasePhase;
  triggerSource: TriggerSource;
  numberOfPatients: number;
  serviceAreaId: string | null;
  callerUserId: string | null;
  activeOperatorId: string | null;
  latestLocation: LocationSample | null;
  addressText: string | null;
  accessNote: string | null;
  mediaConsent: boolean;
  createdAt: string;
  acceptedAt: string | null;
  closedAt: string | null;
  updatedAt: string;
  /** Kênh realtime client cần subscribe (TDD §10.2). */
  realtimeChannel: string;
}

export interface CreateEmergencyCaseRequestBody {
  deviceId: string;
  location: LocationSample;
  triggerSource?: TriggerSource;
  numberOfPatients?: number;
  accessNote?: string;
  mediaConsent?: boolean;
}

export interface CaseTimelineEntry {
  at: string;
  kind: 'status' | 'location' | 'triage' | 'guidance' | 'note' | 'dispatch' | 'video';
  summary: string;
  actorUserId: string | null;
  metadata: Record<string, unknown>;
}

export interface NearbyResult<T> {
  items: T[];
  /** `exact` khi truy vấn bằng PostGIS, `approximate` khi dùng driver memory (ADR-004). */
  spatialAccuracy: 'exact' | 'approximate';
}
