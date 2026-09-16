import { randomUUID } from 'node:crypto';
import type { MemoryDb } from '../../../persistence/memory/memory-db';
import type { PgExecutor } from '../../../persistence/postgres/pg-executor';
import type { GuidanceCatalogRow, GuidanceEventRow } from '../../../persistence/rows';
import type { TxContext } from '../../../persistence/unit-of-work';

/**
 * Danh mục hướng dẫn sơ cấp cứu, có version và trạng thái duyệt (FR-010, SOS-030).
 *
 * Bản ghi trong `guidance_events` tham chiếu `guidance_id` của MỘT version cụ
 * thể, nên ca cũ luôn đọc lại đúng nội dung đã hiển thị lúc đó, kể cả khi
 * version mới đã được phát hành (TC-035).
 */

export const GuidanceEventAction = {
  DISPLAYED: 'displayed',
  ACKNOWLEDGED: 'acknowledged',
  SKIPPED: 'skipped',
} as const;
export type GuidanceEventAction =
  (typeof GuidanceEventAction)[keyof typeof GuidanceEventAction];

export interface GuidanceRepositoryPort {
  /** Danh mục khả dụng, lọc theo trạng thái duyệt. */
  listCatalog(approvalStatuses: readonly string[]): Promise<GuidanceCatalogRow[]>;
  findById(guidanceId: string): Promise<GuidanceCatalogRow | null>;
  /** Version mới nhất của một mã hướng dẫn trong các trạng thái cho phép. */
  findLatestByCode(
    code: string,
    approvalStatuses: readonly string[],
  ): Promise<GuidanceCatalogRow | null>;

  recordEvent(
    tx: TxContext,
    input: {
      caseId: string;
      guidanceId: string | null;
      action: GuidanceEventAction;
      actorUserId: string | null;
      metadata: Record<string, unknown>;
    },
  ): Promise<GuidanceEventRow>;

  listEventsByCase(caseId: string): Promise<GuidanceEventRow[]>;
}

export const GUIDANCE_REPOSITORY = Symbol('GUIDANCE_REPOSITORY');

export class PgGuidanceRepository implements GuidanceRepositoryPort {
  constructor(private readonly executor: PgExecutor) {}

  async listCatalog(approvalStatuses: readonly string[]): Promise<GuidanceCatalogRow[]> {
    return this.executor.query<GuidanceCatalogRow>(
      undefined,
      `SELECT * FROM guidance_catalog
        WHERE approval_status = ANY($1) AND retired_at IS NULL
        ORDER BY code ASC, version DESC`,
      [approvalStatuses],
    );
  }

  async findById(guidanceId: string): Promise<GuidanceCatalogRow | null> {
    return this.executor.queryOne<GuidanceCatalogRow>(
      undefined,
      `SELECT * FROM guidance_catalog WHERE id = $1`,
      [guidanceId],
    );
  }

  async findLatestByCode(
    code: string,
    approvalStatuses: readonly string[],
  ): Promise<GuidanceCatalogRow | null> {
    return this.executor.queryOne<GuidanceCatalogRow>(
      undefined,
      `SELECT * FROM guidance_catalog
        WHERE code = $1 AND approval_status = ANY($2) AND retired_at IS NULL
        ORDER BY version DESC
        LIMIT 1`,
      [code, approvalStatuses],
    );
  }

  async recordEvent(
    tx: TxContext,
    input: {
      caseId: string;
      guidanceId: string | null;
      action: GuidanceEventAction;
      actorUserId: string | null;
      metadata: Record<string, unknown>;
    },
  ): Promise<GuidanceEventRow> {
    const rows = await this.executor.query<GuidanceEventRow>(
      tx,
      `INSERT INTO guidance_events
         (case_id, guidance_id, action, actor_user_id, metadata, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $4)
       RETURNING *`,
      [
        input.caseId,
        input.guidanceId,
        input.action,
        input.actorUserId,
        JSON.stringify(input.metadata),
      ],
    );
    return rows[0];
  }

  async listEventsByCase(caseId: string): Promise<GuidanceEventRow[]> {
    return this.executor.query<GuidanceEventRow>(
      undefined,
      `SELECT * FROM guidance_events WHERE case_id = $1 ORDER BY created_at ASC`,
      [caseId],
    );
  }
}

export class MemoryGuidanceRepository implements GuidanceRepositoryPort {
  constructor(private readonly db: MemoryDb) {}

  async listCatalog(approvalStatuses: readonly string[]): Promise<GuidanceCatalogRow[]> {
    return this.db.guidanceCatalog
      .findMany((row) => approvalStatuses.includes(row.approval_status) && row.retired_at === null)
      .sort((a, b) => a.code.localeCompare(b.code) || b.version - a.version);
  }

  async findById(guidanceId: string): Promise<GuidanceCatalogRow | null> {
    return this.db.guidanceCatalog.findById(guidanceId);
  }

  async findLatestByCode(
    code: string,
    approvalStatuses: readonly string[],
  ): Promise<GuidanceCatalogRow | null> {
    return (
      this.db.guidanceCatalog
        .findMany(
          (row) =>
            row.code === code &&
            approvalStatuses.includes(row.approval_status) &&
            row.retired_at === null,
        )
        .sort((a, b) => b.version - a.version)[0] ?? null
    );
  }

  async recordEvent(
    _tx: TxContext,
    input: {
      caseId: string;
      guidanceId: string | null;
      action: GuidanceEventAction;
      actorUserId: string | null;
      metadata: Record<string, unknown>;
    },
  ): Promise<GuidanceEventRow> {
    const now = new Date();
    return this.db.guidanceEvents.insert({
      id: randomUUID(),
      case_id: input.caseId,
      guidance_id: input.guidanceId,
      action: input.action,
      actor_user_id: input.actorUserId,
      metadata: input.metadata,
      created_at: now,
      updated_at: now,
      created_by: input.actorUserId,
      updated_by: null,
    } satisfies GuidanceEventRow);
  }

  async listEventsByCase(caseId: string): Promise<GuidanceEventRow[]> {
    return this.db.guidanceEvents
      .findMany((row) => row.case_id === caseId)
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  }
}
