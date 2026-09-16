import { randomUUID } from 'node:crypto';
import {
  AssignmentStatus,
  AssignmentType,
  type DispatchPriority,
} from '../../../contracts/generated/api-contract';
import type { MemoryDb } from '../../../persistence/memory/memory-db';
import type { PgExecutor } from '../../../persistence/postgres/pg-executor';
import type { DispatchAssignmentRow } from '../../../persistence/rows';
import type { TxContext } from '../../../persistence/unit-of-work';

/**
 * Phân công điều phối (SOS-024, SOS-025, SOS-026).
 *
 * `dispatch_assignments` có vòng đời RIÊNG, tách khỏi trạng thái ca (FR-008):
 * một assignment bị từ chối không được tự ý kéo trạng thái ca lùi lại.
 */

export interface CreateAssignmentInput {
  readonly caseId: string;
  readonly assignmentType: AssignmentType;
  readonly ambulanceUnitId: string | null;
  readonly responderId: string | null;
  readonly priority: DispatchPriority;
  readonly assignedBy: string | null;
}

export interface DispatchRepositoryPort {
  create(tx: TxContext, input: CreateAssignmentInput): Promise<DispatchAssignmentRow>;
  findById(assignmentId: string): Promise<DispatchAssignmentRow | null>;
  listByCase(caseId: string): Promise<DispatchAssignmentRow[]>;

  /** Đổi trạng thái assignment có kiểm tra trạng thái hiện tại (optimistic). */
  updateStatusIfCurrent(
    tx: TxContext,
    assignmentId: string,
    expected: AssignmentStatus,
    next: AssignmentStatus,
    actorUserId: string | null,
  ): Promise<DispatchAssignmentRow | null>;

  /** Assignment còn hiệu lực của một người (kíp xe hoặc người hỗ trợ). */
  listActiveByUser(userId: string): Promise<DispatchAssignmentRow[]>;

  /**
   * Người dùng có đang được phân công cho ca này không?
   * Đúng khi: là `responders.user_id` của một assignment, HOẶC là thành viên
   * đang hiệu lực của kíp xe được phân công (bảng `ambulance_unit_members`,
   * migration 0003).
   */
  isUserAssignedToCase(caseId: string, userId: string): Promise<boolean>;
}

export const DISPATCH_REPOSITORY = Symbol('DISPATCH_REPOSITORY');

/** Assignment đã kết thúc – không còn cho quyền truy cập ca. */
const CLOSED_ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = [
  AssignmentStatus.REJECTED,
  AssignmentStatus.COMPLETED,
  AssignmentStatus.CANCELLED,
];

export class PgDispatchRepository implements DispatchRepositoryPort {
  constructor(private readonly executor: PgExecutor) {}

  async create(tx: TxContext, input: CreateAssignmentInput): Promise<DispatchAssignmentRow> {
    const rows = await this.executor.query<DispatchAssignmentRow>(
      tx,
      `INSERT INTO dispatch_assignments
         (case_id, assignment_type, ambulance_unit_id, responder_id, status, priority,
          assigned_by, created_by, updated_by)
       VALUES ($1, $2::assignment_type, $3, $4, $5::assignment_status, $6, $7, $7, $7)
       RETURNING *`,
      [
        input.caseId,
        input.assignmentType,
        input.ambulanceUnitId,
        input.responderId,
        AssignmentStatus.PENDING,
        input.priority,
        input.assignedBy,
      ],
    );
    return rows[0];
  }

  async findById(assignmentId: string): Promise<DispatchAssignmentRow | null> {
    return this.executor.queryOne<DispatchAssignmentRow>(
      undefined,
      `SELECT * FROM dispatch_assignments WHERE id = $1`,
      [assignmentId],
    );
  }

  async listByCase(caseId: string): Promise<DispatchAssignmentRow[]> {
    return this.executor.query<DispatchAssignmentRow>(
      undefined,
      `SELECT * FROM dispatch_assignments WHERE case_id = $1 ORDER BY assigned_at DESC`,
      [caseId],
    );
  }

  async updateStatusIfCurrent(
    tx: TxContext,
    assignmentId: string,
    expected: AssignmentStatus,
    next: AssignmentStatus,
    actorUserId: string | null,
  ): Promise<DispatchAssignmentRow | null> {
    // Các mốc thời gian được ghi đúng một lần, tại đúng transition tương ứng —
    // đây là dữ liệu nguồn cho KPI thời gian tiếp cận (FR-015).
    return this.executor.queryOne<DispatchAssignmentRow>(
      tx,
      `UPDATE dispatch_assignments
          SET status = $3::assignment_status,
              accepted_at  = CASE WHEN $3 = 'ACCEPTED'  THEN now() ELSE accepted_at  END,
              arrived_at   = CASE WHEN $3 = 'ARRIVED'   THEN now() ELSE arrived_at   END,
              completed_at = CASE WHEN $3 = 'COMPLETED' THEN now() ELSE completed_at END,
              updated_by = $4
        WHERE id = $1 AND status = $2::assignment_status
        RETURNING *`,
      [assignmentId, expected, next, actorUserId],
    );
  }

