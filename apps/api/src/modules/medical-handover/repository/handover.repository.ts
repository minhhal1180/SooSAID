import { randomUUID } from 'node:crypto';
import type { MemoryDb } from '../../../persistence/memory/memory-db';
import type { PgExecutor } from '../../../persistence/postgres/pg-executor';
import type { HandoverRow } from '../../../persistence/rows';
import type { TxContext } from '../../../persistence/unit-of-work';

/**
 * Hồ sơ bàn giao điện tử (FR-013, SOS-033).
 *
 * Bất biến sau khi finalize: sửa nội dung = tạo version mới (TC-018, TC-019).
 * Ràng buộc này được cưỡng chế ở TẦNG DB bằng trigger
 * `trg_handovers_immutable_after_finalize` (migration 0002), không chỉ ở code.
 */

export const HandoverStatus = {
  DRAFT: 'DRAFT',
  FINALIZED: 'FINALIZED',
} as const;
export type HandoverStatus = (typeof HandoverStatus)[keyof typeof HandoverStatus];

export interface CreateHandoverInput {
  readonly caseId: string;
  readonly version: number;
  readonly receivingFacilityId: string | null;
  readonly ambulanceUnitId: string | null;
  readonly payload: Record<string, unknown>;
  readonly finalizedBy: string | null;
}

export interface HandoverRepositoryPort {
  /** Số version lớn nhất hiện có của ca; 0 nếu chưa có bản nào. */
  maxVersionForCase(caseId: string): Promise<number>;
  createFinalized(tx: TxContext, input: CreateHandoverInput): Promise<HandoverRow>;
  listByCase(caseId: string): Promise<HandoverRow[]>;
  findByCaseAndVersion(caseId: string, version: number): Promise<HandoverRow | null>;
}

export const HANDOVER_REPOSITORY = Symbol('HANDOVER_REPOSITORY');

export class PgHandoverRepository implements HandoverRepositoryPort {
  constructor(private readonly executor: PgExecutor) {}

  async maxVersionForCase(caseId: string): Promise<number> {
    const row = await this.executor.queryOne<{ max_version: number | null }>(
      undefined,
      `SELECT MAX(version) AS max_version FROM handovers WHERE case_id = $1`,
      [caseId],
    );
    return row?.max_version ?? 0;
  }

  async createFinalized(tx: TxContext, input: CreateHandoverInput): Promise<HandoverRow> {
    // Tạo thẳng ở trạng thái FINALIZED: ràng buộc UNIQUE(case_id, version) là
    // chốt chặn cuối chống hai người cùng finalize ra cùng số version.
    const rows = await this.executor.query<HandoverRow>(
      tx,
      `INSERT INTO handovers
         (case_id, version, receiving_facility_id, ambulance_unit_id, payload,
          status, finalized_by, finalized_at, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, now(), $7, $7)
       RETURNING *`,
      [
        input.caseId,
        input.version,
        input.receivingFacilityId,
        input.ambulanceUnitId,
        JSON.stringify(input.payload),
        HandoverStatus.FINALIZED,
        input.finalizedBy,
      ],
    );
    return rows[0];
  }

  async listByCase(caseId: string): Promise<HandoverRow[]> {
    return this.executor.query<HandoverRow>(
      undefined,
      `SELECT * FROM handovers WHERE case_id = $1 ORDER BY version DESC`,
      [caseId],
    );
  }

  async findByCaseAndVersion(caseId: string, version: number): Promise<HandoverRow | null> {
    return this.executor.queryOne<HandoverRow>(
      undefined,
      `SELECT * FROM handovers WHERE case_id = $1 AND version = $2`,
      [caseId, version],
    );
  }
}

export class MemoryHandoverRepository implements HandoverRepositoryPort {
  constructor(private readonly db: MemoryDb) {}

  async maxVersionForCase(caseId: string): Promise<number> {
    const versions = this.db.handovers
      .findMany((row) => row.case_id === caseId)
      .map((row) => row.version);
    return versions.length === 0 ? 0 : Math.max(...versions);
  }

  async createFinalized(_tx: TxContext, input: CreateHandoverInput): Promise<HandoverRow> {
    const now = new Date();
    return this.db.handovers.insert({
      id: randomUUID(),
      case_id: input.caseId,
      version: input.version,
      receiving_facility_id: input.receivingFacilityId,
      ambulance_unit_id: input.ambulanceUnitId,
      payload: input.payload,
      status: HandoverStatus.FINALIZED,
      finalized_by: input.finalizedBy,
      finalized_at: now,
      created_at: now,
      updated_at: now,
      created_by: input.finalizedBy,
      updated_by: input.finalizedBy,
    } satisfies HandoverRow);
  }

  async listByCase(caseId: string): Promise<HandoverRow[]> {
    return this.db.handovers
      .findMany((row) => row.case_id === caseId)
      .sort((a, b) => b.version - a.version);
  }

  async findByCaseAndVersion(caseId: string, version: number): Promise<HandoverRow | null> {
    return this.db.handovers.findOne(
      (row) => row.case_id === caseId && row.version === version,
    );
  }
}
