import { randomUUID } from 'node:crypto';
import type { MemoryDb } from '../../../persistence/memory/memory-db';
import type { PgExecutor } from '../../../persistence/postgres/pg-executor';
import type { TriageSubmissionRow } from '../../../persistence/rows';
import type { TxContext } from '../../../persistence/unit-of-work';

/**
 * Lưu câu trả lời phân loại (FR-004).
 *
 * Bảng `triage_submissions` là append-only: mỗi lần gửi là một bản ghi mới.
 * Tình trạng người bệnh thay đổi theo thời gian, nên chuỗi submission chính là
 * thông tin có giá trị — ghi đè sẽ xoá mất diễn biến (TC-006).
 */

export interface SubmitTriageInput {
  readonly caseId: string;
  readonly questionnaireVersion: string;
  readonly answers: Array<{ questionCode: string; value: string }>;
  readonly submittedBy: string | null;
}

export interface TriageRepositoryPort {
  submit(tx: TxContext, input: SubmitTriageInput): Promise<TriageSubmissionRow>;
  listByCase(caseId: string): Promise<TriageSubmissionRow[]>;
}

export const TRIAGE_REPOSITORY = Symbol('TRIAGE_REPOSITORY');

export class PgTriageRepository implements TriageRepositoryPort {
  constructor(private readonly executor: PgExecutor) {}

  async submit(tx: TxContext, input: SubmitTriageInput): Promise<TriageSubmissionRow> {
    const rows = await this.executor.query<TriageSubmissionRow>(
      tx,
      `INSERT INTO triage_submissions
         (case_id, questionnaire_version, answers, submitted_by, created_by)
       VALUES ($1, $2, $3::jsonb, $4, $4)
       RETURNING *`,
      [input.caseId, input.questionnaireVersion, JSON.stringify(input.answers), input.submittedBy],
    );
    return rows[0];
  }

  async listByCase(caseId: string): Promise<TriageSubmissionRow[]> {
    return this.executor.query<TriageSubmissionRow>(
      undefined,
      `SELECT * FROM triage_submissions WHERE case_id = $1 ORDER BY created_at ASC`,
      [caseId],
    );
  }
}

export class MemoryTriageRepository implements TriageRepositoryPort {
  constructor(private readonly db: MemoryDb) {}

  async submit(_tx: TxContext, input: SubmitTriageInput): Promise<TriageSubmissionRow> {
    const now = new Date();
    return this.db.triageSubmissions.insert({
      id: randomUUID(),
      case_id: input.caseId,
      questionnaire_version: input.questionnaireVersion,
      answers: input.answers,
      submitted_by: input.submittedBy,
      created_at: now,
      updated_at: now,
      created_by: input.submittedBy,
      updated_by: null,
    } satisfies TriageSubmissionRow);
  }

  async listByCase(caseId: string): Promise<TriageSubmissionRow[]> {
    return this.db.triageSubmissions
      .findMany((row) => row.case_id === caseId)
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  }
}
