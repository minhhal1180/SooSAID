/**
 * Danh mục hành động được audit (FR-014, Rule 5.1).
 *
 * Rule 9.2 – No Hard Code: không rải chuỗi `'case.view'` khắp service.
 *
 * Nguyên tắc chọn cái gì phải audit: mọi thao tác **xem/tải/chia sẻ/sửa** dữ
 * liệu nhạy cảm (vị trí, video, hồ sơ sức khỏe), và mọi thao tác **đổi trạng
 * thái** ca cấp cứu.
 */
export const AuditAction = {
  // Xác thực
  AUTH_OTP_REQUESTED: 'auth.otp_requested',
  AUTH_LOGIN_SUCCEEDED: 'auth.login_succeeded',
  AUTH_LOGIN_FAILED: 'auth.login_failed',
  AUTH_TOKEN_REFRESHED: 'auth.token_refreshed',

  // Ca cấp cứu
  CASE_CREATED: 'case.created',
  CASE_VIEWED: 'case.viewed',
  CASE_ACCEPTED: 'case.accepted',
  CASE_STATUS_CHANGED: 'case.status_changed',
  CASE_LOCATION_APPENDED: 'case.location_appended',
  CASE_NOTE_ADDED: 'case.note_added',
  CASE_QUEUE_VIEWED: 'case.queue_viewed',

  // Dữ liệu nhạy cảm
  HEALTH_PROFILE_VIEWED: 'health_profile.viewed',
  HEALTH_PROFILE_UPDATED: 'health_profile.updated',
  MEDIA_ACCESS_GRANTED: 'media.access_granted',

  // Video
  VIDEO_TOKEN_ISSUED: 'video.token_issued',
  VIDEO_SESSION_STARTED: 'video.session_started',

  // Triage & hướng dẫn
  TRIAGE_SUBMITTED: 'triage.submitted',
  GUIDANCE_DELIVERED: 'guidance.delivered',

  // Điều phối & bàn giao
  DISPATCH_CREATED: 'dispatch.created',
  DISPATCH_STATUS_CHANGED: 'dispatch.status_changed',
  HANDOVER_GENERATED: 'handover.generated',
  HANDOVER_VIEWED: 'handover.viewed',

  // Quản trị
  AUDIT_SEARCHED: 'audit.searched',
  REPORT_VIEWED: 'report.viewed',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const AuditResult = { SUCCESS: 'SUCCESS', FAILURE: 'FAILURE', DENIED: 'DENIED' } as const;
export type AuditResult = (typeof AuditResult)[keyof typeof AuditResult];

export const AuditResourceType = {
  USER: 'user',
  EMERGENCY_CASE: 'emergency_case',
  EMERGENCY_PROFILE: 'emergency_profile',
  VIDEO_SESSION: 'video_session',
  MEDIA_ASSET: 'media_asset',
  DISPATCH_ASSIGNMENT: 'dispatch_assignment',
  HANDOVER: 'handover',
  AUDIT_LOG: 'audit_log',
  REPORT: 'report',
} as const;
export type AuditResourceType = (typeof AuditResourceType)[keyof typeof AuditResourceType];

export interface AuditEntry {
  readonly action: AuditAction;
  readonly resourceType: AuditResourceType;
  readonly resourceId?: string | null;
  readonly caseId?: string | null;
  readonly result?: AuditResult;
  /**
   * Metadata bổ sung. KHÔNG chứa dữ liệu nhạy cảm — audit log được đọc bởi
   * auditor và có thể export; nó ghi *ai làm gì*, không ghi *nội dung*.
   */
  readonly metadata?: Record<string, unknown>;
}
