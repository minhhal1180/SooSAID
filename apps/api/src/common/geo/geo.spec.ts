import { haversineMeters, isInsideBoundingBox, isValidCoordinate } from './geo';

describe('geo (driver memory – ADR-004)', () => {
  describe('isValidCoordinate', () => {
    it('chấp nhận toạ độ WGS84 hợp lệ', () => {
      expect(isValidCoordinate({ lat: 21.02, lng: 105.84 })).toBe(true);
      expect(isValidCoordinate({ lat: 0, lng: 0 })).toBe(true);
    });

    it('từ chối toạ độ ngoài miền – toạ độ sai làm định tuyến ca sai nơi', () => {
      expect(isValidCoordinate({ lat: 91, lng: 0 })).toBe(false);
      expect(isValidCoordinate({ lat: 0, lng: 181 })).toBe(false);
      expect(isValidCoordinate({ lat: Number.NaN, lng: 105 })).toBe(false);
    });
  });

  describe('haversineMeters', () => {
    it('khoảng cách tới chính nó bằng 0', () => {
      expect(haversineMeters({ lat: 21.02, lng: 105.84 }, { lat: 21.02, lng: 105.84 })).toBe(0);
    });

    it('1 độ vĩ tuyến ≈ 111 km (sai số dưới 1%)', () => {
      const distance = haversineMeters({ lat: 21, lng: 105 }, { lat: 22, lng: 105 });
      expect(distance).toBeGreaterThan(110_000);
      expect(distance).toBeLessThan(112_000);
    });

    it('đối xứng', () => {
      const a = { lat: 21.02, lng: 105.84 };
      const b = { lat: 21.025, lng: 105.846 };
      expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
    });

    it('phân biệt được khoảng cách ở quy mô khuôn viên trường', () => {
      // Hai điểm trong seed: phòng y tế và AED.
      const distance = haversineMeters(
        { lat: 21.021, lng: 105.841 },
        { lat: 21.0218, lng: 105.8425 },
      );
      expect(distance).toBeGreaterThan(100);
      expect(distance).toBeLessThan(300);
    });
  });

  describe('isInsideBoundingBox', () => {
    const box = { minLat: 21.015, minLng: 105.835, maxLat: 21.028, maxLng: 105.848 };

    it('điểm bên trong', () => {
      expect(isInsideBoundingBox({ lat: 21.02, lng: 105.84 }, box)).toBe(true);
    });

    it('điểm nằm đúng trên biên vẫn tính là bên trong', () => {
      expect(isInsideBoundingBox({ lat: 21.015, lng: 105.835 }, box)).toBe(true);
    });

    it('điểm bên ngoài', () => {
      expect(isInsideBoundingBox({ lat: 21.05, lng: 105.84 }, box)).toBe(false);
    });
  });
});
