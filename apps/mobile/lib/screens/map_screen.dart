import 'package:flutter/material.dart';

import '../core/map/map_view_adapter.dart';
import '../core/map/osm_map_adapter.dart';
import '../main.dart';
import '../state/app_state.dart';

/// M07 – Bản đồ hiện trường và điểm hỗ trợ tại chỗ.
///
/// TDD §12 là quy tắc chi phối màn hình này: **bản đồ không phải điều kiện để
/// xử lý ca**. Không có toạ độ, hoặc tile không tải được, thì vẫn phải hiển thị
/// toạ độ, địa chỉ và chỉ dẫn tiếp cận bằng chữ — vì đó mới là thứ kíp cấp cứu
/// thật sự dùng để tìm đường vào.
class MapScreen extends StatefulWidget {
  const MapScreen({super.key});

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  /// Đổi nhà cung cấp bản đồ = đổi một dòng ở đây.
  final MapViewAdapter _mapAdapter = const OsmMapViewAdapter();

  @override
  void initState() {
    super.initState();
    // Danh sách điểm hỗ trợ có thể đã cũ; làm mới khi mở màn hình.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      AppStateScope.of(context).refreshNearbyResources();
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = AppStateScope.of(context);
    final location = state.activeCase?.latestLocation ?? state.lastLocation;

    return Scaffold(
      appBar: AppBar(title: const Text('Vị trí và điểm hỗ trợ')),
      body: SafeArea(
        child: Column(
          children: <Widget>[
            Expanded(
              flex: 3,
              child: location == null
                  ? const _NoCoordinatesView()
                  : _mapAdapter.build(
                      context: context,
                      centerLat: location.lat,
                      centerLng: location.lng,
                      accuracyMeters: location.accuracyMeters,
                      markers: _buildMarkers(state, location.lat, location.lng),
                    ),
            ),
            Expanded(
              flex: 2,
              child: _DetailsPanel(state: state),
            ),
          ],
        ),
      ),
    );
  }

  List<MapMarker> _buildMarkers(AppState state, double lat, double lng) {
    return <MapMarker>[
      MapMarker(
          lat: lat,
          lng: lng,
          label: 'Hiện trường',
          kind: MapMarkerKind.incident),
      ...state.nearbyResources.map(
        (resource) => MapMarker(
          lat: resource.lat,
          lng: resource.lng,
          label: _resourceLabel(resource.resourceType),
          kind: MapMarkerKind.supportResource,
        ),
      ),
    ];
  }
}

/// Không có toạ độ vẫn phải dùng được màn hình — đây chính là tình huống TC-004.
class _NoCoordinatesView extends StatelessWidget {
  const _NoCoordinatesView();

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(Icons.location_off_outlined, size: 44),
              SizedBox(height: 12),
              Text(
                'Chưa có toạ độ để hiển thị bản đồ',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
              ),
              SizedBox(height: 6),
              Text(
                'Hãy mô tả địa chỉ, toà nhà, tầng và lối vào cho nhân viên trực.',
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DetailsPanel extends StatelessWidget {
  const _DetailsPanel({required this.state});

  final AppState state;

  @override
  Widget build(BuildContext context) {
    final location = state.activeCase?.latestLocation ?? state.lastLocation;
    final scheme = Theme.of(context).colorScheme;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        // Toạ độ dạng chữ luôn hiển thị: người dùng có thể đọc qua điện thoại
        // cho kíp cấp cứu ngay cả khi bản đồ không tải được.
        if (location != null) ...<Widget>[
          Text('Toạ độ', style: Theme.of(context).textTheme.titleMedium),
          SelectableText(
            '${location.lat.toStringAsFixed(6)}, ${location.lng.toStringAsFixed(6)}',
            style: const TextStyle(fontFamily: 'monospace', fontSize: 16),
          ),
          if (location.accuracyMeters != null)
            Text(
              'Sai số ±${location.accuracyMeters!.round()} m',
              style: TextStyle(
                color: state.locationIsLowAccuracy
                    ? scheme.error
                    : scheme.onSurfaceVariant,
              ),
            ),
          const SizedBox(height: 12),
        ],

        if (state.manualAddress.trim().isNotEmpty) ...<Widget>[
          Text('Địa chỉ đã mô tả',
              style: Theme.of(context).textTheme.titleMedium),
          Text(state.manualAddress),
          const SizedBox(height: 12),
        ],

        if (state.accessNote.trim().isNotEmpty) ...<Widget>[
          Text('Lối vào', style: Theme.of(context).textTheme.titleMedium),
          Text(state.accessNote),
          const SizedBox(height: 12),
        ],

        Text('Điểm hỗ trợ gần nhất',
            style: Theme.of(context).textTheme.titleMedium),
        if (state.nearbyResources.isEmpty)
          const Padding(
            padding: EdgeInsets.only(top: 4),
            child: Text('Chưa có dữ liệu điểm hỗ trợ cho khu vực này.'),
          )
        else
          ...state.nearbyResources.map(
            (resource) => ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(_resourceIcon(resource.resourceType),
                  color: scheme.primary),
              title: Text(
                  '${_resourceLabel(resource.resourceType)} · ${resource.name}'),
              subtitle: Text(
                <String>[
                  '${resource.distanceMeters} m',
                  if (resource.accessInstruction != null)
                    resource.accessInstruction!,
                ].join(' · '),
              ),
            ),
          ),

        if (state.nearbySpatialAccuracy == 'approximate')
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              'Khoảng cách tính xấp xỉ (máy chủ đang chạy chế độ mô phỏng).',
              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
            ),
          ),
      ],
    );
  }
}

String _resourceLabel(String resourceType) => switch (resourceType) {
      'FIRST_AID_ROOM' => 'Phòng y tế',
      'AED' => 'Máy AED',
      'ACCESS_GATE' => 'Lối xe vào',
      _ => resourceType,
    };

IconData _resourceIcon(String resourceType) => switch (resourceType) {
      'FIRST_AID_ROOM' => Icons.medical_services_outlined,
      'AED' => Icons.monitor_heart_outlined,
      'ACCESS_GATE' => Icons.door_sliding_outlined,
      _ => Icons.place_outlined,
    };
