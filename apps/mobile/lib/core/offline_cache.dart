import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/guidance.dart';

/// Lưu trữ cục bộ tối thiểu (TDD §8.1, SOS-051).
///
/// Nguyên tắc: chỉ giữ thứ THỰC SỰ cần khi mất mạng.
///  - Token đăng nhập.
///  - Nội dung hướng dẫn đã tải, để xem được khi không có sóng.
///  - Mã ca đang hoạt động, để màn hình mở lại đúng ca.
///
/// TUYỆT ĐỐI KHÔNG cache: hồ sơ sức khỏe, dữ liệu vị trí lịch sử, media. Điện
/// thoại có thể mất hoặc bị người khác cầm (threat model – "Lost phone").
///
/// GHI CHÚ BẢO MẬT: `shared_preferences` KHÔNG mã hoá. Trước Pilot có dữ liệu
/// thật, token phải chuyển sang secure storage của hệ điều hành (Keychain /
/// EncryptedSharedPreferences) — hạng mục đã ghi trong docs/security.
class OfflineCache {
  OfflineCache._(this._prefs);

  static const String _keyAccessToken = 'sos.accessToken';
  static const String _keyRefreshToken = 'sos.refreshToken';
  static const String _keyDeviceId = 'sos.deviceId';
  static const String _keyActiveCaseId = 'sos.activeCaseId';
  static const String _keyGuidance = 'sos.guidanceCache';

  final SharedPreferences _prefs;

  static Future<OfflineCache> open() async {
    return OfflineCache._(await SharedPreferences.getInstance());
  }

  String? get accessToken => _prefs.getString(_keyAccessToken);
  String? get refreshToken => _prefs.getString(_keyRefreshToken);
  String? get deviceId => _prefs.getString(_keyDeviceId);
  String? get activeCaseId => _prefs.getString(_keyActiveCaseId);

  Future<void> saveTokens({required String accessToken, required String refreshToken}) async {
    await _prefs.setString(_keyAccessToken, accessToken);
    await _prefs.setString(_keyRefreshToken, refreshToken);
  }

  Future<void> saveDeviceId(String deviceId) => _prefs.setString(_keyDeviceId, deviceId);

  Future<void> saveActiveCaseId(String? caseId) async {
    if (caseId == null) {
      await _prefs.remove(_keyActiveCaseId);
    } else {
      await _prefs.setString(_keyActiveCaseId, caseId);
    }
  }

  /// Lưu danh mục hướng dẫn để dùng khi mất mạng (TC-022).
  Future<void> saveGuidance(List<Guidance> guides) async {
    final payload = guides.map((guide) => guide.toCacheJson()).toList();
    await _prefs.setString(_keyGuidance, jsonEncode(payload));
  }

  List<Guidance> loadGuidance() {
    final raw = _prefs.getString(_keyGuidance);
    if (raw == null) return const [];

    try {
      final decoded = jsonDecode(raw) as List<dynamic>;
      return decoded
          .map((item) => Guidance.fromJson(item as Map<String, dynamic>))
          .toList();
    } catch (_) {
      // Cache hỏng thì coi như không có, không làm app crash lúc khẩn cấp.
      return const [];
    }
  }

  /// Đăng xuất: xoá token và ca đang hoạt động, GIỮ lại nội dung hướng dẫn
  /// (nội dung đã duyệt không phải dữ liệu cá nhân và vẫn hữu ích khi offline).
  Future<void> clearSession() async {
    await _prefs.remove(_keyAccessToken);
    await _prefs.remove(_keyRefreshToken);
    await _prefs.remove(_keyActiveCaseId);
  }
}
