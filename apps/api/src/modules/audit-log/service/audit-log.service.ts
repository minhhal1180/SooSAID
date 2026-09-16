import { Inject, Injectable } from '@nestjs/common';
import { SafeLogger } from '../../../common/logging/safe-logger';
import { currentRequestContext } from '../../../common/http/request-context';
import type { AuditLogRow } from '../../../persistence/rows';
import type { TxContext } from '../../../persistence/unit-of-work';
import { AuditResult, type AuditEntry } from '../entity/audit-action';
import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
  type AuditSearchCriteria,
} from '../repository/audit-log.repository.port';

/**
 * Ghi audit trail (FR-014, Rule 5.1).
 *
 * Actor/IP/user-agent lấy tự động từ request context, nên service nghiệp vụ chỉ
 * cần mô tả *đã làm gì với tài nguyên nào*.
 *
 * Nguyên tắc: **audit không được làm hỏng nghiệp vụ**. Nếu ghi audit thất bại
 * khi đang ở ngoài transaction, lỗi được nuốt và log lại — chặn một ca cấp cứu
 * vì bảng audit lỗi là đánh đổi sai. Ngược lại, audit ghi TRONG transaction
 * (kèm `tx`) sẽ rollback cùng thay đổi nghiệp vụ, đúng như mong muốn.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new SafeLogger().setContext('audit');

  constructor(
    @Inject(AUDIT_LOG_REPOSITORY) private readonly repository: AuditLogRepositoryPort,
  ) {}

  async record(entry: AuditEntry, tx?: TxContext): Promise<void> {
    const context = currentRequestContext();
    const input = {
      ...entry,
      actorUserId: context?.actor?.userId ?? null,
      ipAddress: context?.ipAddress ?? null,
      userAgent: context?.userAgent ?? null,
    };

    if (tx) {
      // Trong transaction: để lỗi lan ra, nghiệp vụ và audit phải cùng số phận.
      await this.repository.write(input, tx);
      return;
    }

    try {
      await this.repository.write(input);
    } catch {
      this.logger.error('audit_write_failed', {
        event: entry.action,
        caseId: entry.caseId ?? undefined,
        result: AuditResult.FAILURE,
      });
    }
  }

  /** Ghi nhận một lần truy cập bị từ chối (TC-025 yêu cầu có audit + metric). */
  async recordDenied(entry: AuditEntry, tx?: TxContext): Promise<void> {
    await this.record({ ...entry, result: AuditResult.DENIED }, tx);
  }

  async search(criteria: AuditSearchCriteria): Promise<AuditLogRow[]> {
    return this.repository.search(criteria);
  }
}
