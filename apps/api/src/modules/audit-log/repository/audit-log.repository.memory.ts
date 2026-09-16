import { randomUUID } from 'node:crypto';
import type { MemoryDb } from '../../../persistence/memory/memory-db';
import type { AuditLogRow } from '../../../persistence/rows';
import { AuditResult } from '../entity/audit-action';
import type {
  AuditLogRepositoryPort,
  AuditLogWriteInput,
  AuditSearchCriteria,
} from './audit-log.repository.port';

export class MemoryAuditLogRepository implements AuditLogRepositoryPort {
  constructor(private readonly db: MemoryDb) {}

  async write(input: AuditLogWriteInput): Promise<void> {
    const now = new Date();
    this.db.auditLogs.insert({
      id: randomUUID(),
      actor_user_id: input.actorUserId,
      action: input.action,
      resource_type: input.resourceType,
      resource_id: input.resourceId ?? null,
      case_id: input.caseId ?? null,
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
      result: input.result ?? AuditResult.SUCCESS,
      metadata: input.metadata ?? {},
      created_at: now,
      updated_at: now,
      created_by: input.actorUserId,
      updated_by: null,
    } satisfies AuditLogRow);
  }

  async search(criteria: AuditSearchCriteria): Promise<AuditLogRow[]> {
    return this.db.auditLogs
      .findMany((row) => {
        if (criteria.caseId && row.case_id !== criteria.caseId) return false;
        if (criteria.actorUserId && row.actor_user_id !== criteria.actorUserId) return false;
        if (criteria.action && row.action !== criteria.action) return false;
        if (criteria.from && row.created_at < criteria.from) return false;
        if (criteria.to && row.created_at > criteria.to) return false;
        return true;
      })
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(criteria.offset, criteria.offset + criteria.limit);
  }
}
