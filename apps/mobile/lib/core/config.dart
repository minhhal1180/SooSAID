/// Cấu hình ứng dụng.
///
/// Rule 9.2 (No Hard Code): mọi endpoint, ngưỡng và TTL nằm ở đây, truyền vào
/// lúc build bằng `--dart-define` để mỗi môi trường dùng một giá trị khác nhau
/// mà không phải sửa code.
///
/// Ví dụ:
///   flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/v1
///   (10.0.2.2 là địa chỉ máy host nhìn từ Android emulator)
class AppConfig {
  const AppConfig._();

  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3000/v1',
  );

  /// Số điện thoại cấp cứu hiển thị khi mất mạng hoặc khi backend lỗi.
  ///
  /// TDD §12: khi không tạo được ca, app PHẢI đưa ra hành động khẩn cấp trực
  /// tiếp và tuyệt đối không hiển thị "đã gửi".
  static const String emergencyPhoneNumber = String.fromEnvironment(
    'EMERGENCY_PHONE',
    defaultValue: '115',
  );

  /// Khoá nút S.O.S sau khi bấm, chống double tap sinh hai ca (TC-003).
  static const Duration sosButtonLockDuration = Duration(seconds: 5);

  /// Nhịp gửi mẫu vị trí khi ca đang hoạt động (FR-003).
  static const Duration locationRefreshInterval = Duration(seconds: 15);

  /// Nhịp hỏi lại trạng thái ca. Push chỉ là thông báo, KHÔNG phải nguồn sự thật
  /// (TDD §3.1), nên app vẫn chủ động lấy snapshot.
  static const Duration casePollInterval = Duration(seconds: 5);

  /// Thời gian chờ tối đa cho một lệnh gọi API. Trong tình huống cấp cứu, thà
  /// báo lỗi và chuyển sang phương án dự phòng còn hơn để người dùng chờ vô hạn.
  static const Duration apiTimeout = Duration(seconds: 12);

  /// Sai số GPS vượt ngưỡng này thì nhắc người dùng bổ sung mốc nhận dạng
  /// (TC-005). Khớp `LOW_ACCURACY_THRESHOLD_METERS` ở backend.
  static const double lowAccuracyThresholdMeters = 100;

  /// Bán kính tìm điểm hỗ trợ tại chỗ quanh hiện trường (M07).
  /// 1 km: đủ rộng cho một khuôn viên trường/khu dân cư, đủ hẹp để danh sách
  /// còn hữu ích khi người dùng phải chạy bộ tới lấy.
  static const int nearbyResourceRadiusMeters = 1000;

  // --- Bản đồ ---------------------------------------------------------------

  /// Tile server OpenStreetMap. Đổi sang nhà cung cấp có SLA khi triển khai
  /// diện rộng; OSM công cộng không cam kết dịch vụ.
  static const String osmTileUrlTemplate = String.fromEnvironment(
    'OSM_TILE_URL',
    defaultValue: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  );

  /// OSM yêu cầu ứng dụng khai báo định danh khi gọi tile.
  static const String osmUserAgent = 'vn.sosaid.mobile';

  // --- Video ----------------------------------------------------------------

  /// Sau ngần này mà video vẫn chưa kết nối được thì hiển thị phương án thoại.
  /// Người ở hiện trường không có thời gian chờ một thanh loading vô định.
  static const Duration videoConnectTimeout = Duration(seconds: 12);
}
