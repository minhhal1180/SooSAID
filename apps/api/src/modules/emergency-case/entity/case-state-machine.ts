import { ApiErrorCode, CaseStatus, UserRole } from '../../../contracts/generated/api-contract';
import { DomainError } from '../../../common/errors/domain-error';

/**
 * Máy trạng thái ca cấp cứu – nguồn sự thật duy nhất cho việc "được chuyển sang
 * trạng thái nào, bởi ai".
 *
 * Nguồn: TDD §7.1 (bảng State transition rules) + `diagrams/case_state.mmd`.
 * FR-012: server kiểm tra transition theo role/current state; client KHÔNG BAO
 * GIỜ được tự đặt trạng thái tùy ý.
 *
 * Mọi thay đổi ở đây phải kèm cập nhật `docs/architecture/case-lifecycle.md`
 * và test trong `case-state-machine.spec.ts`.
 */

/** Chủ thể thực hiện transition. `SYSTEM` = do backend tự chuyển, không phải người dùng. */
export const SYSTEM_ACTOR = 'SYSTEM' as const;
export type TransitionActor = typeof SYSTEM_ACTOR | readonly UserRole[];

export interface TransitionRule {
  readonly from: CaseStatus;
  readonly to: CaseStatus;
  /** Role được phép. Rỗng nghĩa là chỉ hệ thống mới chuyển được. */
  readonly allowedRoles: readonly UserRole[];
  /** Bắt buộc có lý do – dùng cho các transition cần giải trình khi audit. */
  readonly requiresReason: boolean;
  /** Mô tả điều kiện nghiệp vụ, hiển thị khi transition bị từ chối. */
  readonly precondition: string;
}

const MEDICAL_COMMAND_ROLES: readonly UserRole[] = [UserRole.OPERATOR_115, UserRole.CLINICIAN];
const FIELD_ROLES: readonly UserRole[] = [UserRole.AMBULANCE_CREW, UserRole.LOCAL_RESPONDER];

/**
 * Ma trận transition. Đúng theo TDD §7.1 — không thêm cạnh nào ngoài tài liệu.
 *
 * Ghi chú requirement còn bỏ ngỏ: tài liệu chỉ cho phép `CREATED → CANCELLED`
 * ("cancel hợp lệ trước accept"), nhưng ca chuyển sang QUEUED gần như tức thì nên
 * trên thực tế người dân hầu như không kịp hủy. Xem mục "Open question" trong
 * docs/architecture/case-lifecycle.md — chưa tự thêm cạnh `QUEUED → CANCELLED`
 * vì Rule 1.1 cấm tự suy diễn nghiệp vụ.
 */
export const CASE_TRANSITIONS: readonly TransitionRule[] = [
  {
    from: CaseStatus.CREATED,
    to: CaseStatus.QUEUED,
    allowedRoles: [],
    requiresReason: false,
    precondition: 'Ca đã được lưu và xác định xong service area',
  },
  {
    from: CaseStatus.QUEUED,
    to: CaseStatus.ACCEPTED,
    allowedRoles: MEDICAL_COMMAND_ROLES,
    requiresReason: false,
    precondition: 'Chỉ một người nhận ca; người nhận phải thuộc scope service area',
  },
  {
    from: CaseStatus.ACCEPTED,
    to: CaseStatus.VIDEO_CONNECTED,
    allowedRoles: [],
    requiresReason: false,
    precondition: 'Hai đầu đã tham gia phòng video',
  },
  {
    from: CaseStatus.ACCEPTED,
    to: CaseStatus.DISPATCHED,
    allowedRoles: MEDICAL_COMMAND_ROLES,
    requiresReason: false,
    precondition: 'Có ít nhất một assignment hợp lệ hoặc ghi chú điều phối thủ công',
  },
  {
    from: CaseStatus.VIDEO_CONNECTED,
    to: CaseStatus.DISPATCHED,
    allowedRoles: MEDICAL_COMMAND_ROLES,
    requiresReason: false,
    precondition: 'Có ít nhất một assignment hợp lệ hoặc ghi chú điều phối thủ công',
  },
  {
    from: CaseStatus.DISPATCHED,
    to: CaseStatus.EN_ROUTE,
    allowedRoles: FIELD_ROLES,
    requiresReason: false,
    precondition: 'Assignment đã được chấp nhận và bắt đầu di chuyển',
  },
  {
    from: CaseStatus.EN_ROUTE,
    to: CaseStatus.ON_SCENE,
    allowedRoles: FIELD_ROLES,
    requiresReason: false,
    precondition: 'Lực lượng đã tới hiện trường',
  },
  {
    from: CaseStatus.ON_SCENE,
    to: CaseStatus.HANDOVER_PENDING,
    allowedRoles: [...MEDICAL_COMMAND_ROLES, UserRole.AMBULANCE_CREW],
    requiresReason: false,
    precondition: 'Bắt đầu chuẩn bị hồ sơ bàn giao',
  },
  {
    from: CaseStatus.HANDOVER_PENDING,
    to: CaseStatus.HANDED_OVER,
    allowedRoles: [UserRole.CLINICIAN, UserRole.AMBULANCE_CREW],
    requiresReason: false,
    precondition: 'Hồ sơ bàn giao đã được finalize/xác nhận theo policy',
  },
  {
    from: CaseStatus.HANDED_OVER,
    to: CaseStatus.CLOSED,
    allowedRoles: MEDICAL_COMMAND_ROLES,
    requiresReason: false,
    precondition: 'Ca đã hoàn tất về mặt vận hành',
  },
  {
    from: CaseStatus.CREATED,
    to: CaseStatus.CANCELLED,
    allowedRoles: [UserRole.CITIZEN],
    requiresReason: true,
    precondition: 'Chỉ hủy được trước khi có người nhận ca; bắt buộc nêu lý do',
  },
  {
    from: CaseStatus.QUEUED,
    to: CaseStatus.FALSE_ALARM,
    allowedRoles: [UserRole.OPERATOR_115],
    requiresReason: true,
    precondition: 'Tổng đài xác nhận báo nhầm; bắt buộc nêu lý do và ghi audit',
  },
  {
    from: CaseStatus.ACCEPTED,
    to: CaseStatus.FALSE_ALARM,
    allowedRoles: [UserRole.OPERATOR_115],
    requiresReason: true,
    precondition: 'Tổng đài xác nhận báo nhầm; bắt buộc nêu lý do và ghi audit',
  },
];

