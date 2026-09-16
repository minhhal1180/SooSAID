import { randomUUID } from 'node:crypto';
import { CaseStatus } from '../../../contracts/generated/api-contract';
import type { MemoryDb } from '../../../persistence/memory/memory-db';
import type {
  CaseNoteRow,
  CaseStatusHistoryRow,
  EmergencyCaseRow,
  GeoPoint,
} from '../../../persistence/rows';
import type { TxContext } from '../../../persistence/unit-of-work';
import { buildCaseCode, caseCodeDatePart } from '../entity/case-code';
import type {
  CreateCaseInput,
  EmergencyCaseRepositoryPort,
  QueueQuery,
} from './emergency-case.repository.port';

/** Trạng thái kết thúc – dùng để gán `closed_at`, khớp logic của driver postgres. */
const CLOSING_STATUSES: readonly CaseStatus[] = [
  CaseStatus.CLOSED,
  CaseStatus.CANCELLED,
  CaseStatus.FALSE_ALARM,
];

/** Cài đặt in-memory (ADR-004) – chỉ dùng local demo/test. */
export class MemoryEmergencyCaseRepository implements EmergencyCaseRepositoryPort {
  constructor(private readonly db: MemoryDb) {}

  async create(_tx: TxContext, input: CreateCaseInput): Promise<EmergencyCaseRow> {
    const datePart = caseCodeDatePart(input.occurredAt);
    const nextSequence = (this.db.caseCodeCounters.get(datePart) ?? 0) + 1;
    this.db.caseCodeCounters.set(datePart, nextSequence);

    const now = new Date();
    const row: EmergencyCaseRow = {
      id: randomUUID(),
      code: buildCaseCode(input.occurredAt, nextSequence),
      trigger_source: input.triggerSource,
      caller_user_id: input.callerUserId,
      device_id: input.deviceId,
      service_area_id: input.serviceAreaId,
      active_operator_id: null,
      status: CaseStatus.CREATED,
      number_of_patients: input.numberOfPatients,
      first_location: input.location,
      latest_location: input.location,
      latest_accuracy_meters: input.accuracyMeters,
      address_text: input.addressText,
      access_note: input.accessNote,
      media_consent: input.mediaConsent,
      emergency_profile_snapshot: input.emergencyProfileSnapshot,
      accepted_at: null,
      closed_at: null,
      created_at: now,
      updated_at: now,
      created_by: input.callerUserId,
      updated_by: input.callerUserId,
    };
    return this.db.emergencyCases.insert(row);
  }

  async findById(id: string): Promise<EmergencyCaseRow | null> {
    return this.db.emergencyCases.findById(id);
  }

  async findByCode(code: string): Promise<EmergencyCaseRow | null> {
    return this.db.emergencyCases.findOne((row) => row.code === code);
  }

  async updateStatusIfCurrent(
    _tx: TxContext,
    caseId: string,
    expectedStatus: CaseStatus,
    nextStatus: CaseStatus,
    actorUserId: string | null,
  ): Promise<EmergencyCaseRow | null> {
    return this.db.emergencyCases.updateWhere(
      caseId,
      (row) => row.status === expectedStatus,
      {
        status: nextStatus,
        updated_by: actorUserId,
        ...(CLOSING_STATUSES.includes(nextStatus) ? { closed_at: new Date() } : {}),
      },
    );
  }

  async acceptIfUnassigned(
    _tx: TxContext,
    caseId: string,
    operatorUserId: string,
  ): Promise<EmergencyCaseRow | null> {
    return this.db.emergencyCases.updateWhere(
      caseId,
      (row) => row.status === CaseStatus.QUEUED && row.active_operator_id === null,
      {
        status: CaseStatus.ACCEPTED,
        active_operator_id: operatorUserId,
        accepted_at: new Date(),
        updated_by: operatorUserId,
      },
    );
  }

  async updateLatestLocation(
    _tx: TxContext,
    caseId: string,
    location: GeoPoint,
    accuracyMeters: number | null,
    addressText: string | null,
    accessNote: string | null,
  ): Promise<void> {
    const existing = this.db.emergencyCases.findById(caseId);
    if (!existing) return;
    this.db.emergencyCases.update(caseId, {
      latest_location: location,
      latest_accuracy_meters: accuracyMeters,
      // Giữ nguyên giá trị cũ khi mẫu mới không kèm thông tin (giống COALESCE).
      address_text: addressText ?? existing.address_text,
      access_note: accessNote ?? existing.access_note,
    });
  }

  async listQueue(query: QueueQuery): Promise<EmergencyCaseRow[]> {
    return this.db.emergencyCases
      .findMany((row) => {
        if (!query.statuses.includes(row.status)) return false;
        if (query.serviceAreaIds.length === 0) return true;
        return row.service_area_id !== null && query.serviceAreaIds.includes(row.service_area_id);
      })
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .slice(0, query.limit);
  }

  async listByCaller(callerUserId: string, limit: number): Promise<EmergencyCaseRow[]> {
    return this.db.emergencyCases
      .findMany((row) => row.caller_user_id === callerUserId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, limit);
  }

  async appendStatusHistory(
    _tx: TxContext,
    input: {
      caseId: string;
      fromStatus: CaseStatus | null;
      toStatus: CaseStatus;
      reason: string | null;
      changedBy: string | null;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    const now = new Date();
    this.db.caseStatusHistory.insert({
      id: randomUUID(),
      case_id: input.caseId,
      from_status: input.fromStatus,
      to_status: input.toStatus,
      reason: input.reason,
      changed_by: input.changedBy,
      changed_at: now,
      metadata: input.metadata,
      created_at: now,
      updated_at: now,
      created_by: input.changedBy,
      updated_by: null,
    } satisfies CaseStatusHistoryRow);
  }

  async listStatusHistory(caseId: string): Promise<CaseStatusHistoryRow[]> {
    return this.db.caseStatusHistory
      .findMany((row) => row.case_id === caseId)
      .sort((a, b) => a.changed_at.getTime() - b.changed_at.getTime());
  }

  async addNote(
    _tx: TxContext,
    input: { caseId: string; authorUserId: string | null; noteType: string; text: string },
  ): Promise<CaseNoteRow> {
    const now = new Date();
    return this.db.caseNotes.insert({
      id: randomUUID(),
      case_id: input.caseId,
      author_user_id: input.authorUserId,
      note_type: input.noteType,
      text: input.text,
      created_at: now,
      updated_at: now,
      created_by: input.authorUserId,
      updated_by: input.authorUserId,
    } satisfies CaseNoteRow);
  }

  async listNotes(caseId: string): Promise<CaseNoteRow[]> {
    return this.db.caseNotes
      .findMany((row) => row.case_id === caseId)
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  }

  async countByStatusBetween(from: Date, to: Date): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const row of this.db.emergencyCases.findMany(
      (candidate) => candidate.created_at >= from && candidate.created_at <= to,
    )) {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
    }
    return counts;
  }

  async listCreatedBetween(from: Date, to: Date): Promise<EmergencyCaseRow[]> {
    return this.db.emergencyCases
      .findMany((row) => row.created_at >= from && row.created_at <= to)
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  }
}
