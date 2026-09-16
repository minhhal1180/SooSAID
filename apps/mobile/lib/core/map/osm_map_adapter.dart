import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../config.dart';
import 'map_view_adapter.dart';

/// Bản đồ OpenStreetMap.
///
/// **File DUY NHẤT được import `flutter_map`** (xem `MapViewAdapter`).
///
/// Chọn OSM cho Pilot vì không cần API key và không phát sinh chi phí theo lượt
/// xem — phù hợp giai đoạn thử nghiệm. Khi triển khai diện rộng, cân nhắc nhà
/// cung cấp có SLA và thêm một adapter mới, không sửa file này.
///
/// Lưu ý tuân thủ: OSM yêu cầu ghi nguồn và khai báo `userAgentPackageName`.
class OsmMapViewAdapter implements MapViewAdapter {
  const OsmMapViewAdapter();

  @override
  String get providerName => 'openstreetmap';

  /// Mức zoom mặc định: đủ gần để thấy từng toà nhà trong khuôn viên.
  static const double _defaultZoom = 17;

  @override
  Widget build({
    required BuildContext context,
    required double centerLat,
    required double centerLng,
    required List<MapMarker> markers,
    double? accuracyMeters,
  }) {
    final center = LatLng(centerLat, centerLng);
    final scheme = Theme.of(context).colorScheme;

    return FlutterMap(
      options: MapOptions(
        initialCenter: center,
        initialZoom: _defaultZoom,
        // Tắt xoay: người đang hoảng loạn dễ vô tình xoay bản đồ và mất phương
        // hướng, trong khi xoay không mang lại giá trị nào ở đây.
        interactionOptions: const InteractionOptions(
          flags: InteractiveFlag.pinchZoom | InteractiveFlag.drag,
        ),
      ),
      children: <Widget>[
        TileLayer(
          urlTemplate: AppConfig.osmTileUrlTemplate,
          userAgentPackageName: AppConfig.osmUserAgent,
          // Tile lỗi hiển thị ô xám thay vì làm hỏng cả màn hình.
          errorTileCallback: (_, __, ___) {},
        ),

        if (accuracyMeters != null && accuracyMeters > 0)
          CircleLayer(
            circles: <CircleMarker>[
              CircleMarker(
                point: center,
                radius: accuracyMeters,
                useRadiusInMeter: true,
                color: scheme.error.withValues(alpha: 0.12),
                borderColor: scheme.error.withValues(alpha: 0.45),
                borderStrokeWidth: 1.5,
              ),
            ],
          ),

        MarkerLayer(
          markers: markers
              .map(
                (marker) => Marker(
                  point: LatLng(marker.lat, marker.lng),
                  width: 120,
                  height: 58,
                  alignment: Alignment.topCenter,
                  child: _MarkerPin(marker: marker),
                ),
              )
              .toList(),
        ),

        // Ghi nguồn theo yêu cầu của OpenStreetMap.
        const RichAttributionWidget(
          attributions: <SourceAttribution>[
            TextSourceAttribution('© OpenStreetMap contributors'),
          ],
        ),
      ],
    );
  }
}

class _MarkerPin extends StatelessWidget {
  const _MarkerPin({required this.marker});

  final MapMarker marker;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    // Hiện trường dùng màu báo động; điểm hỗ trợ dùng màu trung tính. Nếu mọi
    // thứ đều đỏ thì không gì nổi bật.
    final (Color color, IconData icon) = switch (marker.kind) {
      MapMarkerKind.incident => (scheme.error, Icons.emergency_share),
      MapMarkerKind.supportResource => (
          scheme.primary,
          Icons.medical_services_outlined
        ),
      MapMarkerKind.facility => (
          scheme.tertiary,
          Icons.local_hospital_outlined
        ),
    };

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(icon, color: color, size: 32),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(
            color: scheme.surface.withValues(alpha: 0.9),
            borderRadius: BorderRadius.circular(4),
          ),
          child: Text(
            marker.label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
                fontSize: 11, fontWeight: FontWeight.w600, color: color),
          ),
        ),
      ],
    );
  }
}
