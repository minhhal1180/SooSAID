import type { CaseLocationRow, GeoPoint } from '../../../persistence/rows';
import type { TxContext } from '../../../persistence/unit-of-work';

export interface AppendLocationInput {
  readonly caseId: string;
  readonly location: GeoPoint;
  readonly accuracyMeters: number | null;
  readonly altitudeMeters: number | null;
  readonly addressText: string | null;
  readonly accessNote: string | null;
  readonly source: string;
  readonly capturedAt: Date;
  readonly createdBy: string | null;
}

/**
 * Chuỗi mẫu vị trí của một ca (FR-003).
 *
 * Bảng `case_locations` là **append-only** (migration 0002 chặn UPDATE/DELETE ở
 * tầng DB): dấu vết vị trí là bằng chứng kỹ thuật trong hồ sơ bàn giao, không
 * được sửa lại sau.
 */
export interface LocationRepositoryPort {
  append(tx: TxContext, input: AppendLocationInput): Promise<CaseLocationRow>;

  /** Mẫu vị trí theo ca, mới nhất trước. */
  listByCase(caseId: string, limit: number): Promise<CaseLocationRow[]>;

  latestByCase(caseId: string): Promise<CaseLocationRow | null>;
}

export const LOCATION_REPOSITORY = Symbol('LOCATION_REPOSITORY');

/** Nguồn của mẫu vị trí. */
export const LocationSource = {
  MOBILE_GPS: 'mobile_gps',
  MANUAL_ADDRESS: 'manual_address',
  OPERATOR_CORRECTION: 'operator_correction',
} as const;
export type LocationSource = (typeof LocationSource)[keyof typeof LocationSource];
