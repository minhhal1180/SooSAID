import type { PgExecutor } from '../../../persistence/postgres/pg-executor';
import type { AuditLogRow } from '../../../persistence/rows';
import type { TxContext } from '../../../persistence/unit-of-work';
import { AuditResult } from '../entity/audit-action';
import type {
  AuditLogRepositoryPort,
  AuditLogWriteInput,
  AuditSearchCriteria,
} from './audit-log.repository.port';

export class PgAuditLogRepository implements AuditLogRepositoryPort {
  constructor(private readonly executor: PgExecutor) {}

  async write(input: AuditLogWriteInput, tx?: TxContext): Promise<void> {
    await this.executor.query(
      tx,
      `INSERT INTO audit_logs
         (actor_user_id, action, resource_type, resource_id, case_id,
          ip_address, user_agent, result, metadata, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::inet, $7, $8, $9::jsonb, $1)`,
      [
        input.actorUserId,
        input.action,
        input.resourceType,
        input.resourceId ?? null,
        input.caseId ?? null,
        input.ipAddress,
        input.userAgent,
        input.result ?? AuditResult.SUCCESS,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  async search(criteria: AuditSearchCriteria): Promise<AuditLogRow[]> {
    // Dựng WHERE động bằng tham số đánh số – tuyệt đối không nối giá trị vào SQL.
    const conditions: string[] = [];
    const params: unknown[] = [];

    const addCondition = (sql: string, value: unknown): void => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };

    if (criteria.caseId) addCondition('case_id = ?', criteria.caseId);
    if (criteria.actorUserId) addCondition('actor_user_id = ?', criteria.actorUserId);
    if (criteria.action) addCondition('action = ?', criteria.action);
    if (criteria.from) addCondition('created_at >= ?', criteria.from);
    if (criteria.to) addCondition('created_at <= ?', criteria.to);

    params.push(criteria.limit, criteria.offset);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    return this.executor.query<AuditLogRow>(
      undefined,
      `SELECT * FROM audit_logs
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
  }
}
