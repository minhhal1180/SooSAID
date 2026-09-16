/**
 * Mã ca hiển thị cho người dùng: `SOS-YYYYMMDD-NNNNNN` (TDD §10.2).
 *
 * Vì sao có mã riêng bên cạnh UUID: người dân và nhân viên y tế phải đọc mã này
 * qua điện thoại trong tình huống khẩn cấp. UUID không đọc được bằng lời.
 *
 * Mã KHÔNG chứa thông tin nhận dạng (không tên, không số điện thoại, không vị
 * trí) — nó có thể xuất hiện trong log và trên màn hình công cộng.
 */

const CASE_CODE_PREFIX = 'SOS';
const SEQUENCE_DIGITS = 6;
/** Số ca tối đa mỗi ngày trước khi phần số quay vòng. */
export const MAX_CASES_PER_DAY = 10 ** SEQUENCE_DIGITS;

export const CASE_CODE_PATTERN = /^SOS-\d{8}-\d{6}$/;

/** Phần ngày của mã, theo giờ UTC để không phụ thuộc timezone của server. */
export function caseCodeDatePart(at: Date): string {
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  const day = String(at.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Ghép mã ca từ ngày và số thứ tự trong ngày.
 * `dailySequence` bắt đầu từ 1 và do tầng repository cấp phát (sequence của
 * PostgreSQL hoặc bộ đếm của driver memory) để đảm bảo không trùng.
 */
export function buildCaseCode(at: Date, dailySequence: number): string {
  if (!Number.isInteger(dailySequence) || dailySequence < 1) {
    throw new Error(`dailySequence phải là số nguyên >= 1, nhận được ${dailySequence}`);
  }
  const sequence = String(dailySequence % MAX_CASES_PER_DAY).padStart(SEQUENCE_DIGITS, '0');
  return `${CASE_CODE_PREFIX}-${caseCodeDatePart(at)}-${sequence}`;
}
