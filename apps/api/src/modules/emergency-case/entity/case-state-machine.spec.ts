import { ApiErrorCode, CaseStatus, UserRole } from '../../../contracts/generated/api-contract';
import { DomainError } from '../../../common/errors/domain-error';
import {
  CASE_TRANSITIONS,
  SYSTEM_ACTOR,
  allowedTargetsFrom,
  assertTransitionAllowed,
  findTransition,
} from './case-state-machine';

/**
 * Máy trạng thái là nơi cưỡng chế FR-012. Một lỗ hổng ở đây cho phép client tự
 * đặt trạng thái ca cấp cứu, nên test phủ cả nhánh CHO PHÉP và nhánh TỪ CHỐI.
 *
 * Mapping test case: TC-012 (trạng thái không hợp lệ), TC-029 (báo nhầm cần lý do).
 */
describe('case-state-machine', () => {
  const expectDomainError = (fn: () => unknown, code: ApiErrorCode): void => {
    try {
      fn();
      throw new Error('Mong đợi DomainError nhưng không có lỗi nào được ném ra');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe(code);
    }
  };

  describe('ma trận transition', () => {
    it('chỉ chứa các cạnh có trong TDD §7.1 – không phát sinh trạng thái lạ', () => {
      const knownStatuses = new Set<string>(Object.values(CaseStatus));

      for (const rule of CASE_TRANSITIONS) {
        expect(knownStatuses.has(rule.from)).toBe(true);
        expect(knownStatuses.has(rule.to)).toBe(true);
      }
    });

    it('không có cạnh trùng lặp', () => {
      const keys = CASE_TRANSITIONS.map((rule) => `${rule.from}->${rule.to}`);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('mọi trạng thái kết thúc đều không có đường đi tiếp', () => {
      for (const terminal of [CaseStatus.CLOSED, CaseStatus.CANCELLED, CaseStatus.FALSE_ALARM]) {
        expect(allowedTargetsFrom(terminal)).toEqual([]);
      }
    });
  });

  describe('happy path đầy đủ', () => {
    it('đi hết chuỗi CREATED → CLOSED với đúng vai trò ở từng bước', () => {
      const steps: Array<[CaseStatus, CaseStatus, typeof SYSTEM_ACTOR | UserRole[]]> = [
        [CaseStatus.CREATED, CaseStatus.QUEUED, SYSTEM_ACTOR],
        [CaseStatus.QUEUED, CaseStatus.ACCEPTED, [UserRole.OPERATOR_115]],
        [CaseStatus.ACCEPTED, CaseStatus.VIDEO_CONNECTED, SYSTEM_ACTOR],
        [CaseStatus.VIDEO_CONNECTED, CaseStatus.DISPATCHED, [UserRole.CLINICIAN]],
        [CaseStatus.DISPATCHED, CaseStatus.EN_ROUTE, [UserRole.AMBULANCE_CREW]],
        [CaseStatus.EN_ROUTE, CaseStatus.ON_SCENE, [UserRole.AMBULANCE_CREW]],
        [CaseStatus.ON_SCENE, CaseStatus.HANDOVER_PENDING, [UserRole.CLINICIAN]],
        [CaseStatus.HANDOVER_PENDING, CaseStatus.HANDED_OVER, [UserRole.CLINICIAN]],
        [CaseStatus.HANDED_OVER, CaseStatus.CLOSED, [UserRole.OPERATOR_115]],
      ];

      for (const [from, to, actor] of steps) {
        expect(() => assertTransitionAllowed({ from, to, actor })).not.toThrow();
      }
    });
  });

  describe('từ chối transition không hợp lệ', () => {
    it('TC-012: kíp xe không thể nhảy thẳng từ QUEUED sang HANDED_OVER', () => {
      expectDomainError(
        () =>
          assertTransitionAllowed({
            from: CaseStatus.QUEUED,
            to: CaseStatus.HANDED_OVER,
            actor: [UserRole.AMBULANCE_CREW],
          }),
        ApiErrorCode.CASE_INVALID_TRANSITION,
      );
    });

    it('từ chối chuyển về chính trạng thái hiện tại', () => {
      expectDomainError(
        () =>
          assertTransitionAllowed({
            from: CaseStatus.ACCEPTED,
            to: CaseStatus.ACCEPTED,
            actor: [UserRole.OPERATOR_115],
          }),
        ApiErrorCode.CASE_INVALID_TRANSITION,
      );
    });

    it('không cho đi lùi trạng thái', () => {
      expectDomainError(
        () =>
          assertTransitionAllowed({
            from: CaseStatus.ON_SCENE,
            to: CaseStatus.ACCEPTED,
            actor: [UserRole.OPERATOR_115],
          }),
        ApiErrorCode.CASE_INVALID_TRANSITION,
      );
    });
  });

  describe('kiểm tra vai trò', () => {
    it('người dân không được tự nhận ca của mình', () => {
      expectDomainError(
        () =>
          assertTransitionAllowed({
            from: CaseStatus.QUEUED,
            to: CaseStatus.ACCEPTED,
            actor: [UserRole.CITIZEN],
          }),
        ApiErrorCode.FORBIDDEN,
      );
    });

    it('kíp xe không được đóng ca', () => {
      expectDomainError(
        () =>
          assertTransitionAllowed({
            from: CaseStatus.HANDED_OVER,
            to: CaseStatus.CLOSED,
            actor: [UserRole.AMBULANCE_CREW],
          }),
        ApiErrorCode.FORBIDDEN,
      );
    });

    it('người dùng không thực hiện được transition dành riêng cho hệ thống', () => {
      expectDomainError(
        () =>
          assertTransitionAllowed({
            from: CaseStatus.CREATED,
            to: CaseStatus.QUEUED,
            actor: [UserRole.OPERATOR_115],
          }),
        ApiErrorCode.FORBIDDEN,
      );
    });

    it('chỉ OPERATOR_115 được đánh dấu báo nhầm, CLINICIAN thì không', () => {
      expect(() =>
        assertTransitionAllowed({
          from: CaseStatus.QUEUED,
          to: CaseStatus.FALSE_ALARM,
          actor: [UserRole.OPERATOR_115],
          reason: 'Nguoi goi xac nhan bam nham',
        }),
      ).not.toThrow();

      expectDomainError(
        () =>
          assertTransitionAllowed({
            from: CaseStatus.QUEUED,
            to: CaseStatus.FALSE_ALARM,
            actor: [UserRole.CLINICIAN],
            reason: 'Nguoi goi xac nhan bam nham',
          }),
        ApiErrorCode.FORBIDDEN,
      );
    });
  });

  describe('yêu cầu lý do', () => {
    it('TC-029: báo nhầm bắt buộc có lý do', () => {
      expectDomainError(
        () =>
          assertTransitionAllowed({
            from: CaseStatus.ACCEPTED,
            to: CaseStatus.FALSE_ALARM,
            actor: [UserRole.OPERATOR_115],
          }),
        ApiErrorCode.VALIDATION_FAILED,
      );
    });

    it('lý do chỉ gồm khoảng trắng bị coi là thiếu lý do', () => {
      expectDomainError(
        () =>
          assertTransitionAllowed({
            from: CaseStatus.CREATED,
            to: CaseStatus.CANCELLED,
            actor: [UserRole.CITIZEN],
            reason: '   ',
          }),
        ApiErrorCode.VALIDATION_FAILED,
      );
    });

    it('hệ thống cũng phải nêu lý do cho transition yêu cầu lý do', () => {
      expectDomainError(
        () =>
          assertTransitionAllowed({
            from: CaseStatus.CREATED,
            to: CaseStatus.CANCELLED,
            actor: SYSTEM_ACTOR,
          }),
        ApiErrorCode.VALIDATION_FAILED,
      );
    });
  });

  describe('findTransition', () => {
    it('trả null cho cạnh không tồn tại', () => {
      expect(findTransition(CaseStatus.CREATED, CaseStatus.CLOSED)).toBeNull();
    });

    it('trả rule kèm tiền điều kiện cho cạnh hợp lệ', () => {
      const rule = findTransition(CaseStatus.QUEUED, CaseStatus.ACCEPTED);
      expect(rule).not.toBeNull();
      expect(rule?.precondition).toContain('Chỉ một người nhận ca');
    });
  });
});