const TRANSITION_INDEX = new Map<string, TransitionRule>(
  CASE_TRANSITIONS.map((rule) => [transitionKey(rule.from, rule.to), rule]),
);

function transitionKey(from: CaseStatus, to: CaseStatus): string {
  return `${from}->${to}`;
}

export function findTransition(from: CaseStatus, to: CaseStatus): TransitionRule | null {
  return TRANSITION_INDEX.get(transitionKey(from, to)) ?? null;
}

/** Các trạng thái có thể chuyển tới từ `from` (dùng cho UI và thông báo lỗi). */
export function allowedTargetsFrom(from: CaseStatus): CaseStatus[] {
  return CASE_TRANSITIONS.filter((rule) => rule.from === from).map((rule) => rule.to);
}

export interface TransitionRequest {
  readonly from: CaseStatus;
  readonly to: CaseStatus;
  readonly actor: TransitionActor;
  readonly reason?: string | null;
}

/**
 * Kiểm tra một transition. Ném `DomainError` nếu không hợp lệ; trả về rule nếu hợp lệ.
 *
 * Thứ tự kiểm tra có chủ đích: cạnh tồn tại -> quyền -> lý do. Nhờ vậy người
 * dùng nhận được lỗi cụ thể nhất có thể mà không lộ thông tin ngoài quyền hạn.
 */
export function assertTransitionAllowed(request: TransitionRequest): TransitionRule {
  const { from, to, actor, reason } = request;

  if (from === to) {
    throw new DomainError(
      ApiErrorCode.CASE_INVALID_TRANSITION,
      `Ca đang ở trạng thái ${from}; không cần chuyển lại chính nó.`,
      [{ from, to }],
    );
  }

  const rule = findTransition(from, to);
  if (!rule) {
    throw new DomainError(
      ApiErrorCode.CASE_INVALID_TRANSITION,
      `Không thể chuyển ca từ ${from} sang ${to}.`,
      [{ from, to, allowedTargets: allowedTargetsFrom(from) }],
    );
  }

  if (actor === SYSTEM_ACTOR) {
    // Hệ thống được phép thực hiện mọi cạnh trong ma trận: nó là nơi cưỡng chế
    // ma trận, và một số cạnh (CREATED->QUEUED, ACCEPTED->VIDEO_CONNECTED) chỉ
    // hệ thống mới thực hiện được.
    assertReason(rule, reason);
    return rule;
  }

  if (rule.allowedRoles.length === 0) {
    throw new DomainError(
      ApiErrorCode.FORBIDDEN,
      `Chuyển ${from} sang ${to} là thao tác tự động của hệ thống, người dùng không thực hiện được.`,
      [{ from, to }],
    );
  }

  const hasRole = actor.some((role) => rule.allowedRoles.includes(role));
  if (!hasRole) {
    throw new DomainError(
      ApiErrorCode.FORBIDDEN,
      `Vai trò của bạn không được phép chuyển ca từ ${from} sang ${to}.`,
      [{ from, to, allowedRoles: rule.allowedRoles }],
    );
  }

  assertReason(rule, reason);
  return rule;
}

function assertReason(rule: TransitionRule, reason: string | null | undefined): void {
  if (rule.requiresReason && (!reason || reason.trim().length === 0)) {
    throw new DomainError(
      ApiErrorCode.VALIDATION_FAILED,
      `Chuyển ca sang ${rule.to} bắt buộc phải nêu lý do.`,
      [{ field: 'reason', precondition: rule.precondition }],
    );
  }
}
