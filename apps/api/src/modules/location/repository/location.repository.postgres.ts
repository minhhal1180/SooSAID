import type { PgExecutor } from '../../../persistence/postgres/pg-executor';
import type { CaseLocationRow } from '../../../persistence/rows';
import type { TxContext } from '../../../persistence/unit-of-work';
import type {
  AppendLocationInput,
  LocationRepositoryPort,
} from './location.repository.port';

const LOCATION_COLUMNS = `
  id, case_id,
  ST_Y(location::geometry) AS lat,
  ST_X(location::geometry) AS lng,
  accuracy_meters, altitude_meters, address_text, access_note, source,
  captured_at, received_at, created_at, updated_at, created_by, updated_by
`;

interface RawLocationRow {
  id: string;
  case_id: string;
  lat: number;
  lng: number;
  accuracy_meters: string | number | null;
  altitude_meters: string | number | null;
  address_text: string | null;
  access_note: string | null;
  source: string;
  captured_at: Date;
  received_at: Date;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
}

function toRow(raw: RawLocationRow): CaseLocationRow {
  return {
    id: String(raw.id),
    case_id: raw.case_id,
    location: { lat: Number(raw.lat), lng: Number(raw.lng) },
    accuracy_meters: raw.accuracy_meters === null ? null : Number(raw.accuracy_meters),
    altitude_meters: raw.altitude_meters === null ? null : Number(raw.altitude_meters),
    address_text: raw.address_text,
    access_note: raw.access_note,
    source: raw.source,
    captured_at: raw.captured_at,
    received_at: raw.received_at,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    created_by: raw.created_by,
    updated_by: raw.updated_by,
  };
}

export class PgLocationRepository implements LocationRepositoryPort {
  constructor(private readonly executor: PgExecutor) {}

  async append(tx: TxContext, input: AppendLocationInput): Promise<CaseLocationRow> {
    const rows = await this.executor.query<RawLocationRow>(
      tx,
      `INSERT INTO case_locations
         (case_id, location, accuracy_meters, altitude_meters, address_text, access_note,
          source, captured_at, created_by)
       VALUES ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography,
               $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${LOCATION_COLUMNS}`,
      [
        input.caseId,
        input.location.lat,
        input.location.lng,
        input.accuracyMeters,
        input.altitudeMeters,
        input.addressText,
        input.accessNote,
        input.source,
        input.capturedAt,
        input.createdBy,
      ],
    );
    return toRow(rows[0]);
  }

  async listByCase(caseId: string, limit: number): Promise<CaseLocationRow[]> {
    const rows = await this.executor.query<RawLocationRow>(
      undefined,
      `SELECT ${LOCATION_COLUMNS} FROM case_locations
        WHERE case_id = $1
        ORDER BY captured_at DESC
        LIMIT $2`,
      [caseId, limit],
    );
    return rows.map(toRow);
  }

  async latestByCase(caseId: string): Promise<CaseLocationRow | null> {
    const raw = await this.executor.queryOne<RawLocationRow>(
      undefined,
      `SELECT ${LOCATION_COLUMNS} FROM case_locations
        WHERE case_id = $1
        ORDER BY captured_at DESC
        LIMIT 1`,
      [caseId],
    );
    return raw ? toRow(raw) : null;
  }
}