  async listActiveByUser(userId: string): Promise<DispatchAssignmentRow[]> {
    return this.executor.query<DispatchAssignmentRow>(
      undefined,
      `SELECT d.* FROM dispatch_assignments d
         LEFT JOIN responders r ON r.id = d.responder_id
         LEFT JOIN ambulance_unit_members m
                ON m.ambulance_unit_id = d.ambulance_unit_id AND m.active_to IS NULL
        WHERE (r.user_id = $1 OR m.user_id = $1)
          AND d.status <> ALL($2::assignment_status[])
        ORDER BY d.assigned_at DESC`,
      [userId, CLOSED_ASSIGNMENT_STATUSES],
    );
  }

  async isUserAssignedToCase(caseId: string, userId: string): Promise<boolean> {
    const row = await this.executor.queryOne<{ exists: boolean }>(
      undefined,
      `SELECT EXISTS (
         SELECT 1 FROM dispatch_assignments d
           LEFT JOIN responders r ON r.id = d.responder_id
           LEFT JOIN ambulance_unit_members m
                  ON m.ambulance_unit_id = d.ambulance_unit_id AND m.active_to IS NULL
          WHERE d.case_id = $1
            AND (r.user_id = $2 OR m.user_id = $2)
            AND d.status <> ALL($3::assignment_status[])
       ) AS exists`,
      [caseId, userId, CLOSED_ASSIGNMENT_STATUSES],
    );
    return row?.exists ?? false;
  }
}

export class MemoryDispatchRepository implements DispatchRepositoryPort {
  constructor(private readonly db: MemoryDb) {}

  async create(_tx: TxContext, input: CreateAssignmentInput): Promise<DispatchAssignmentRow> {
    const now = new Date();
    return this.db.dispatchAssignments.insert({
      id: randomUUID(),
      case_id: input.caseId,
      assignment_type: input.assignmentType,
      ambulance_unit_id: input.ambulanceUnitId,
      responder_id: input.responderId,
      status: AssignmentStatus.PENDING,
      priority: input.priority,
      assigned_by: input.assignedBy,
      assigned_at: now,
      accepted_at: null,
      arrived_at: null,
      completed_at: null,
      created_at: now,
      updated_at: now,
      created_by: input.assignedBy,
      updated_by: input.assignedBy,
    } satisfies DispatchAssignmentRow);
  }

  async findById(assignmentId: string): Promise<DispatchAssignmentRow | null> {
    return this.db.dispatchAssignments.findById(assignmentId);
  }

  async listByCase(caseId: string): Promise<DispatchAssignmentRow[]> {
    return this.db.dispatchAssignments
      .findMany((row) => row.case_id === caseId)
      .sort((a, b) => b.assigned_at.getTime() - a.assigned_at.getTime());
  }

  async updateStatusIfCurrent(
    _tx: TxContext,
    assignmentId: string,
    expected: AssignmentStatus,
    next: AssignmentStatus,
    actorUserId: string | null,
  ): Promise<DispatchAssignmentRow | null> {
    const now = new Date();
    return this.db.dispatchAssignments.updateWhere(
      assignmentId,
      (row) => row.status === expected,
      {
        status: next,
        updated_by: actorUserId,
        ...(next === AssignmentStatus.ACCEPTED ? { accepted_at: now } : {}),
        ...(next === AssignmentStatus.ARRIVED ? { arrived_at: now } : {}),
        ...(next === AssignmentStatus.COMPLETED ? { completed_at: now } : {}),
      },
    );
  }

  async listActiveByUser(userId: string): Promise<DispatchAssignmentRow[]> {
    return this.db.dispatchAssignments
      .findMany(
        (row) => this.matchesUser(row, userId) && !CLOSED_ASSIGNMENT_STATUSES.includes(row.status),
      )
      .sort((a, b) => b.assigned_at.getTime() - a.assigned_at.getTime());
  }

  async isUserAssignedToCase(caseId: string, userId: string): Promise<boolean> {
    return (
      this.db.dispatchAssignments.findOne(
        (row) =>
          row.case_id === caseId &&
          this.matchesUser(row, userId) &&
          !CLOSED_ASSIGNMENT_STATUSES.includes(row.status),
      ) !== null
    );
  }

  /** Cùng ngữ nghĩa với JOIN của driver postgres: qua responder hoặc qua kíp xe. */
  private matchesUser(row: DispatchAssignmentRow, userId: string): boolean {
    if (row.assignment_type === AssignmentType.LOCAL_RESPONDER && row.responder_id) {
      const responder = this.db.responders.findById(row.responder_id);
      return responder?.user_id === userId;
    }
    if (row.assignment_type === AssignmentType.AMBULANCE_UNIT && row.ambulance_unit_id) {
      return (
        this.db.ambulanceUnitMembers.findOne(
          (member) =>
            member.ambulance_unit_id === row.ambulance_unit_id &&
            member.user_id === userId &&
            member.active_to === null,
        ) !== null
      );
    }
    return false;
  }
}
