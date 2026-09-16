import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/guidance.dart';

/// Lưu trữ cục bộ cho dữ liệu **không nhạy cảm** (TDD §8.1, SOS-051).
///
/// Token đăng nhập KHÔNG nằm ở đây — chúng ở [SecureStore] (Keychain /
/// EncryptedSharedPreferences). `shared_preferences` không mã hoá, nên chỉ chứa
/// những thứ mà người cầm được máy đọc ra cũng không gây hại:
///  - Nội dung hướng dẫn đã duyệt, để xem được khi mất sóng.
///  - `deviceId` (định danh ngẫu nhiên, không gắn với danh tính).
///  - Id ca đang hoạt động, để mở lại đúng màn hình.
///
/// TUYỆT ĐỐI KHÔNG cache: hồ sơ sức khỏe, lịch sử vị trí, media.
class OfflineCache {
  OfflineCache._(this._prefs);

  static const String _keyDeviceId = 'sos.deviceId';
  static const String _keyActiveCaseId = 'sos.activeCaseId';
  static const String _keyGuidance = 'sos.guidanceCache';
  static const String _keyGuidanceSyncedAt = 'sos.guidanceSyncedAt';

  final SharedPreferences _prefs;

  static Future<OfflineCache> open() async {
    return OfflineCache._(await SharedPreferences.getInstance());
  }

  String? get deviceId => _prefs.getString(_keyDeviceId);
  String? get activeCaseId => _prefs.getString(_keyActiveCaseId);

  /// Thời điểm tải hướng dẫn gần nhất — màn hình offline hiển thị để người dùng
  /// biết nội dung mình đang xem cũ bao lâu.
  DateTime? get guidanceSyncedAt {
    final raw = _prefs.getString(_keyGuidanceSyncedAt);
    return raw == null ? null : DateTime.tryParse(raw);
  }

  Future<void> saveDeviceId(String deviceId) =>
      _prefs.setString(_keyDeviceId, deviceId);

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
    await _prefs.setString(
      _keyGuidanceSyncedAt,
      DateTime.now().toUtc().toIso8601String(),
    );
  }

  List<Guidance> loadGuidance() {
    final raw = _prefs.getString(_keyGuidance);
    if (raw == null) return const <Guidance>[];

    try {
      final decoded = jsonDecode(raw) as List<dynamic>;
      return decoded
          .map((item) => Guidance.fromJson(item as Map<String, dynamic>))
          .toList();
    } catch (_) {
      // Cache hỏng thì coi như không có, không làm app crash lúc khẩn cấp.
      return const <Guidance>[];
    }
  }

  /// Đăng xuất: xoá ca đang hoạt động, GIỮ lại hướng dẫn và `deviceId`.
  /// Nội dung đã duyệt không phải dữ liệu cá nhân và vẫn hữu ích khi offline.
  Future<void> clearSession() async {
    await _prefs.remove(_keyActiveCaseId);
  }
}
