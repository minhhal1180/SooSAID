import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'video_call_adapter.dart';

/// Driver video cho chế độ diễn tập, khớp với `VIDEO_PROVIDER=mock` ở backend.
///
/// Vì sao cần: token do driver `mock` của backend phát được ký bằng HMAC nội bộ
/// và KHÔNG dùng được với máy chủ WebRTC thật. Nếu client cứ đưa token đó cho
/// LiveKit SDK, nó sẽ lỗi kết nối và người diễn tập tưởng hệ thống hỏng.
///
/// Driver này mô phỏng đúng vòng đời (connecting → connected → có người tham
/// gia) để kiểm thử luồng nghiệp vụ và giao diện, đồng thời **nói rõ trên màn
/// hình rằng đây là mô phỏng**, không giả vờ có video thật.
class MockVideoCallAdapter implements VideoCallAdapter {
  @override
  String get providerName => 'mock';

  final ValueNotifier<VideoCallState> _state =
      ValueNotifier<VideoCallState>(VideoCallState.initial);

  Timer? _connectTimer;
  Timer? _remoteJoinTimer;

  /// Độ trễ mô phỏng, xấp xỉ thời gian bắt tay WebRTC thật.
  static const Duration _connectDelay = Duration(milliseconds: 900);

  /// Thời gian mô phỏng nhân viên trực tham gia phòng.
  static const Duration _remoteJoinDelay = Duration(seconds: 3);

  @override
  ValueListenable<VideoCallState> get state => _state;

  @override
  Future<void> connect(VideoJoinTicket ticket) async {
    _cancelTimers();
    _state.value = _state.value.copyWith(status: VideoCallStatus.connecting);

    _connectTimer = Timer(_connectDelay, () {
      _state.value = _state.value.copyWith(
        status: VideoCallStatus.connected,
        cameraEnabled: true,
        microphoneEnabled: true,
      );

      _remoteJoinTimer = Timer(_remoteJoinDelay, () {
        _state.value = _state.value.copyWith(remoteParticipantCount: 1);
      });
    });
  }

  @override
  Future<void> disconnect() async {
    _cancelTimers();
    _state.value = const VideoCallState(status: VideoCallStatus.disconnected);
  }

  @override
  Future<void> setCameraEnabled(bool enabled) async {
    _state.value = _state.value.copyWith(cameraEnabled: enabled);
  }

  @override
  Future<void> setMicrophoneEnabled(bool enabled) async {
    _state.value = _state.value.copyWith(microphoneEnabled: enabled);
  }

  @override
  Future<void> switchCamera() async {
    // Không có camera thật để đổi.
  }

  @override
  Widget? buildLocalPreview() {
    return const _SimulatedFrame(
      icon: Icons.videocam_off_outlined,
      label: 'Chế độ diễn tập',
      detail: 'Không có hình ảnh thật',
    );
  }

  @override
  Widget? buildRemoteView() {
    if (!_state.value.hasRemoteParticipant) return null;
    return const _SimulatedFrame(
      icon: Icons.support_agent,
      label: 'Nhân viên trực (mô phỏng)',
      detail: 'Luồng nghiệp vụ hoạt động, chưa có video thật',
    );
  }

  @override
  void dispose() {
    _cancelTimers();
    _state.dispose();
  }

  void _cancelTimers() {
    _connectTimer?.cancel();
    _remoteJoinTimer?.cancel();
    _connectTimer = null;
    _remoteJoinTimer = null;
  }
}

/// Khung hình mô phỏng — cố ý trông KHÁC hẳn video thật để không gây nhầm lẫn.
class _SimulatedFrame extends StatelessWidget {
  const _SimulatedFrame({
    required this.icon,
    required this.label,
    required this.detail,
  });

  final IconData icon;
  final String label;
  final String detail;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        border: Border.all(color: scheme.outlineVariant, width: 2),
      ),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(icon, size: 36, color: scheme.onSurfaceVariant),
            const SizedBox(height: 8),
            Text(
              label,
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: scheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 2),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Text(
                detail,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
