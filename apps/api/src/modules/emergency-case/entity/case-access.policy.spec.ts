import { CaseStatus, UserRole } from '../../../contracts/generated/api-contract';
import type { AuthenticatedActor } from '../../../common/http/request-context';
import type { EmergencyCaseRow } from '../../../persistence/rows';
import {
  canAddCaseNote,
  canDispatch,
  canJoinVideoSession,
  canViewCase,
  canViewHealthProfileByRole,
  canViewPreciseLocation,
  type CaseAccessContext,
} from './case-access.policy';

/**
 * Phân quyền trên từng ca là chốt chặn của threat "Unauthorized medical data
 * access" và "Location leakage". Test phủ cả hai hướng: ai ĐƯỢC và ai KHÔNG.
 *
 * Mapping: TDD §4.1 (ma trận quyền), TC-015, TC-025.
 */
describe('case-access.policy', () => {
  const CALLER_ID = 'caller-1';
  const AREA_A = 'area-a';
  const AREA_B = 'area-b';

  const actor = (roles: UserRole[], overrides: Partial<AuthenticatedActor> = {}): AuthenticatedActor => ({
    userId: 'actor-1',
    roles,
    serviceAreaIds: [],
    ...overrides,
  });

  const caseRow = (overrides: Partial<EmergencyCaseRow> = {}): EmergencyCaseRow =>
    ({
      id: 'case-1',
      code: 'SOS-20260913-000001',
      trigger_source: 'sos_button',
      caller_user_id: CALLER_ID,
      device_id: null,
      service_area_id: AREA_A,
      active_operator_id: null,
      status: CaseStatus.QUEUED,
      number_of_patients: 1,
      first_location: null,
      latest_location: null,
      latest_accuracy_meters: null,
      address_text: null,
      access_note: null,
      media_consent: false,
      emergency_profile_snapshot: null,
      accepted_at: null,
      closed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      created_by: null,
      updated_by: null,
      ...overrides,
    }) as EmergencyCaseRow;

  const context = (overrides: Partial<CaseAccessContext> = {}): CaseAccessContext => ({
    actor: actor([UserRole.CITIZEN]),
    caseRow: caseRow(),
    isAssignedToCase: false,
    ...overrides,
  });

  describe('canViewCase', () => {
    it('người tạo ca xem được ca của mình', () => {
      const ctx = context({ actor: actor([UserRole.CITIZEN], { userId: CALLER_ID }) });
      expect(canViewCase(ctx)).toBe(true);
    });

    it('TC-025: người dân khác KHÔNG xem được ca không phải của mình', () => {
      const ctx = context({ actor: actor([UserRole.CITIZEN], { userId: 'someone-else' }) });
      expect(canViewCase(ctx)).toBe(false);
    });

    it('tổng đài trong đúng service area xem được', () => {
      const ctx = context({
        actor: actor([UserRole.OPERATOR_115], { serviceAreaIds: [AREA_A] }),
      });
      expect(canViewCase(ctx)).toBe(true);
    });

    it('TC-025: tổng đài ở service area khác KHÔNG xem được', () => {
      const ctx = context({
        actor: actor([UserRole.OPERATOR_115], { serviceAreaIds: [AREA_B] }),
      });
      expect(canViewCase(ctx)).toBe(false);
    });

    it('tổng đài không gắn service area nào = phạm vi toàn hệ thống', () => {
      const ctx = context({ actor: actor([UserRole.OPERATOR_115], { serviceAreaIds: [] }) });
      expect(canViewCase(ctx)).toBe(true);
    });

    it('kíp xe chỉ xem được khi đã được phân công', () => {
      const unassigned = context({ actor: actor([UserRole.AMBULANCE_CREW]) });
      expect(canViewCase(unassigned)).toBe(false);

      const assigned = context({
        actor: actor([UserRole.AMBULANCE_CREW]),
        isAssignedToCase: true,
      });
      expect(canViewCase(assigned)).toBe(true);
    });

    it('ca không xác định được service area chỉ tổng đài và admin tiếp cận', () => {
      const orphan = caseRow({ service_area_id: null });

      expect(
        canViewCase(context({ actor: actor([UserRole.OPERATOR_115]), caseRow: orphan })),
      ).toBe(true);
      expect(
        canViewCase(context({ actor: actor([UserRole.CLINICIAN]), caseRow: orphan })),
      ).toBe(false);
    });
  });

  describe('canViewPreciseLocation', () => {
    it('AUDITOR xem được ca nhưng KHÔNG xem được toạ độ chính xác', () => {
      const ctx = context({ actor: actor([UserRole.AUDITOR]) });
      expect(canViewCase(ctx)).toBe(true);
      expect(canViewPreciseLocation(ctx)).toBe(false);
    });

    it('ADMIN xem được toạ độ để xử lý sự cố vận hành', () => {
      expect(canViewPreciseLocation(context({ actor: actor([UserRole.ADMIN]) }))).toBe(true);
    });

    it('người hỗ trợ chỉ xem được toạ độ khi đã được phân công', () => {
      expect(
        canViewPreciseLocation(context({ actor: actor([UserRole.LOCAL_RESPONDER]) })),
      ).toBe(false);
      expect(
        canViewPreciseLocation(
          context({ actor: actor([UserRole.LOCAL_RESPONDER]), isAssignedToCase: true }),
        ),
      ).toBe(true);
    });
  });

  describe('canViewHealthProfileByRole (TC-015)', () => {
    it('ADMIN KHÔNG mặc định xem được hồ sơ sức khỏe', () => {
      expect(canViewHealthProfileByRole(context({ actor: actor([UserRole.ADMIN]) }))).toBe(false);
    });

    it('AUDITOR KHÔNG xem được hồ sơ sức khỏe', () => {
      expect(canViewHealthProfileByRole(context({ actor: actor([UserRole.AUDITOR]) }))).toBe(
        false,
      );
    });

    it('bác sĩ trực trong scope xem được', () => {
      expect(
        canViewHealthProfileByRole(
          context({ actor: actor([UserRole.CLINICIAN], { serviceAreaIds: [AREA_A] }) }),
        ),
      ).toBe(true);
    });

    it('chủ dữ liệu luôn xem được hồ sơ của mình', () => {
      expect(
        canViewHealthProfileByRole(
          context({ actor: actor([UserRole.CITIZEN], { userId: CALLER_ID }) }),
        ),
      ).toBe(true);
    });
  });

  describe('canJoinVideoSession', () => {
    it('chỉ người gọi, tổng đài và bác sĩ trực (TDD §4.1)', () => {
      expect(
        canJoinVideoSession(context({ actor: actor([UserRole.CITIZEN], { userId: CALLER_ID }) })),
      ).toBe(true);
      expect(canJoinVideoSession(context({ actor: actor([UserRole.OPERATOR_115]) }))).toBe(true);
      expect(canJoinVideoSession(context({ actor: actor([UserRole.CLINICIAN]) }))).toBe(true);

      expect(
        canJoinVideoSession(
          context({ actor: actor([UserRole.AMBULANCE_CREW]), isAssignedToCase: true }),
        ),
      ).toBe(false);
      expect(canJoinVideoSession(context({ actor: actor([UserRole.ADMIN]) }))).toBe(false);
    });
  });

  describe('canAddCaseNote / canDispatch', () => {
    it('người dân không ghi chú chuyên môn và không điều phối', () => {
      const ctx = context({ actor: actor([UserRole.CITIZEN], { userId: CALLER_ID }) });
      expect(canAddCaseNote(ctx)).toBe(false);
      expect(canDispatch(ctx)).toBe(false);
    });

    it('kíp xe được ghi chú khi đã phân công nhưng không được điều phối', () => {
      const ctx = context({
        actor: actor([UserRole.AMBULANCE_CREW]),
        isAssignedToCase: true,
      });
      expect(canAddCaseNote(ctx)).toBe(true);
      expect(canDispatch(ctx)).toBe(false);
    });

    it('điều phối viên ngoài service area không điều phối được', () => {
      const ctx = context({
        actor: actor([UserRole.OPERATOR_115], { serviceAreaIds: [AREA_B] }),
      });
      expect(canDispatch(ctx)).toBe(false);
    });
  });
});
