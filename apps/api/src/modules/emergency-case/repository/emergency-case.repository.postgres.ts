import { CaseStatus } from '../../../contracts/generated/api-contract';
import type { PgExecutor } from '../../../persistence/postgres/pg-executor';
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

/**
 * Cài đặt PostgreSQL/PostGIS – driver chính thức (Rule 3.1).
 *
 * Cột `geography(Point,4326)` được đọc ra thành lat/lng bằng `ST_Y`/`ST_X` để
 * tầng trên không phải hiểu định dạng WKB của PostGIS.
 */

/** Các cột của `emergency_cases`, kèm giải mã toạ độ. */
const CASE_COLUMNS = `
  c.id, c.code, c.trigger_source, c.caller_user_id, c.device_id, c.service_area_id,
  c.active_operator_id, c.status, c.number_of_patients,
  ST_Y(c.first_location::geometry)  AS first_lat,
  ST_X(c.first_location::geometry)  AS first_lng,
  ST_Y(c.latest_location::geometry) AS latest_lat,
  ST_X(c.latest_location::geometry) AS latest_lng,
  c.latest_accuracy_meters, c.address_text, c.access_note, c.media_consent,
  c.emergency_profile_snapshot, c.accepted_at, c.closed_at,
  c.created_at, c.updated_at, c.created_by, c.updated_by
`;

interface RawCaseRow {
  id: string;
  code: string;
  trigger_source: string;
  caller_user_id: string | null;
  device_id: string | null;
  service_area_id: string | null;
  active_operator_id: string | null;
  status: CaseStatus;
  number_of_patients: number;
  first_lat: number | null;
  first_lng: number | null;
  latest_lat: number | null;
  latest_lng: number | null;
  latest_accuracy_meters: string | number | null;
  address_text: string | null;
  access_note: string | null;
  media_consent: boolean;
  emergency_profile_snapshot: Record<string, unknown> | null;
  accepted_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
}

function toPoint(lat: number | null, lng: number | null): GeoPoint | null {
  return lat === null || lng === null ? null : { lat, lng };
}

function toCaseRow(raw: RawCaseRow): EmergencyCaseRow {
  return {
    id: raw.id,
    code: raw.code,
    trigger_source: raw.trigger_source,
    caller_user_id: raw.caller_user_id,
    device_id: raw.device_id,
    service_area_id: raw.service_area_id,
    active_operator_id: raw.active_operator_id,
    status: raw.status,
    number_of_patients: raw.number_of_patients,
    first_location: toPoint(raw.first_lat, raw.first_lng),
    latest_location: toPoint(raw.latest_lat, raw.latest_lng),
    latest_accuracy_meters:
      raw.latest_accuracy_meters === null ? null : Number(raw.latest_accuracy_meters),
    address_text: raw.address_text,
    access_note: raw.access_note,
    media_consent: raw.media_consent,
    emergency_profile_snapshot: raw.emergency_profile_snapshot,
    accepted_at: raw.accepted_at,
    closed_at: raw.closed_at,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    created_by: raw.created_by,
    updated_by: raw.updated_by,
  };
}

export class PgEmergencyCaseRepository implements EmergencyCaseRepositoryPort {
  constructor(private readonly executor: PgExecutor) {}

