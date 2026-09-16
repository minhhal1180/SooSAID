import 'package:flutter/material.dart';

/// Port hiển thị bản đồ (M07).
///
/// Cùng lý do với video: nhà cung cấp bản đồ có thể đổi (OSM → Mapbox →
/// Google), và TDD §11.2 yêu cầu đặt map sau adapter. Màn hình chỉ biết
/// `MapViewAdapter`, không biết `flutter_map` hay bất kỳ SDK nào.
///
/// TDD §12 – quy tắc quan trọng nhất: **bản đồ lỗi KHÔNG được chặn luồng ca**.
/// Khi không tải được tile, adapter phải trả về một view hiển thị toạ độ, địa
/// chỉ và chỉ dẫn tiếp cận bằng chữ.
class MapMarker {
  const MapMarker({
    required this.lat,
    required this.lng,
    required this.label,
    required this.kind,
  });

  final double lat;
  final double lng;
  final String label;
  final MapMarkerKind kind;
}

enum MapMarkerKind {
  /// Vị trí người gặp nạn — luôn nổi bật nhất.
  incident,

  /// Điểm hỗ trợ tại chỗ: phòng y tế, AED, lối xe vào.
  supportResource,

  /// Cơ sở y tế.
  facility,
}

abstract class MapViewAdapter {
  String get providerName;

  /// Dựng widget bản đồ.
  ///
  /// `accuracyMeters` vẽ thành vòng tròn sai số — nhân viên y tế và người dùng
  /// cần thấy "vị trí này chắc chắn tới đâu", không chỉ một chấm tròn giả vờ
  /// chính xác tuyệt đối (FR-003, TC-005).
  Widget build({
    required BuildContext context,
    required double centerLat,
    required double centerLng,
    required List<MapMarker> markers,
    double? accuracyMeters,
  });
}
