import { Inject, Injectable } from '@nestjs/common';
import type { NearbyResult } from '../../../contracts/generated/api-contract';
import { DomainErrors } from '../../../common/errors/domain-error';
import { isValidCoordinate } from '../../../common/geo/geo';
import type { GeoPoint, ServiceAreaRow } from '../../../persistence/rows';
import {
  DIRECTORY_REPOSITORY,
  type DirectoryRepositoryPort,
} from '../repository/directory.repository.port';

/**
 * Tra cứu danh bạ vận hành (SOS-023).
 *
 * TDD §11.2: cơ sở "gần nhất" không mặc định là "phù hợp nhất". Service trả
 * `routingScore` và lý do riêng, operator có quyền override. Ở MVP,
 * `routingScore` chỉ dựa trên khoảng cách và `routing_priority` đã cấu hình —
 * KHÔNG suy luận năng lực y khoa (Rule 1.2: không quyết định thay bác sĩ).
 */

const DEFAULT_RADIUS_METERS = 10_000;
const MAX_RADIUS_METERS = 50_000;
const DEFAULT_RESULT_LIMIT = 20;

export interface NearbyFacilityView {
  id: string;
  code: string | null;
  name: string;
  facilityType: string;
  phone: string | null;
  address: string | null;
  location: GeoPoint;
  distanceMeters: number;
  capabilities: Record<string, unknown>;
}

export interface NearbyResourceView {
  id: string;
  resourceType: string;
  name: string;
  location: GeoPoint;
  address: string | null;
  accessInstruction: string | null;
  distanceMeters: number;
}

@Injectable()
export class DirectoryService {
  constructor(
    @Inject(DIRECTORY_REPOSITORY) private readonly repository: DirectoryRepositoryPort,
  ) {}

  /**
   * Xác định service area cho một toạ độ. Trả `null` khi nằm ngoài mọi vùng đã
   * cấu hình — ca vẫn được tạo, chỉ là hàng đợi phải do tổng đài trung tâm xử lý
   * (xem `CaseAccessPolicy.isInServiceAreaScope`).
   */
  async resolveServiceArea(point: GeoPoint | null): Promise<ServiceAreaRow | null> {
    if (!point || !isValidCoordinate(point)) return null;
    return this.repository.resolveServiceArea(point);
  }

  async findNearbyFacilities(
    point: GeoPoint,
    radiusMeters?: number,
  ): Promise<NearbyResult<NearbyFacilityView>> {
    this.assertValidPoint(point);
    const results = await this.repository.findNearbyFacilities({
      point,
      radiusMeters: this.clampRadius(radiusMeters),
      limit: DEFAULT_RESULT_LIMIT,
    });

    return {
      items: results.map(({ item, distanceMeters }) => ({
        id: item.id,
        code: item.code,
        name: item.name,
        facilityType: item.facility_type,
        phone: item.phone,
        address: item.address,
        location: item.location,
        distanceMeters: Math.round(distanceMeters),
        capabilities: item.capabilities,
      })),
      spatialAccuracy: this.repository.spatialAccuracy,
    };
  }

  async findNearbyResources(
    point: GeoPoint,
    options: { radiusMeters?: number; resourceType?: string } = {},
  ): Promise<NearbyResult<NearbyResourceView>> {
    this.assertValidPoint(point);
    const results = await this.repository.findNearbyResources({
      point,
      radiusMeters: this.clampRadius(options.radiusMeters),
      limit: DEFAULT_RESULT_LIMIT,
      resourceType: options.resourceType,
    });

    return {
      items: results.map(({ item, distanceMeters }) => ({
        id: item.id,
        resourceType: item.resource_type,
        name: item.name,
        location: item.location,
        address: item.address,
        // Chỉ dẫn tiếp cận (cổng nào, gọi ai mở barrier) là giá trị lớn nhất của
        // danh bạ tại chỗ đối với kíp xe.
        accessInstruction: item.access_instruction,
        distanceMeters: Math.round(distanceMeters),
      })),
      spatialAccuracy: this.repository.spatialAccuracy,
    };
  }

  async findAmbulanceUnitById(id: string) {
    return this.repository.findAmbulanceUnitById(id);
  }

  async findVerifiedAvailableResponderById(id: string) {
    return this.repository.findVerifiedAvailableResponderById(id);
  }

  async listDispatchCandidates(point: GeoPoint | null, serviceAreaId: string | null) {
    const ambulanceUnits = await this.repository.listAvailableAmbulanceUnits(serviceAreaId);
    const responders =
      point && isValidCoordinate(point)
        ? await this.repository.listVerifiedAvailableResponders({
            point,
            radiusMeters: this.clampRadius(),
            limit: DEFAULT_RESULT_LIMIT,
          })
        : [];

    return {
      ambulanceUnits: ambulanceUnits.map((unit) => ({
        id: unit.id,
        code: unit.code,
        displayName: unit.display_name,
        status: unit.status,
        location: unit.current_location,
        lastLocationAt: unit.last_location_at?.toISOString() ?? null,
      })),
      responders: responders.map(({ item, distanceMeters }) => ({
        id: item.id,
        userId: item.user_id,
        skills: item.skills,
        distanceMeters: Math.round(distanceMeters),
      })),
      spatialAccuracy: this.repository.spatialAccuracy,
    };
  }

  private clampRadius(radiusMeters?: number): number {
    if (!radiusMeters || radiusMeters <= 0) return DEFAULT_RADIUS_METERS;
    return Math.min(radiusMeters, MAX_RADIUS_METERS);
  }

  private assertValidPoint(point: GeoPoint): void {
    if (!isValidCoordinate(point)) {
      throw DomainErrors.validation('Toạ độ không hợp lệ.', [{ field: 'lat/lng' }]);
    }
  }
}
