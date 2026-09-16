import type {
  AmbulanceUnitRow,
  GeoPoint,
  LocalResourceRow,
  MedicalFacilityRow,
  ResponderRow,
  ServiceAreaRow,
} from '../../../persistence/rows';

/**
 * Danh bạ vận hành: service area, cơ sở y tế, điểm hỗ trợ tại chỗ, kíp xe,
 * người hỗ trợ (SOS-023, SOS-026).
 *
 * TDD §11.2: "gần nhất" KHÔNG mặc định là "phù hợp nhất". Repository trả khoảng
 * cách và dữ liệu thô; việc xếp hạng do service làm và operator có quyền override.
 */

export interface NearbyOptions {
  readonly point: GeoPoint;
  readonly radiusMeters: number;
  readonly limit: number;
}

export interface WithDistance<T> {
  readonly item: T;
  readonly distanceMeters: number;
}

export interface DirectoryRepositoryPort {
  /** `exact` với PostGIS, `approximate` với driver memory (ADR-004). */
  readonly spatialAccuracy: 'exact' | 'approximate';

  /** Service area chứa toạ độ; null nếu ngoài mọi vùng đã cấu hình. */
  resolveServiceArea(point: GeoPoint): Promise<ServiceAreaRow | null>;

  findNearbyFacilities(options: NearbyOptions): Promise<WithDistance<MedicalFacilityRow>[]>;

  findNearbyResources(
    options: NearbyOptions & { resourceType?: string },
  ): Promise<WithDistance<LocalResourceRow>[]>;

  findAmbulanceUnitById(id: string): Promise<AmbulanceUnitRow | null>;

  /** Chỉ responder đã xác thực VÀ đang sẵn sàng (TC-013). */
  findVerifiedAvailableResponderById(id: string): Promise<ResponderRow | null>;

  listAvailableAmbulanceUnits(serviceAreaId: string | null): Promise<AmbulanceUnitRow[]>;

  listVerifiedAvailableResponders(options: NearbyOptions): Promise<WithDistance<ResponderRow>[]>;
}

export const DIRECTORY_REPOSITORY = Symbol('DIRECTORY_REPOSITORY');

/** Trạng thái xác thực bắt buộc để một người hỗ trợ được điều động (TC-013). */
export const RESPONDER_VERIFIED_STATUS = 'VERIFIED';
/** Trạng thái kíp xe sẵn sàng nhận nhiệm vụ. */
export const AMBULANCE_AVAILABLE_STATUS = 'AVAILABLE';
