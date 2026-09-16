import type { GeoPoint } from '../../persistence/rows';

/**
 * Tiện ích không gian dùng cho driver `memory` (ADR-004).
 *
 * Driver `postgres` KHÔNG dùng các hàm này — nó dùng `ST_DWithin`/`ST_Distance`
 * của PostGIS, chính xác hơn vì tính trên ellipsoid. Kết quả từ driver `memory`
 * luôn được gắn nhãn `spatialAccuracy: 'approximate'` để không ai nhầm hai nguồn.
 */

/** Bán kính trung bình Trái Đất (m) – hằng số của mô hình cầu Haversine. */
const EARTH_RADIUS_METERS = 6_371_008.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Khoảng cách great-circle giữa hai điểm, đơn vị mét (xấp xỉ, mô hình cầu). */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const latA = toRadians(a.lat);
  const latB = toRadians(b.lat);

  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Toạ độ hợp lệ theo WGS84. Toạ độ sai làm ca cấp cứu được định tuyến nhầm nơi. */
export function isValidCoordinate(point: GeoPoint): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lng >= -180 &&
    point.lng <= 180
  );
}

export interface BoundingBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** Kiểm tra điểm nằm trong hộp bao – phép xấp xỉ "nằm trong service area". */
export function isInsideBoundingBox(point: GeoPoint, box: BoundingBox): boolean {
  return (
    point.lat >= box.minLat &&
    point.lat <= box.maxLat &&
    point.lng >= box.minLng &&
    point.lng <= box.maxLng
  );
}