  async create(tx: TxContext, input: CreateCaseInput): Promise<EmergencyCaseRow> {
    const datePart = caseCodeDatePart(input.occurredAt);

    // Advisory lock theo ngày: chỉ một transaction cấp số thứ tự cho ngày đó tại
    // một thời điểm, nên mã ca không trùng kể cả khi nhiều instance cùng chạy.
    // Khoá tự nhả khi transaction kết thúc (xact-scoped).
    await this.executor.query(tx, `SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `sos-case-code:${datePart}`,
    ]);

    const sequenceRow = await this.executor.queryOne<{ next_sequence: string }>(
      tx,
      `SELECT COALESCE(MAX(CAST(split_part(code, '-', 3) AS integer)), 0) + 1 AS next_sequence
         FROM emergency_cases
        WHERE code LIKE $1`,
      [`SOS-${datePart}-%`],
    );
    const code = buildCaseCode(input.occurredAt, Number(sequenceRow?.next_sequence ?? 1));

    const rows = await this.executor.query<RawCaseRow>(
      tx,
      `INSERT INTO emergency_cases (
         code, trigger_source, caller_user_id, device_id, service_area_id, status,
         number_of_patients, first_location, latest_location, latest_accuracy_meters,
         address_text, access_note, media_consent, emergency_profile_snapshot,
         created_by, updated_by
       ) VALUES (
         $1, $2, $3, $4, $5, $6::case_status,
         $7,
         CASE WHEN $8::double precision IS NULL THEN NULL
              ELSE ST_SetSRID(ST_MakePoint($9, $8), 4326)::geography END,
         CASE WHEN $8::double precision IS NULL THEN NULL
              ELSE ST_SetSRID(ST_MakePoint($9, $8), 4326)::geography END,
         $10, $11, $12, $13, $14::jsonb, $3, $3
       )
       RETURNING ${CASE_COLUMNS.replace(/c\./g, '')}`,
      [
        code,
        input.triggerSource,
        input.callerUserId,
        input.deviceId,
        input.serviceAreaId,
        CaseStatus.CREATED,
        input.numberOfPatients,
        input.location?.lat ?? null,
        input.location?.lng ?? null,
        input.accuracyMeters,
        input.addressText,
        input.accessNote,
        input.mediaConsent,
        input.emergencyProfileSnapshot ? JSON.stringify(input.emergencyProfileSnapshot) : null,
      ],
    );

    return toCaseRow(rows[0]);
  }

  async findById(id: string): Promise<EmergencyCaseRow | null> {
    const raw = await this.executor.queryOne<RawCaseRow>(
      undefined,
      `SELECT ${CASE_COLUMNS} FROM emergency_cases c WHERE c.id = $1`,
      [id],
    );
    return raw ? toCaseRow(raw) : null;
  }

  async findByCode(code: string): Promise<EmergencyCaseRow | null> {
    const raw = await this.executor.queryOne<RawCaseRow>(
      undefined,
      `SELECT ${CASE_COLUMNS} FROM emergency_cases c WHERE c.code = $1`,
      [code],
    );
    return raw ? toCaseRow(raw) : null;
  }

  async updateStatusIfCurrent(
    tx: TxContext,
    caseId: string,
    expectedStatus: CaseStatus,
    nextStatus: CaseStatus,
    actorUserId: string | null,
  ): Promise<EmergencyCaseRow | null> {
    // `WHERE status = expected` chính là kiểm tra optimistic concurrency: nếu ai
    // đó đã đổi trạng thái giữa lúc đọc và lúc ghi, câu này không khớp dòng nào.
    const raw = await this.executor.queryOne<RawCaseRow>(
      tx,
      `UPDATE emergency_cases
          SET status = $3::case_status,
              updated_by = $4,
              closed_at = CASE WHEN $3 IN ('CLOSED','CANCELLED','FALSE_ALARM')
                               THEN now() ELSE closed_at END
        WHERE id = $1 AND status = $2::case_status
        RETURNING ${CASE_COLUMNS.replace(/c\./g, '')}`,
      [caseId, expectedStatus, nextStatus, actorUserId],
    );
    return raw ? toCaseRow(raw) : null;
  }

  async acceptIfUnassigned(
    tx: TxContext,
    caseId: string,
    operatorUserId: string,
  ): Promise<EmergencyCaseRow | null> {
    // Hai điều kiện trong WHERE làm việc nhận ca trở thành thao tác atomic:
    // đúng một operator thắng, người còn lại nhận null -> 409 (TC-007).
    const raw = await this.executor.queryOne<RawCaseRow>(
      tx,
      `UPDATE emergency_cases
          SET status = $3::case_status,
              active_operator_id = $2,
              accepted_at = now(),
              updated_by = $2
        WHERE id = $1
          AND status = $4::case_status
          AND active_operator_id IS NULL
        RETURNING ${CASE_COLUMNS.replace(/c\./g, '')}`,
      [caseId, operatorUserId, CaseStatus.ACCEPTED, CaseStatus.QUEUED],
    );
    return raw ? toCaseRow(raw) : null;
  }

  async updateLatestLocation(
    tx: TxContext,
    caseId: string,
    location: GeoPoint,
    accuracyMeters: number | null,
    addressText: string | null,
    accessNote: string | null,
  ): Promise<void> {
    // COALESCE: mẫu vị trí mới không xoá mất chỉ dẫn tiếp cận đã nhập trước đó.
    await this.executor.query(
      tx,
      `UPDATE emergency_cases
          SET latest_location = ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography,
              latest_accuracy_meters = $4,
              address_text = COALESCE($5, address_text),
              access_note  = COALESCE($6, access_note)
        WHERE id = $1`,
      [caseId, location.lat, location.lng, accuracyMeters, addressText, accessNote],
    );
  }

  async listQueue(query: QueueQuery): Promise<EmergencyCaseRow[]> {
    const rows = await this.executor.query<RawCaseRow>(
      undefined,
      `SELECT ${CASE_COLUMNS}
         FROM emergency_cases c
        WHERE c.status = ANY($1::case_status[])
          AND ($2::uuid[] IS NULL OR array_length($2::uuid[], 1) IS NULL
               OR c.service_area_id = ANY($2::uuid[]))
        ORDER BY c.created_at ASC
        LIMIT $3`,
      [query.statuses, query.serviceAreaIds.length > 0 ? query.serviceAreaIds : null, query.limit],
    );
    return rows.map(toCaseRow);
  }

  async listByCaller(callerUserId: string, limit: number): Promise<EmergencyCaseRow[]> {
    const rows = await this.executor.query<RawCaseRow>(
      undefined,
      `SELECT ${CASE_COLUMNS}
         FROM emergency_cases c
        WHERE c.caller_user_id = $1
        ORDER BY c.created_at DESC
        LIMIT $2`,
      [callerUserId, limit],
    );
    return rows.map(toCaseRow);
  }

  async appendStatusHistory(
    tx: TxContext,
    input: {
      caseId: string;
      fromStatus: CaseStatus | null;
      toStatus: CaseStatus;
      reason: string | null;
      changedBy: string | null;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.executor.query(
      tx,
      `INSERT INTO case_status_history
         (case_id, from_status, to_status, reason, changed_by, metadata, created_by)
       VALUES ($1, $2::case_status, $3::case_status, $4, $5, $6::jsonb, $5)`,
      [
        input.caseId,
        input.fromStatus,
        input.toStatus,
        input.reason,
        input.changedBy,
        JSON.stringify(input.metadata),
      ],
    );
  }

  async listStatusHistory(caseId: string): Promise<CaseStatusHistoryRow[]> {
    return this.executor.query<CaseStatusHistoryRow>(
      undefined,
      `SELECT * FROM case_status_history WHERE case_id = $1 ORDER BY changed_at ASC`,
      [caseId],
    );
  }

  async addNote(
    tx: TxContext,
    input: { caseId: string; authorUserId: string | null; noteType: string; text: string },
  ): Promise<CaseNoteRow> {
    const rows = await this.executor.query<CaseNoteRow>(
      tx,
      `INSERT INTO case_notes (case_id, author_user_id, note_type, text, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $2, $2)
       RETURNING *`,
      [input.caseId, input.authorUserId, input.noteType, input.text],
    );
    return rows[0];
  }

  async listNotes(caseId: string): Promise<CaseNoteRow[]> {
    return this.executor.query<CaseNoteRow>(
      undefined,
      `SELECT * FROM case_notes WHERE case_id = $1 ORDER BY created_at ASC`,
      [caseId],
    );
  }

  async countByStatusBetween(from: Date, to: Date): Promise<Record<string, number>> {
    const rows = await this.executor.query<{ status: string; total: string }>(
      undefined,
      `SELECT status::text AS status, count(*)::text AS total
         FROM emergency_cases
        WHERE created_at >= $1 AND created_at <= $2
        GROUP BY status`,
      [from, to],
    );
    return Object.fromEntries(rows.map((row) => [row.status, Number.parseInt(row.total, 10)]));
  }

  async listCreatedBetween(from: Date, to: Date): Promise<EmergencyCaseRow[]> {
    const rows = await this.executor.query<RawCaseRow>(
      undefined,
      `SELECT ${CASE_COLUMNS}
         FROM emergency_cases c
        WHERE c.created_at >= $1 AND c.created_at <= $2
        ORDER BY c.created_at ASC`,
      [from, to],
    );
    return rows.map(toCaseRow);
  }
}
