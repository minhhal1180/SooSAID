import 'package:geolocator/geolocator.dart';

import '../models/emergency_case.dart';

/// Kết quả lấy vị trí, phân biệt rõ ba tình huống mà UI xử lý khác nhau.
enum LocationOutcome {
  /// Có toạ độ.
  success,

  /// Người dùng từ chối quyền vị trí (TC-004).
  permissionDenied,

  /// Dịch vụ định vị của máy đang tắt.
  serviceDisabled,

  /// Bật quyền nhưng không lấy được toạ độ trong thời gian cho phép.
  unavailable,
}

class LocationResult {
  const LocationResult(this.outcome, [this.sample]);

  final LocationOutcome outcome;
  final LocationSample? sample;

  bool get hasCoordinates => sample != null;
}

/// Lấy vị trí GPS cho ca cấp cứu (FR-001, FR-003).
///
/// Nguyên tắc quan trọng của TDD §7.2 và TC-004: **thiếu vị trí KHÔNG được chặn
/// việc tạo ca**. Không có toạ độ thì vẫn gửi yêu cầu và để người dùng nhập địa
/// chỉ/mốc nhận dạng; tổng đài sẽ hỏi thêm.
class LocationService {
  /// Thời gian chờ tối đa cho lần đo đầu tiên. Chờ lâu hơn nghĩa là trì hoãn
  /// cuộc gọi cấp cứu — không chấp nhận được.
  static const Duration _firstFixTimeout = Duration(seconds: 6);

  /// Lấy mẫu vị trí tốt nhất trong thời gian cho phép.
  Future<LocationResult> getBestEffortLocation() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return const LocationResult(LocationOutcome.serviceDisabled);
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      return const LocationResult(LocationOutcome.permissionDenied);
    }

    try {
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: _firstFixTimeout,
        ),
      );
      return LocationResult(LocationOutcome.success, _toSample(position));
    } catch (_) {
      // Hết thời gian chờ: thử dùng vị trí cuối cùng đã biết, kèm mốc thời gian
      // thật của nó để tổng đài biết dữ liệu đã cũ bao lâu.
      final lastKnown = await Geolocator.getLastKnownPosition();
      if (lastKnown != null) {
        return LocationResult(LocationOutcome.success, _toSample(lastKnown));
      }
      return const LocationResult(LocationOutcome.unavailable);
    }
  }

  /// Luồng vị trí liên tục trong lúc ca đang hoạt động, để tổng đài thấy người
  /// gặp nạn có di chuyển hay không.
  Stream<LocationSample> watchPosition({int distanceFilterMeters = 5}) {
    return Geolocator.getPositionStream(
      locationSettings: LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: distanceFilterMeters,
      ),
    ).map(_toSample);
  }

  LocationSample _toSample(Position position) {
    return LocationSample(
      lat: position.latitude,
      lng: position.longitude,
      accuracyMeters: position.accuracy,
      // `capturedAt` là thời điểm THIẾT BỊ đo được, không phải lúc gửi đi —
      // backend cần biết mẫu này cũ bao nhiêu (FR-003).
      capturedAt: position.timestamp.toUtc().toIso8601String(),
    );
  }
}
