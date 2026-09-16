import type { CaseStatus } from '../../../contracts/generated/api-contract';
import type {
  CaseNoteRow,
  CaseStatusHistoryRow,
  EmergencyCaseRow,
  GeoPoint,
} from '../../../persistence/rows';
import type { TxContext } from '../../../persistence/unit-of-work';

export interface CreateCaseInput {
  readonly callerUserId: string | null;
  readonly deviceId: string | null;
  readonly serviceAreaId: string | null;
  readonly triggerSource: string;
  readonly numberOfPatients: number;
  readonly location: GeoPoint | null;
  readonly accuracyMeters: number | null;
  readonly addressText: string | null;
  readonly accessNote: string | null;
  readonly mediaConsent: boolean;
  readonly emergencyProfileSnapshot: Record<string, unknown> | null;
  /** Thời điểm sự cố, do client đo. Dùng để sinh phần ngày của mã ca. */
  readonly occurredAt: Date;
}

export interface QueueQuery {
  readonly statuses: readonly CaseStatus[];
  /** Rỗng = không giới hạn service area (tổng đài trung tâm). */
  readonly serviceAreaIds: readonly string[];
  readonly limit: number;
}

export interface EmergencyCaseRepositoryPort {
  create(tx: TxContext, input: CreateCaseInput): Promise<EmergencyCaseRow>;

  findById(id: string): Promise<EmergencyCaseRow | null>;
  findByCode(code: string): Promise<EmergencyCaseRow | null>;

  /**
   * Đổi trạng thái có điều kiện: chỉ thành công nếu trạng thái hiện tại đúng
   * bằng `expectedStatus`. Trả `null` khi có người khác đã đổi trước — đây là
   * optimistic concurrency, chống hai thao tác đồng thời ghi đè nhau
   * (threat model: "Data tampering").
   */
  updateStatusIfCurrent(
    tx: TxContext,
    caseId: string,
    expectedStatus: CaseStatus,
    nextStatus: CaseStatus,
    actorUserId: string | null,
  ): Promise<EmergencyCaseRow | null>;

  /**
   * Nhận ca một cách atomic (FR-005, TC-007).
   * Chỉ thành công khi ca đang QUEUED VÀ chưa có `active_operator_id`.
   * Trả `null` nếu operator khác đã nhận trước.
   */
  acceptIfUnassigned(
    tx: TxContext,
    caseId: string,
    operatorUserId: string,
  ): Promise<EmergencyCaseRow | null>;

  /** Cập nhật vị trí mới nhất trên bản ghi ca (ảnh chụp cho hàng đợi/bản đồ). */
  updateLatestLocation(
    tx: TxContext,
    caseId: string,
    location: GeoPoint,
    accuracyMeters: number | null,
    addressText: string | null,
    accessNote: string | null,
  ): Promise<void>;

  listQueue(query: QueueQuery): Promise<EmergencyCaseRow[]>;

  /** Lịch sử ca của chính người dùng (màn hình M10, chỉ dữ liệu của họ). */
  listByCaller(callerUserId: string, limit: number): Promise<EmergencyCaseRow[]>;

  appendStatusHistory(
    tx: TxContext,
    input: {
      caseId: string;
      fromStatus: CaseStatus | null;
      toStatus: CaseStatus;
      reason: string | null;
      changedBy: string | null;
      metadata: Record<string, unknown>;
    },
  ): Promise<void>;

  listStatusHistory(caseId: string): Promise<CaseStatusHistoryRow[]>;

  addNote(
    tx: TxContext,
    input: { caseId: string; authorUserId: string | null; noteType: string; text: string },
  ): Promise<CaseNoteRow>;

  listNotes(caseId: string): Promise<CaseNoteRow[]>;

  /** Thống kê cho báo cáo pilot (FR-015). */
  countByStatusBetween(from: Date, to: Date): Promise<Record<string, number>>;
  listCreatedBetween(from: Date, to: Date): Promise<EmergencyCaseRow[]>;
}

export const EMERGENCY_CASE_REPOSITORY = Symbol('EMERGENCY_CASE_REPOSITORY');
