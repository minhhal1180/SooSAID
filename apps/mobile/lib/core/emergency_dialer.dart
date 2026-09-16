import 'package:url_launcher/url_launcher.dart';

import 'config.dart';

/// Gọi trực tiếp số cấp cứu.
///
/// Đây là **phương án dự phòng cuối cùng** của toàn hệ thống (TDD §12, runbook
/// SEV-1): khi mất mạng, khi backend lỗi, khi video không kết nối được — người
/// dùng phải luôn còn một nút bấm được ra số cấp cứu thật.
///
/// Vì thế hàm này cố ý KHÔNG phụ thuộc vào bất cứ thứ gì có thể hỏng: không
/// mạng, không state, không API.
class EmergencyDialer {
  const EmergencyDialer._();

  /// Mở trình quay số với số cấp cứu đã cấu hình.
  ///
  /// Dùng `LaunchMode.externalApplication` để chắc chắn thoát khỏi app và vào
  /// trình quay số hệ thống, thay vì mở trong WebView.
  ///
  /// Trả `false` nếu thiết bị không gọi được (máy tính bảng không SIM,
  /// simulator) — UI khi đó phải hiển thị số bằng chữ để người dùng tự bấm.
  static Future<bool> callEmergencyNumber() async {
    return _dial(AppConfig.emergencyPhoneNumber);
  }

  static Future<bool> call(String phoneNumber) => _dial(phoneNumber);

  static Future<bool> _dial(String phoneNumber) async {
    // Loại mọi ký tự không phải chữ số và dấu +: người dùng có thể đã nhập số
    // liên hệ kèm dấu cách/gạch ngang.
    final sanitized = phoneNumber.replaceAll(RegExp(r'[^0-9+]'), '');
    if (sanitized.isEmpty) return false;

    final uri = Uri(scheme: 'tel', path: sanitized);

    try {
      return await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      return false;
    }
  }
}
