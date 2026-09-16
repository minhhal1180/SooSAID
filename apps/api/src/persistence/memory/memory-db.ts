import { Injectable } from '@nestjs/common';
import type {
  AmbulanceUnitMemberRow,
  AmbulanceUnitRow,
  AuditLogRow,
  CaseLocationRow,
  CaseNoteRow,
  CaseStatusHistoryRow,
  ConsentRecordRow,
  DeviceRow,
  DispatchAssignmentRow,
  EmergencyCaseRow,
  EmergencyContactRow,
  EmergencyProfileRow,
  GuidanceCatalogRow,
  GuidanceEventRow,
  HandoverRow,
  IdempotencyKeyRow,
  LocalResourceRow,
  MedicalFacilityRow,
  NotificationDeliveryRow,
  OutboxEventRow,
  ResponderRow,
  ServiceAreaRow,
  TriageSubmissionRow,
  UserRoleRow,
  UserRow,
  VideoSessionRow,
} from '../rows';

/**
 * Kho dữ liệu in-memory cho driver `memory` (ADR-004).
 *
 * CHỈ dùng cho local demo và test. Không transaction, không constraint,
 * không PostGIS, mất sạch khi restart. `AppConfig` chặn driver này ở production.
 */

/** Bảng in-memory: Map theo id + các thao tác truy vấn cơ bản. */
export class MemoryTable<T extends { id: string }> {
  private readonly rows = new Map<string, T>();

  insert(row: T): T {
    this.rows.set(row.id, row);
    return row;
  }

  /** Cập nhật có điều kiện – nền tảng cho thao tác atomic ở driver memory. */
  updateWhere(id: string, guard: (row: T) => boolean, patch: Partial<T>): T | null {
    const row = this.rows.get(id);
    if (!row || !guard(row)) return null;
    const updated = { ...row, ...patch, updated_at: new Date() } as T;
    this.rows.set(id, updated);
    return updated;
  }

  update(id: string, patch: Partial<T>): T | null {
    return this.updateWhere(id, () => true, patch);
  }

  findById(id: string): T | null {
    return this.rows.get(id) ?? null;
  }

  findOne(predicate: (row: T) => boolean): T | null {
    for (const row of this.rows.values()) {
      if (predicate(row)) return row;
    }
    return null;
  }

  findMany(predicate: (row: T) => boolean = () => true): T[] {
    return [...this.rows.values()].filter(predicate);
  }

  delete(id: string): void {
    this.rows.delete(id);
  }

  get size(): number {
    return this.rows.size;
  }

  clear(): void {
    this.rows.clear();
  }
}

@Injectable()
export class MemoryDb {
  readonly users = new MemoryTable<UserRow>();
  readonly userRoles = new MemoryTable<UserRoleRow>();
  readonly devices = new MemoryTable<DeviceRow>();
  readonly emergencyProfiles = new MemoryTable<EmergencyProfileRow>();
  readonly emergencyContacts = new MemoryTable<EmergencyContactRow>();
  readonly serviceAreas = new MemoryTable<ServiceAreaRow>();
  readonly medicalFacilities = new MemoryTable<MedicalFacilityRow>();
  readonly localResources = new MemoryTable<LocalResourceRow>();
  readonly ambulanceUnits = new MemoryTable<AmbulanceUnitRow>();
  readonly ambulanceUnitMembers = new MemoryTable<AmbulanceUnitMemberRow>();
  readonly responders = new MemoryTable<ResponderRow>();
  readonly emergencyCases = new MemoryTable<EmergencyCaseRow>();
  readonly caseLocations = new MemoryTable<CaseLocationRow>();
  readonly triageSubmissions = new MemoryTable<TriageSubmissionRow>();
  readonly caseStatusHistory = new MemoryTable<CaseStatusHistoryRow>();
  readonly videoSessions = new MemoryTable<VideoSessionRow>();
  readonly dispatchAssignments = new MemoryTable<DispatchAssignmentRow>();
  readonly guidanceCatalog = new MemoryTable<GuidanceCatalogRow>();
  readonly guidanceEvents = new MemoryTable<GuidanceEventRow>();
  readonly caseNotes = new MemoryTable<CaseNoteRow>();
  readonly handovers = new MemoryTable<HandoverRow>();
  readonly notificationDeliveries = new MemoryTable<NotificationDeliveryRow>();
  readonly consentRecords = new MemoryTable<ConsentRecordRow>();
  readonly auditLogs = new MemoryTable<AuditLogRow>();
  readonly idempotencyKeys = new MemoryTable<IdempotencyKeyRow>();
  readonly outboxEvents = new MemoryTable<OutboxEventRow>();

  /**
   * Bộ đếm số thứ tự ca trong ngày, thay cho sequence của PostgreSQL.
   * Khóa: `YYYYMMDD` -> số ca đã tạo trong ngày đó.
   */
  readonly caseCodeCounters = new Map<string, number>();

  /** Dùng trong test để reset trạng thái giữa các case kiểm thử. */
  reset(): void {
    for (const value of Object.values(this)) {
      if (value instanceof MemoryTable) value.clear();
    }
    this.caseCodeCounters.clear();
  }
}
