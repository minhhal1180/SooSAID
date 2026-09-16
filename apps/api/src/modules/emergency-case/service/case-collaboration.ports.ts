/**
 * Port để module khác cung cấp dữ liệu cho `emergency-case` mà không vi phạm
 * Rule 2.2 (không import repository của nhau).
 *
 * Module `users` và `dispatch` đăng ký cài đặt của mình vào các token dưới đây;
 * `emergency-case` chỉ biết interface.
 */

/** Ảnh chụp hồ sơ sức khỏe khẩn cấp gắn vào ca lúc tạo (FR-011). */
export interface EmergencyProfileSnapshot {
  readonly profileVersion: number;
  readonly bloodType: string | null;
  readonly allergies: string[];
  readonly chronicConditions: string[];
  readonly medications: string[];
  readonly specialNote: string | null;
}

export interface EmergencyProfileSnapshotPort {
  /**
   * Trả snapshot CHỈ KHI người dùng đã bật `consent_share_in_emergency`
   * (TC-015). Trả `null` khi chưa đồng ý hoặc chưa khai báo hồ sơ — snapshot
   * được chốt tại thời điểm tạo ca để hồ sơ bàn giao sau này không đổi theo
   * việc người dùng chỉnh sửa hồ sơ (FR-011).
   */
  snapshotForCase(userId: string): Promise<EmergencyProfileSnapshot | null>;
}

export const EMERGENCY_PROFILE_SNAPSHOT_PORT = Symbol('EMERGENCY_PROFILE_SNAPSHOT_PORT');

/**
 * Kiểm tra một người có đang được phân công cho ca hay không — điều kiện then
 * chốt của `CaseAccessPolicy` đối với kíp xe/người hỗ trợ/cơ sở tiếp nhận.
 */
export interface CaseAssignmentCheckerPort {
  isUserAssignedToCase(caseId: string, userId: string): Promise<boolean>;
}

export const CASE_ASSIGNMENT_CHECKER_PORT = Symbol('CASE_ASSIGNMENT_CHECKER_PORT');
