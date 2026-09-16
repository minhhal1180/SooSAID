/**
 * Bộ câu hỏi phân loại ban đầu (FR-004, SOS-013).
 *
 * RÀNG BUỘC TUYỆT ĐỐI (Rule 1.2 – không chẩn đoán bệnh):
 *  - Chỉ hỏi dấu hiệu **quan sát được** bằng mắt/tai, không hỏi triệu chứng cần
 *    kiến thức y khoa để nhận định.
 *  - Hệ thống KHÔNG suy ra mức độ nguy cấp, KHÔNG gán nhãn bệnh, KHÔNG tính
 *    điểm phân loại. Câu trả lời chỉ được lưu và hiển thị nguyên văn cho nhân
 *    viên y tế; mọi kết luận là của con người có chuyên môn.
 *  - Mọi câu đều cho phép "không rõ": ép người hoảng loạn chọn có/không sẽ tạo
 *    ra dữ liệu sai còn tệ hơn không có dữ liệu.
 *
 * Bộ câu hỏi được version hoá. Ca cũ tham chiếu đúng version đã dùng lúc đó, nên
 * sửa nội dung về sau không làm thay đổi hồ sơ đã bàn giao (TC-035).
 */

export const TriageAnswerValue = {
  YES: 'yes',
  NO: 'no',
  UNKNOWN: 'unknown',
} as const;
export type TriageAnswerValue = (typeof TriageAnswerValue)[keyof typeof TriageAnswerValue];

export interface TriageQuestion {
  readonly code: string;
  readonly label: string;
  readonly helpText: string;
  readonly allowedValues: readonly TriageAnswerValue[];
}

export interface TriageQuestionnaire {
  readonly version: string;
  readonly title: string;
  readonly disclaimer: string;
  readonly questions: readonly TriageQuestion[];
}

const OBSERVABLE_VALUES = [
  TriageAnswerValue.YES,
  TriageAnswerValue.NO,
  TriageAnswerValue.UNKNOWN,
] as const;

/**
 * Phiên bản dùng trong Pilot/diễn tập.
 *
 * Nội dung này CHƯA được chuyên gia y tế phê duyệt — đó là một Open Decision
 * (xem docs/decision-log/README.md). Trước khi chạy ca thật, bộ câu hỏi phải
 * được duyệt và phát hành dưới một version mới.
 */
export const PILOT_QUESTIONNAIRE_V1: TriageQuestionnaire = {
  version: 'pilot-1',
  title: 'Ghi nhận dấu hiệu quan sát được',
  disclaimer:
    'Các câu hỏi chỉ nhằm ghi nhận điều bạn NHÌN/NGHE thấy để chuyển cho nhân viên y tế. ' +
    'Hệ thống không chẩn đoán bệnh và không thay thế đánh giá của bác sĩ.',
  questions: [
    {
      code: 'responsive',
      label: 'Người gặp nạn có phản ứng khi bạn gọi to hoặc chạm vào vai không?',
      helpText: 'Mở mắt, cử động, phát ra tiếng đều tính là có phản ứng.',
      allowedValues: OBSERVABLE_VALUES,
    },
    {
      code: 'breathing_visible',
      label: 'Bạn có thấy lồng ngực di động lên xuống không?',
      helpText: 'Quan sát trong khoảng 10 giây.',
      allowedValues: OBSERVABLE_VALUES,
    },
    {
      code: 'visible_bleeding',
      label: 'Có chỗ nào chảy máu nhìn thấy rõ không?',
      helpText: 'Nếu có, nói rõ vị trí cho nhân viên trực qua video.',
      allowedValues: OBSERVABLE_VALUES,
    },
    {
      code: 'able_to_speak',
      label: 'Người gặp nạn có nói được thành câu không?',
      helpText: 'Nói ngắt quãng hoặc chỉ ú ớ thì chọn "không rõ".',
      allowedValues: OBSERVABLE_VALUES,
    },
    {
      code: 'recent_fall_or_impact',
      label: 'Có vừa xảy ra ngã, va đập hoặc tai nạn không?',
      helpText: 'Theo điều bạn chứng kiến hoặc người xung quanh kể lại.',
      allowedValues: OBSERVABLE_VALUES,
    },
    {
      code: 'scene_hazard',
      label: 'Hiện trường còn nguy hiểm không (giao thông, điện, nước, khói)?',
      helpText: 'Thông tin này giúp kíp cấp cứu chuẩn bị khi tiếp cận.',
      allowedValues: OBSERVABLE_VALUES,
    },
  ],
};

const QUESTIONNAIRES_BY_VERSION = new Map<string, TriageQuestionnaire>([
  [PILOT_QUESTIONNAIRE_V1.version, PILOT_QUESTIONNAIRE_V1],
]);

export const CURRENT_QUESTIONNAIRE_VERSION = PILOT_QUESTIONNAIRE_V1.version;

export function findQuestionnaire(version: string): TriageQuestionnaire | null {
  return QUESTIONNAIRES_BY_VERSION.get(version) ?? null;
}
