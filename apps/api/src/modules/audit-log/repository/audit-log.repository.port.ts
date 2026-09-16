import type { AuditLogRow } from '../../../persistence/rows';
import type { TxContext } from '../../../persistence/unit-of-work';
import type { AuditEntry } from '../entity/audit-action';

export interface AuditLogWriteInput extends AuditEntry {
  readonly actorUserId: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export interface AuditSearchCriteria {
  readonly caseId?: string;
  readonly actorUserId?: string;
  readonly action?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly offset: number;
}

export interface AuditLogRepositoryPort {
  /**
   * `tx` tuỳ chọn: ghi trong transaction khi audit gắn với một thay đổi nghiệp
   * vụ (đổi trạng thái ca), ghi ngoài transaction khi audit một thao tác chỉ đọc.
   */
  write(input: AuditLogWriteInput, tx?: TxContext): Promise<void>;

  search(criteria: AuditSearchCriteria): Promise<AuditLogRow[]>;
}

export const AUDIT_LOG_REPOSITORY = Symbol('AUDIT_LOG_REPOSITORY');
