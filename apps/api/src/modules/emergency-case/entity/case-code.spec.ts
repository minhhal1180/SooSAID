import { CASE_CODE_PATTERN, buildCaseCode, caseCodeDatePart } from './case-code';
import { CasePhase, CaseStatus, casePhaseOf } from '../../../contracts/generated/api-contract';

describe('case-code', () => {
  const at = new Date('2026-09-13T08:00:00.000Z');

  it('sinh mã đúng định dạng SOS-YYYYMMDD-NNNNNN', () => {
    expect(buildCaseCode(at, 123)).toBe('SOS-20260913-000123');
    expect(CASE_CODE_PATTERN.test(buildCaseCode(at, 123))).toBe(true);
  });

  it('dùng giờ UTC nên không phụ thuộc timezone của server', () => {
    // 23:30 UTC ngày 13 vẫn thuộc ngày 13, dù ở VN (UTC+7) đã là 06:30 ngày 14.
    expect(caseCodeDatePart(new Date('2026-09-13T23:30:00.000Z'))).toBe('20260913');
  });

  it('từ chối số thứ tự không hợp lệ', () => {
    expect(() => buildCaseCode(at, 0)).toThrow();
    expect(() => buildCaseCode(at, -1)).toThrow();
    expect(() => buildCaseCode(at, 1.5)).toThrow();
  });

  it('quay vòng khi vượt số ca tối đa trong ngày', () => {
    expect(buildCaseCode(at, 1_000_001)).toBe('SOS-20260913-000001');
  });

  it('mã không chứa thông tin nhận dạng người dùng', () => {
    // Mã xuất hiện trên màn hình công cộng và trong log, nên chỉ được gồm tiền
    // tố + ngày + số thứ tự.
    expect(buildCaseCode(at, 7)).toMatch(/^SOS-\d{8}-\d{6}$/);
  });
});

/** ADR-001: ánh xạ 12 trạng thái kỹ thuật -> 6 pha hiển thị. */
describe('casePhaseOf (ADR-001)', () => {
  it('ánh xạ đủ 12 trạng thái, không bỏ sót giá trị nào', () => {
    for (const status of Object.values(CaseStatus)) {
      expect(casePhaseOf(status)).toBeDefined();
    }
  });

  it('gộp các trạng thái điều phối vào pha VIDEO_SUPPORT', () => {
    expect(casePhaseOf(CaseStatus.DISPATCHED)).toBe(CasePhase.VIDEO_SUPPORT);
    expect(casePhaseOf(CaseStatus.EN_ROUTE)).toBe(CasePhase.VIDEO_SUPPORT);
    expect(casePhaseOf(CaseStatus.ON_SCENE)).toBe(CasePhase.VIDEO_SUPPORT);
  });

  it('mọi trạng thái kết thúc đều hiển thị là COMPLETED cho người dân', () => {
    expect(casePhaseOf(CaseStatus.CLOSED)).toBe(CasePhase.COMPLETED);
    expect(casePhaseOf(CaseStatus.CANCELLED)).toBe(CasePhase.COMPLETED);
    expect(casePhaseOf(CaseStatus.FALSE_ALARM)).toBe(CasePhase.COMPLETED);
  });
});
