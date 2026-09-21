/// Video hướng dẫn được đóng gói cùng ứng dụng để mở được khi mất mạng.
///
/// Đây là catalog phía client có version rõ ràng. Nội dung demo luôn mang cờ
/// [drillOnly]; trước Pilot thật, đơn vị y tế thay file MP4 và chuyển cờ này
/// sau khi hoàn tất quy trình phê duyệt nội dung.
class OfflineVideoGuide {
  const OfflineVideoGuide({
    required this.code,
    required this.version,
    required this.title,
    required this.summary,
    required this.assetPath,
    required this.duration,
    required this.steps,
    required this.drillOnly,
  });

  final String code;
  final int version;
  final String title;
  final String summary;
  final String assetPath;
  final Duration duration;
  final List<String> steps;
  final bool drillOnly;

  String get durationLabel {
    final minutes = duration.inMinutes;
    final seconds = duration.inSeconds.remainder(60);
    return '$minutes:${seconds.toString().padLeft(2, '0')}';
  }
}

/// Bộ tối thiểu luôn đi cùng binary/PWA, không phụ thuộc lần đăng nhập đầu tiên.
const List<OfflineVideoGuide> bundledOfflineVideoGuides = <OfflineVideoGuide>[
  OfflineVideoGuide(
    code: 'VIDEO-CALL-115',
    version: 1,
    title: 'Gọi hỗ trợ y tế khẩn cấp',
    summary: 'Chuẩn bị thông tin cần nói khi gọi 115.',
    assetPath: 'assets/offline_videos/call_115.mp4',
    duration: Duration(seconds: 12),
    drillOnly: true,
    steps: <String>[
      'Gọi 115 hoặc số cấp cứu tại địa phương ngay.',
      'Nói ngắn gọn địa chỉ, tình trạng và số người gặp nạn.',
      'Giữ máy và làm theo hướng dẫn của nhân viên y tế.',
    ],
  ),
  OfflineVideoGuide(
    code: 'VIDEO-SCENE-SAFETY',
    version: 1,
    title: 'Bảo đảm an toàn hiện trường',
    summary: 'Quan sát nguy cơ trước khi đến gần người bị nạn.',
    assetPath: 'assets/offline_videos/scene_safety.mp4',
    duration: Duration(seconds: 12),
    drillOnly: true,
    steps: <String>[
      'Quan sát giao thông, điện, nước, khói và vật có thể rơi.',
      'Chỉ tiếp cận khi hiện trường đủ an toàn.',
      'Nhờ người xung quanh cảnh giới và gọi 115.',
    ],
  ),
  OfflineVideoGuide(
    code: 'VIDEO-OBSERVE',
    version: 1,
    title: 'Ghi nhận dấu hiệu quan sát được',
    summary: 'Thu thập thông tin để báo cho nhân viên y tế.',
    assetPath: 'assets/offline_videos/observe_signs.mp4',
    duration: Duration(seconds: 12),
    drillOnly: true,
    steps: <String>[
      'Gọi tên và ghi nhận người bị nạn có phản ứng hay không.',
      'Quan sát lồng ngực có di động đều hay không.',
      'Quan sát vị trí chảy máu thấy rõ và báo cho nhân viên trực.',
    ],
  ),
  OfflineVideoGuide(
    code: 'VIDEO-WAIT-SUPPORT',
    version: 1,
    title: 'Giữ liên lạc trong khi chờ',
    summary: 'Duy trì kết nối và chuẩn bị đón lực lượng hỗ trợ.',
    assetPath: 'assets/offline_videos/wait_for_support.mp4',
    duration: Duration(seconds: 12),
    drillOnly: true,
    steps: <String>[
      'Giữ điện thoại bên mình và báo ngay khi tình trạng thay đổi.',
      'Giữ camera hướng về người bị nạn khi nhân viên trực yêu cầu.',
      'Cử người ra đón xe cấp cứu và chỉ lối vào.',
    ],
  ),
];
