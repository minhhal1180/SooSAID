import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '../../../contracts/generated/api-contract';
import { Roles } from '../../../common/security/auth.decorators';
import { AuditAction, AuditResourceType } from '../entity/audit-action';
import { SearchAuditQueryDto } from '../dto/search-audit.dto';
import { AuditLogService } from '../service/audit-log.service';

/**
 * Tra cứu audit trail (SOS-043).
 *
 * Chỉ ADMIN và AUDITOR. Bản thân việc tra cứu audit cũng được audit — đó là
 * kiểm soát cho threat "Insider abuse" trong threat model.
 *
 * Export hàng loạt CHƯA được mở ở MVP: threat model yêu cầu "approval for bulk
 * export", mà quy trình phê duyệt đó là Open Decision chưa chốt.
 */
@Controller('audit-logs')
@Roles(UserRole.ADMIN, UserRole.AUDITOR)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  async search(@Query() query: SearchAuditQueryDto) {
    const rows = await this.auditLogService.search({
      caseId: query.caseId,
      actorUserId: query.actorUserId,
      action: query.action,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit: query.limit,
      offset: query.offset,
    });

    await this.auditLogService.record({
      action: AuditAction.AUDIT_SEARCHED,
      resourceType: AuditResourceType.AUDIT_LOG,
      caseId: query.caseId ?? null,
      metadata: { resultCount: rows.length },
    });

    return {
      items: rows.map((row) => ({
        id: row.id,
        actorUserId: row.actor_user_id,
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        caseId: row.case_id,
        result: row.result,
        metadata: row.metadata,
        createdAt: row.created_at.toISOString(),
      })),
      limit: query.limit,
      offset: query.offset,
    };
  }
}
