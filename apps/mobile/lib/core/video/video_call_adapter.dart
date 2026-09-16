import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

/// Port video phía client (Rule 8.1).
///
/// Màn hình KHÔNG BAO GIỜ import SDK video. Chỉ hai file được phép:
///   - `livekit_video_adapter.dart` (driver thật)
///   - `mock_video_adapter.dart`    (driver diễn tập)
///
/// Backend cũng có một port tương ứng (`VideoProviderPort`), và trường
/// `provider` trong response của `POST /emergency-cases/{id}/video/session`
/// quyết định client dùng driver nào — hai đầu luôn khớp nhau.
enum VideoCallStatus {
  /// Chưa tham gia phòng.
  idle,

  /// Đang kết nối tới máy chủ media.
  connecting,

  /// Đã vào phòng; có thể chưa có người khác.
  connected,

  /// Mất kết nối giữa chừng, SDK đang tự thử lại.
  reconnecting,

  /// Kết nối thất bại — UI phải hiển thị phương án thoại (FR-007, TC-009).
  failed,

  /// Đã rời phòng theo chủ ý.
  disconnected,
}

class VideoCallState {
  const VideoCallState({
    required this.status,
    this.remoteParticipantCount = 0,
    this.cameraEnabled = false,
    this.microphoneEnabled = false,
    this.errorMessage,
  });

  final VideoCallStatus status;

  /// Số người khác đang trong phòng — người dân cần biết "đã có ai nghe chưa".
  final int remoteParticipantCount;
  final bool cameraEnabled;
  final bool microphoneEnabled;

  /// Thông điệp an toàn để hiển thị; KHÔNG chứa chi tiết kỹ thuật của SDK.
  final String? errorMessage;

  bool get isLive => status == VideoCallStatus.connected;
  bool get hasRemoteParticipant => remoteParticipantCount > 0;

  VideoCallState copyWith({
    VideoCallStatus? status,
    int? remoteParticipantCount,
    bool? cameraEnabled,
    bool? microphoneEnabled,
    String? errorMessage,
  }) {
    return VideoCallState(
      status: status ?? this.status,
      remoteParticipantCount:
          remoteParticipantCount ?? this.remoteParticipantCount,
      cameraEnabled: cameraEnabled ?? this.cameraEnabled,
      microphoneEnabled: microphoneEnabled ?? this.microphoneEnabled,
      errorMessage: errorMessage,
    );
  }

  static const VideoCallState initial =
      VideoCallState(status: VideoCallStatus.idle);
}

/// Thông tin tham gia phòng, lấy từ API backend.
class VideoJoinTicket {
  const VideoJoinTicket({
    required this.provider,
    required this.room,
    required this.token,
    required this.serverUrl,
    required this.expiresAt,
    required this.recordingEnabled,
  });

  final String provider;
  final String room;
  final String token;
  final String serverUrl;
  final DateTime expiresAt;
  final bool recordingEnabled;

  bool get isExpired => DateTime.now().isAfter(expiresAt);

  factory VideoJoinTicket.fromJson(Map<String, dynamic> json) {
    return VideoJoinTicket(
      provider: json['provider'] as String? ?? 'mock',
      room: json['room'] as String? ?? '',
      token: json['token'] as String? ?? '',
      serverUrl: json['serverUrl'] as String? ?? '',
      expiresAt:
          DateTime.tryParse(json['expiresAt'] as String? ?? '')?.toLocal() ??
              DateTime.now(),
      recordingEnabled: json['recordingEnabled'] as bool? ?? false,
    );
  }
}

/// Giao diện mà mọi driver video phải cài đặt.
abstract class VideoCallAdapter {
  String get providerName;

  /// Trạng thái hiện tại; UI lắng nghe qua `ValueListenableBuilder`.
  ValueListenable<VideoCallState> get state;

  Future<void> connect(VideoJoinTicket ticket);
  Future<void> disconnect();

  Future<void> setCameraEnabled(bool enabled);
  Future<void> setMicrophoneEnabled(bool enabled);
  Future<void> switchCamera();

  /// Widget hiển thị hình của chính mình. `null` khi chưa có luồng video.
  ///
  /// Trả về Widget là cố ý: widget render video phụ thuộc SDK, nên nó phải nằm
  /// trong adapter. Đổi nhà cung cấp = đổi một file, UI không phải sửa.
  Widget? buildLocalPreview();

  /// Widget hiển thị hình của người trực. `null` khi chưa ai tham gia.
  Widget? buildRemoteView();

  void dispose();
}
