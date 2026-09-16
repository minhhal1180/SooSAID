import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Lưu credential trong kho bảo mật của hệ điều hành.
///
/// Tách khỏi `OfflineCache` có chủ đích: hai loại dữ liệu có yêu cầu bảo vệ
/// khác nhau và không nên nằm chung một nơi.
///
/// | Dữ liệu | Nơi lưu | Lý do |
/// |---|---|---|
/// | Access/refresh token | `SecureStore` (Keychain / EncryptedSharedPreferences) | Threat model – "Lost phone": máy mất thì token không đọc được |
/// | Hướng dẫn đã duyệt, deviceId | `OfflineCache` (shared_preferences) | Không nhạy cảm, cần đọc nhanh khi offline |
///
/// KHÔNG lưu ở đây: hồ sơ sức khỏe, dữ liệu vị trí, media. Chúng luôn được lấy
/// từ server khi cần và không bao giờ nằm lại trên máy.
class SecureStore {
  SecureStore({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              iOptions: IOSOptions(
                // `first_unlock` thay vì `unlocked`: cho phép app đọc token khi
                // máy đã mở khoá ít nhất một lần sau khi bật nguồn — cần thiết
                // vì thông báo khẩn cấp có thể tới lúc màn hình đang khoá.
                accessibility: KeychainAccessibility.first_unlock,
              ),
            );

  static const String _keyAccessToken = 'sos.accessToken';
  static const String _keyRefreshToken = 'sos.refreshToken';

  final FlutterSecureStorage _storage;

  Future<String?> readAccessToken() => _read(_keyAccessToken);
  Future<String?> readRefreshToken() => _read(_keyRefreshToken);

  Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    await _storage.write(key: _keyAccessToken, value: accessToken);
    await _storage.write(key: _keyRefreshToken, value: refreshToken);
  }

  Future<void> clear() async {
    await _storage.delete(key: _keyAccessToken);
    await _storage.delete(key: _keyRefreshToken);
  }

  /// Keychain có thể ném lỗi (máy vừa khôi phục từ backup, keystore hỏng).
  /// Coi như chưa đăng nhập còn hơn làm app crash ngay lúc mở.
  Future<String?> _read(String key) async {
    try {
      return await _storage.read(key: key);
    } catch (_) {
      return null;
    }
  }
}
