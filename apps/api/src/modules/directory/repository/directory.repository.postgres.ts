import type { PgExecutor } from '../../../persistence/postgres/pg-executor';
import type {
  AmbulanceUnitRow,
  GeoPoint,
  LocalResourceRow,
  MedicalFacilityRow,
  ResponderRow,
  ServiceAreaRow,
} from '../../../persistence/rows';
import {
  AMBULANCE_AVAILABLE_STATUS,
  RESPONDER_VERIFIED_STATUS,
  type DirectoryRepositoryPort,
  type NearbyOptions,
  type WithDistance,
} from './directory.repository.port';

/**
 * Cài đặt PostGIS. `ST_DWithin` trên kiểu `geography` tính trên ellipsoid nên
 * khoảng cách đúng theo mét thật, không phải độ.
 */
export class PgDirectoryRepository implements DirectoryRepositoryPort {
  readonly spatialAccuracy = 'exact' as const;

  constructor(private readonly executor: PgExecutor) {}

  async resolveServiceArea(point: GeoPoint): Promise<ServiceAreaRow | null> {
    // Một điểm có thể nằm trong nhiều vùng lồng nhau (trường nằm trong phường).
    // `routing_priority` nhỏ hơn = ưu tiên cao hơn, nên vùng cụ thể nhất thắng.
    const row = await this.executor.queryOne<ServiceAreaRow>(
      undefined,
      `SELECT id, code, name, NULL::jsonb AS bbox, active, routing_priority,
              created_at, updated_at, created_by, updated_by
         FROM service_areas
        WHERE active = true
          AND geom IS NOT NULL
          AND ST_Contains(geom, ST_SetSRID(ST_MakePoint($2, $1), 4326))
        ORDER BY routing_priority ASC
        LIMIT 1`,
      [point.lat, point.lng],
    );
    return row;
  }

  async findNearbyFacilities(options: NearbyOptions): Promise<WithDistance<MedicalFacilityRow>[]> {
    const rows = await this.executor.query<RawFacilityRow>(
      undefined,
      `SELECT f.id, f.code, f.name, f.facility_type, f.phone, f.address,
              ST_Y(f.location::geometry) AS lat, ST_X(f.location::geometry) AS lng,
              f.capabilities, f.service_area_id, f.active,
              f.created_at, f.updated_at, f.created_by, f.updated_by,
              ST_Distance(f.location, $3::geography) AS distance_meters
         FROM medical_facilities f
        WHERE f.active = true
          AND ST_DWithin(f.location, $3::geography, $4)
        ORDER BY distance_meters ASC
        LIMIT $5`,
      [
        options.point.lat,
        options.point.lng,
        `SRID=4326;POINT(${options.point.lng} ${options.point.lat})`,
        options.radiusMeters,
        options.limit,
      ],
    );
    return rows.map((row) => ({
      item: toFacilityRow(row),
      distanceMeters: Number(row.distance_meters),
    }));
  }

  async findNearbyResources(
    options: NearbyOptions & { resourceType?: string },
  ): Promise<WithDistance<LocalResourceRow>[]> {
    const rows = await this.executor.query<RawResourceRow>(
      undefined,
      `SELECT r.id, r.resource_type, r.name,
              ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lng,
              r.address, r.access_instruction, r.organization_id, r.metadata, r.active,
              r.created_at, r.updated_at, r.created_by, r.updated_by,
              ST_Distance(r.location, $1::geography) AS distance_meters
         FROM local_resources r
        WHERE r.active = true
          AND ST_DWithin(r.location, $1::geography, $2)
          AND ($3::text IS NULL OR r.resource_type = $3)
        ORDER BY distance_meters ASC
        LIMIT $4`,
      [
        `SRID=4326;POINT(${options.point.lng} ${options.point.lat})`,
        options.radiusMeters,
        options.resourceType ?? null,
        options.limit,
      ],
    );
    return rows.map((row) => ({
      item: toResourceRow(row),
      distanceMeters: Number(row.distance_meters),
    }));
  }

  async findAmbulanceUnitById(id: string): Promise<AmbulanceUnitRow | null> {
    const row = await this.executor.queryOne<RawAmbulanceRow>(
      undefined,
      `SELECT a.id, a.code, a.display_name, a.status,
              ST_Y(a.current_location::geometry) AS lat,
              ST_X(a.current_location::geometry) AS lng,
              a.service_area_id, a.last_location_at, a.capabilities,
              a.created_at, a.updated_at, a.created_by, a.updated_by
         FROM ambulance_units a WHERE a.id = $1`,
      [id],
    );
    return row ? toAmbulanceRow(row) : null;
  }

