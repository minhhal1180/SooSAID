import { UserRole } from '../../../contracts/generated/api-contract';
import type { AuthenticatedActor } from '../../../common/http/request-context';
import type { EmergencyCaseRow } from '../../../persistence/rows';

/**
 * Phân quyền trên MỘT ca cụ thể (ABAC) – tầng quyết định cuối cùng.
 *
 * `RolesGuard` chỉ trả lời "vai trò này có được gọi endpoint không". Câu hỏi
 * thật sự là "người này có được xem ĐÚNG ca này không", và nó phụ thuộc dữ liệu:
 * quyền sở hữu, service area, và assignment. Đó là lý do policy nằm ở tầng
 * service chứ không phải guard.
 *
 * Nguồn: TDD §4.1 (ma trận quyền tối thiểu), threat model
 * ("Unauthorized medical data access", "Location leakage"), TC-025.
 *
 * Deny-by-default: mọi nhánh không khớp đều trả về `false`.
 */

export interface CaseAccessContext {
  readonly actor: AuthenticatedActor;
  readonly caseRow: EmergencyCaseRow;
  /** `true` nếu actor đang được phân công cho ca (kíp xe/người hỗ trợ). */
  readonly isAssignedToCase: boolean;
}

function hasRole(actor: AuthenticatedActor, role: UserRole): boolean {
  return actor.roles.includes(role);
}

function isCaller(context: CaseAccessContext): boolean {
  return context.caseRow.caller_user_id === context.actor.userId;
}

/**
 * Actor thuộc scope service area của ca.
 * Ca chưa xác định được service area (GPS hỏng/ngoài vùng) chỉ ADMIN và
 * OPERATOR_115 tiếp cận được, để một ca "mồ côi" không bị ai cũng xem được.
 */
function isInServiceAreaScope(context: CaseAccessContext): boolean {
  const { actor, caseRow } = context;
  if (!caseRow.service_area_id) {
    return hasRole(actor, UserRole.OPERATOR_115) || hasRole(actor, UserRole.ADMIN);
  }
  // Actor không gắn service area nào = phạm vi toàn hệ thống (tổng đài trung tâm).
  if (actor.serviceAreaIds.length === 0) return true;
  return actor.serviceAreaIds.includes(caseRow.service_area_id);
}

/** Được xem thông tin vận hành của ca (trạng thái, mã ca, timeline). */
export function canViewCase(context: CaseAccessContext): boolean {
  const { actor } = context;

  if (hasRole(actor, UserRole.ADMIN) || hasRole(actor, UserRole.AUDITOR)) return true;
  if (isCaller(context)) return true;

  if (hasRole(actor, UserRole.OPERATOR_115) || hasRole(actor, UserRole.CLINICIAN)) {
    return isInServiceAreaScope(context);
  }

  // Kíp xe, người hỗ trợ, cơ sở tiếp nhận: chỉ khi được phân công cho ca này.
  if (
    hasRole(actor, UserRole.AMBULANCE_CREW) ||
    hasRole(actor, UserRole.LOCAL_RESPONDER) ||
    hasRole(actor, UserRole.FACILITY_USER)
  ) {
    return context.isAssignedToCase;
  }

  return false;
}

/**
 * Được xem TOẠ ĐỘ CHÍNH XÁC của ca.
 *
 * Tách riêng khỏi `canViewCase` vì threat model xếp rò rỉ vị trí là rủi ro độc
 * lập: AUDITOR cần xem được ca để kiểm tra quy trình nhưng không cần biết nhà
 * người bệnh ở đâu.
 */
export function canViewPreciseLocation(context: CaseAccessContext): boolean {
  const { actor } = context;

  if (isCaller(context)) return true;
  if (hasRole(actor, UserRole.OPERATOR_115) || hasRole(actor, UserRole.CLINICIAN)) {
    return isInServiceAreaScope(context);
  }
  if (hasRole(actor, UserRole.AMBULANCE_CREW) || hasRole(actor, UserRole.LOCAL_RESPONDER)) {
    return context.isAssignedToCase;
  }
  // ADMIN xem được để xử lý sự cố vận hành; AUDITOR thì không.
  return hasRole(actor, UserRole.ADMIN);
}

/**
 * Được xem hồ sơ sức khỏe khẩn cấp gắn với ca (TC-015).
 *
 * Hai điều kiện ĐỘC LẬP phải cùng đúng: vai trò phù hợp VÀ người dùng đã đồng ý
 * chia sẻ. Kiểm tra consent nằm ở service (cần đọc `consent_share_in_emergency`);
 * hàm này chỉ trả lời phần vai trò.
 */
export function canViewHealthProfileByRole(context: CaseAccessContext): boolean {
  const { actor } = context;

  if (isCaller(context)) return true;
  if (hasRole(actor, UserRole.CLINICIAN) || hasRole(actor, UserRole.OPERATOR_115)) {
    return isInServiceAreaScope(context);
  }
  if (hasRole(actor, UserRole.AMBULANCE_CREW)) return context.isAssignedToCase;

  // ADMIN KHÔNG mặc định xem được hồ sơ sức khỏe (TDD §4.1: "Không mặc định").
  return false;
}

/** Được tham gia phòng video của ca (TDD §4.1: citizen/operator/clinician). */
export function canJoinVideoSession(context: CaseAccessContext): boolean {
  const { actor } = context;

  if (isCaller(context)) return true;
  if (hasRole(actor, UserRole.OPERATOR_115) || hasRole(actor, UserRole.CLINICIAN)) {
    return isInServiceAreaScope(context);
  }
  return false;
}

/** Được thêm ghi chú chuyên môn/vận hành vào ca. */
export function canAddCaseNote(context: CaseAccessContext): boolean {
  const { actor } = context;

  if (hasRole(actor, UserRole.OPERATOR_115) || hasRole(actor, UserRole.CLINICIAN)) {
    return isInServiceAreaScope(context);
  }
  if (hasRole(actor, UserRole.AMBULANCE_CREW) || hasRole(actor, UserRole.LOCAL_RESPONDER)) {
    return context.isAssignedToCase;
  }
  return false;
}

/** Được điều phối kíp xe/người hỗ trợ cho ca. */
export function canDispatch(context: CaseAccessContext): boolean {
  const { actor } = context;
  if (!(hasRole(actor, UserRole.OPERATOR_115) || hasRole(actor, UserRole.CLINICIAN))) {
    return false;
  }
  return isInServiceAreaScope(context);
}
