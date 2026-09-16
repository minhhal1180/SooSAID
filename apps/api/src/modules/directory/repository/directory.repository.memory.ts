import { haversineMeters, isInsideBoundingBox } from '../../../common/geo/geo';
import type { MemoryDb } from '../../../persistence/memory/memory-db';
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
 * Cài đặt in-memory (ADR-004).
 *
 * Khác biệt quan trọng so với PostGIS, đã được khai báo qua `spatialAccuracy`:
 *  - Khoảng cách tính bằng Haversine (mô hình cầu), sai số ~0.3% so với ellipsoid.
 *  - Service area khớp bằng **hộp bao**, không phải hình đa giác thật.
 */
export class MemoryDirectoryRepository implements DirectoryRepositoryPort {
  readonly spatialAccuracy = 'approximate' as const;

  constructor(private readonly db: MemoryDb) {}

  async resolveServiceArea(point: GeoPoint): Promise<ServiceAreaRow | null> {
    const matches = this.db.serviceAreas
      .findMany((row) => row.active && row.bbox !== null && isInsideBoundingBox(point, row.bbox))
      .sort((a, b) => a.routing_priority - b.routing_priority);
    return matches[0] ?? null;
  }

  async findNearbyFacilities(options: NearbyOptions): Promise<WithDistance<MedicalFacilityRow>[]> {
    return rankByDistance(
      this.db.medicalFacilities.findMany((row) => row.active),
      (row) => row.location,
      options,
    );
  }

  async findNearbyResources(
    options: NearbyOptions & { resourceType?: string },
  ): Promise<WithDistance<LocalResourceRow>[]> {
    return rankByDistance(
      this.db.localResources.findMany(
        (row) => row.active && (!options.resourceType || row.resource_type === options.resourceType),
      ),
      (row) => row.location,
      options,
    );
  }

  async findAmbulanceUnitById(id: string): Promise<AmbulanceUnitRow | null> {
    return this.db.ambulanceUnits.findById(id);
  }

  async findVerifiedAvailableResponderById(id: string): Promise<ResponderRow | null> {
    const row = this.db.responders.findById(id);
    if (!row) return null;
    // Cùng ngữ nghĩa với driver postgres: chưa xác thực/không sẵn sàng = không tồn tại.
    if (row.certification_status !== RESPONDER_VERIFIED_STATUS || !row.available) return null;
    return row;
  }

  async listAvailableAmbulanceUnits(serviceAreaId: string | null): Promise<AmbulanceUnitRow[]> {
    return this.db.ambulanceUnits
      .findMany(
        (row) =>
          row.status === AMBULANCE_AVAILABLE_STATUS &&
          (serviceAreaId === null || row.service_area_id === serviceAreaId),
      )
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async listVerifiedAvailableResponders(
    options: NearbyOptions,
  ): Promise<WithDistance<ResponderRow>[]> {
    const candidates = this.db.responders.findMany(
      (row) =>
        row.certification_status === RESPONDER_VERIFIED_STATUS &&
        row.available &&
        row.current_location !== null,
    );
    return rankByDistance(candidates, (row) => row.current_location as GeoPoint, options);
  }
}

/** Lọc theo bán kính rồi xếp theo khoảng cách tăng dần. */
function rankByDistance<T>(
  rows: T[],
  locationOf: (row: T) => GeoPoint,
  options: NearbyOptions,
): WithDistance<T>[] {
  return rows
    .map((row) => ({
      item: row,
      distanceMeters: haversineMeters(options.point, locationOf(row)),
    }))
    .filter((entry) => entry.distanceMeters <= options.radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, options.limit);
}