  async findVerifiedAvailableResponderById(id: string): Promise<ResponderRow | null> {
    // Điều kiện xác thực + sẵn sàng nằm NGAY trong truy vấn, không kiểm tra ở
    // tầng trên: một responder chưa xác thực phải không tồn tại đối với dispatch
    // (TC-013), chứ không phải "tìm thấy rồi mới từ chối".
    const row = await this.executor.queryOne<RawResponderRow>(
      undefined,
      `SELECT r.id, r.user_id, r.organization_id, r.certification_status, r.available,
              ST_Y(r.current_location::geometry) AS lat,
              ST_X(r.current_location::geometry) AS lng,
              r.last_location_at, r.skills,
              r.created_at, r.updated_at, r.created_by, r.updated_by
         FROM responders r
        WHERE r.id = $1 AND r.certification_status = $2 AND r.available = true`,
      [id, RESPONDER_VERIFIED_STATUS],
    );
    return row ? toResponderRow(row) : null;
  }

  async listAvailableAmbulanceUnits(serviceAreaId: string | null): Promise<AmbulanceUnitRow[]> {
    const rows = await this.executor.query<RawAmbulanceRow>(
      undefined,
      `SELECT a.id, a.code, a.display_name, a.status,
              ST_Y(a.current_location::geometry) AS lat,
              ST_X(a.current_location::geometry) AS lng,
              a.service_area_id, a.last_location_at, a.capabilities,
              a.created_at, a.updated_at, a.created_by, a.updated_by
         FROM ambulance_units a
        WHERE a.status = $1
          AND ($2::uuid IS NULL OR a.service_area_id = $2)
        ORDER BY a.code ASC`,
      [AMBULANCE_AVAILABLE_STATUS, serviceAreaId],
    );
    return rows.map(toAmbulanceRow);
  }

  async listVerifiedAvailableResponders(
    options: NearbyOptions,
  ): Promise<WithDistance<ResponderRow>[]> {
    const rows = await this.executor.query<RawResponderRow & { distance_meters: string }>(
      undefined,
      `SELECT r.id, r.user_id, r.organization_id, r.certification_status, r.available,
              ST_Y(r.current_location::geometry) AS lat,
              ST_X(r.current_location::geometry) AS lng,
              r.last_location_at, r.skills,
              r.created_at, r.updated_at, r.created_by, r.updated_by,
              ST_Distance(r.current_location, $1::geography) AS distance_meters
         FROM responders r
        WHERE r.certification_status = $2
          AND r.available = true
          AND r.current_location IS NOT NULL
          AND ST_DWithin(r.current_location, $1::geography, $3)
        ORDER BY distance_meters ASC
        LIMIT $4`,
      [
        `SRID=4326;POINT(${options.point.lng} ${options.point.lat})`,
        RESPONDER_VERIFIED_STATUS,
        options.radiusMeters,
        options.limit,
      ],
    );
    return rows.map((row) => ({
      item: toResponderRow(row),
      distanceMeters: Number(row.distance_meters),
    }));
  }
}

// ---------------------------------------------------------------------------
// Mapper: PostGIS trả toạ độ dưới dạng hai cột lat/lng rời, tầng trên dùng
// `GeoPoint`. Mỗi bảng có một mapper tường minh thay vì một helper generic —
// helper generic ở đây chỉ làm kiểu dữ liệu mờ đi mà không tiết kiệm được gì.
// ---------------------------------------------------------------------------

type WithLatLng<T> = Omit<T, 'location'> & { lat: number | string; lng: number | string };
type WithNullableLatLng<T> = Omit<T, 'current_location'> & {
  lat: number | string | null;
  lng: number | string | null;
};

type RawFacilityRow = WithLatLng<MedicalFacilityRow> & { distance_meters: string };
type RawResourceRow = WithLatLng<LocalResourceRow> & { distance_meters: string };
type RawAmbulanceRow = WithNullableLatLng<AmbulanceUnitRow>;
type RawResponderRow = WithNullableLatLng<ResponderRow>;

function toPoint(lat: number | string, lng: number | string): GeoPoint {
  return { lat: Number(lat), lng: Number(lng) };
}

function toNullablePoint(
  lat: number | string | null,
  lng: number | string | null,
): GeoPoint | null {
  return lat === null || lng === null ? null : toPoint(lat, lng);
}

function toFacilityRow(raw: RawFacilityRow): MedicalFacilityRow {
  const { lat, lng, distance_meters: _distance, ...rest } = raw;
  return { ...rest, location: toPoint(lat, lng) };
}

function toResourceRow(raw: RawResourceRow): LocalResourceRow {
  const { lat, lng, distance_meters: _distance, ...rest } = raw;
  return { ...rest, location: toPoint(lat, lng) };
}

function toAmbulanceRow(raw: RawAmbulanceRow): AmbulanceUnitRow {
  const { lat, lng, ...rest } = raw;
  return { ...rest, current_location: toNullablePoint(lat, lng) };
}

function toResponderRow(raw: RawResponderRow & { distance_meters?: string }): ResponderRow {
  const { lat, lng, distance_meters: _distance, ...rest } = raw;
  return { ...rest, current_location: toNullablePoint(lat, lng) };
}
