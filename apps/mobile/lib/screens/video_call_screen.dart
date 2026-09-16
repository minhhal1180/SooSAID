import 'dart:async';

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../core/config.dart';
import '../core/emergency_dialer.dart';
import '../core/video/video_adapter_factory.dart';
import '../core/video/video_call_adapter.dart';
import '../main.dart';

/// M05 – Video call với nhân viên trực (FR-006, SOS-021).
///
/// Ba quyết định thiết kế bắt nguồn từ FR-007 và TC-009:
///  1. **Phương án thoại luôn hiện diện.** Nút gọi số cấp cứu nằm cố định trên
///     màn hình, không ẩn trong menu, không chờ video thất bại mới xuất hiện.
///  2. **Không quay vòng chờ vô định.** Quá `videoConnectTimeout` mà chưa kết
///     nối được thì chuyển sang trạng thái thất bại và đề nghị gọi thoại.
///  3. **Không import SDK.** Toàn bộ đi qua `VideoCallAdapter` (Rule 8.1); màn
///     hình này không biết đang chạy LiveKit hay mock.
class VideoCallScreen extends StatefulWidget {
  const VideoCallScreen({super.key});

  @override
  State<VideoCallScreen> createState() => _VideoCallScreenState();
}

class _VideoCallScreenState extends State<VideoCallScreen> {
  VideoCallAdapter? _adapter;
  VideoJoinTicket? _ticket;
  Timer? _connectTimeoutTimer;

  bool _preparing = true;
  String? _blockingError;

  @override
  void initState() {
    super.initState();
    unawaited(_start());
  }

  @override
  void dispose() {
    _connectTimeoutTimer?.cancel();
    _adapter?.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    final state = AppStateScope.of(context);

    // Xin quyền TRƯỚC khi gọi API: xin vé rồi mới phát hiện không có quyền
    // camera là lãng phí một vòng mạng trong lúc khẩn cấp.
    final granted = await _ensureMediaPermissions();
    if (!mounted) return;

    if (!granted) {
      setState(() {
        _preparing = false;
        _blockingError =
            'Ứng dụng chưa được cấp quyền camera hoặc micro. Bạn vẫn có thể gọi thoại.';
      });
      return;
    }

    final ticket = await state.requestVideoTicket();
    if (!mounted) return;

    if (ticket == null) {
      setState(() {
        _preparing = false;
        _blockingError =
            'Không mở được phiên video. Hãy dùng phương án gọi thoại bên dưới.';
      });
      return;
    }

    // Driver do BACKEND quyết định qua trường `provider` — hai đầu luôn khớp.
    final adapter = VideoAdapterFactory.create(ticket.provider);
    setState(() {
      _ticket = ticket;
      _adapter = adapter;
      _preparing = false;
    });

    await adapter.connect(ticket);
    _armConnectTimeout(adapter);
  }

  /// Chuyển sang trạng thái thất bại nếu quá hạn mà vẫn chưa kết nối xong.
  void _armConnectTimeout(VideoCallAdapter adapter) {
    _connectTimeoutTimer?.cancel();
    _connectTimeoutTimer = Timer(AppConfig.videoConnectTimeout, () {
      if (!mounted) return;
      final status = adapter.state.value.status;
      if (status == VideoCallStatus.connected) return;

      setState(() {
        _blockingError =
            'Kết nối video mất quá nhiều thời gian. Hãy gọi thoại để không chậm trễ.';
      });
    });
  }

  Future<bool> _ensureMediaPermissions() async {
    final statuses = await <Permission>[
      Permission.camera,
      Permission.microphone,
    ].request();

    return statuses.values.every((status) => status.isGranted);
  }

  Future<void> _leave() async {
    _connectTimeoutTimer?.cancel();
    await _adapter?.disconnect();
    if (!mounted) return;
    await AppStateScope.of(context).endVideoSession();
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final adapter = _adapter;

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: const Text('Kết nối với nhân viên trực'),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () => unawaited(_leave()),
        ),
      ),
      body: SafeArea(
        child: Column(
          children: <Widget>[
            if (_ticket?.recordingEnabled ?? false) const _RecordingBanner(),
            if (_blockingError != null)
              _FallbackBanner(message: _blockingError!),
            Expanded(
              child: _preparing || adapter == null
                  ? const Center(child: CircularProgressIndicator())
                  : ValueListenableBuilder<VideoCallState>(
                      valueListenable: adapter.state,
                      builder: (context, state, _) => _VideoStage(
                        adapter: adapter,
                        state: state,
                      ),
                    ),
            ),
            if (adapter != null)
              ValueListenableBuilder<VideoCallState>(
                valueListenable: adapter.state,
                builder: (context, state, _) => _CallControls(
                  adapter: adapter,
                  state: state,
                  onLeave: () => unawaited(_leave()),
                ),
              ),
            const _AlwaysVisibleVoiceFallback(),
          ],
        ),
      ),
    );
  }
}

/// Khu vực hiển thị hình: người trực chiếm toàn màn hình, hình mình thu nhỏ ở góc.
class _VideoStage extends StatelessWidget {
  const _VideoStage({required this.adapter, required this.state});

  final VideoCallAdapter adapter;
  final VideoCallState state;

  @override
  Widget build(BuildContext context) {
    final remoteView = adapter.buildRemoteView();
    final localPreview = adapter.buildLocalPreview();

    return Stack(
      children: <Widget>[
        Positioned.fill(
          child: remoteView ?? _WaitingForOperator(state: state),
        ),
        if (localPreview != null)
          Positioned(
            right: 12,
            bottom: 12,
            width: 110,
            height: 150,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: localPreview,
            ),
          ),
      ],
    );
  }
}

class _WaitingForOperator extends StatelessWidget {
  const _WaitingForOperator({required this.state});

  final VideoCallState state;

  @override
  Widget build(BuildContext context) {
    final (String title, String detail) = switch (state.status) {
      VideoCallStatus.connecting => (
          'Đang kết nối…',
          'Giữ máy hướng về người gặp nạn'
        ),
      VideoCallStatus.reconnecting => (
          'Mất sóng, đang kết nối lại…',
          'Đừng tắt ứng dụng'
        ),
      VideoCallStatus.connected => (
          'Đã vào phòng',
          'Đang chờ nhân viên trực tham gia. Bạn có thể bắt đầu mô tả tình trạng.',
        ),
      VideoCallStatus.failed => (
          'Không kết nối được video',
          'Hãy dùng phương án gọi thoại'
        ),
      VideoCallStatus.disconnected => ('Đã rời phòng', ''),
      VideoCallStatus.idle => ('Chưa kết nối', ''),
    };

    return ColoredBox(
      color: Colors.black,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              if (state.status == VideoCallStatus.connecting ||
                  state.status == VideoCallStatus.reconnecting)
                const Padding(
                  padding: EdgeInsets.only(bottom: 20),
                  child: CircularProgressIndicator(color: Colors.white),
                ),
              Text(
                title,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.w600,
                ),
              ),
              if (detail.isNotEmpty) ...<Widget>[
                const SizedBox(height: 8),
                Text(
                  detail,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white70, fontSize: 15),
                ),
              ],
              if (state.errorMessage != null) ...<Widget>[
                const SizedBox(height: 12),
                Text(
                  state.errorMessage!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.orangeAccent),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _CallControls extends StatelessWidget {
  const _CallControls({
    required this.adapter,
    required this.state,
    required this.onLeave,
  });

  final VideoCallAdapter adapter;
  final VideoCallState state;
  final VoidCallback onLeave;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 20),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: <Widget>[
          _ControlButton(
            icon: state.microphoneEnabled ? Icons.mic : Icons.mic_off,
            label: state.microphoneEnabled ? 'Tắt mic' : 'Bật mic',
            active: state.microphoneEnabled,
            onPressed: () => unawaited(
                adapter.setMicrophoneEnabled(!state.microphoneEnabled)),
          ),
          _ControlButton(
            icon: state.cameraEnabled ? Icons.videocam : Icons.videocam_off,
            label: state.cameraEnabled ? 'Tắt hình' : 'Bật hình',
            active: state.cameraEnabled,
            onPressed: () =>
                unawaited(adapter.setCameraEnabled(!state.cameraEnabled)),
          ),
          _ControlButton(
            icon: Icons.cameraswitch,
            label: 'Đổi cam',
            active: true,
            onPressed: () => unawaited(adapter.switchCamera()),
          ),
          _ControlButton(
            icon: Icons.call_end,
            label: 'Kết thúc',
            active: true,
            danger: true,
            onPressed: onLeave,
          ),
        ],
      ),
    );
  }
}

class _ControlButton extends StatelessWidget {
  const _ControlButton({
    required this.icon,
    required this.label,
    required this.active,
    required this.onPressed,
    this.danger = false,
  });

  final IconData icon;
  final String label;
  final bool active;
  final bool danger;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final color = danger
        ? Theme.of(context).colorScheme.error
        : (active ? Colors.white : Colors.white38);

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        // Vùng chạm 56px – tay run hoặc tay bẩn vẫn bấm trúng.
        SizedBox(
          width: 56,
          height: 56,
          child: IconButton(
            icon: Icon(icon, color: color, size: 26),
            style: IconButton.styleFrom(backgroundColor: Colors.white12),
            onPressed: onPressed,
          ),
        ),
        const SizedBox(height: 4),
        Text(label, style: TextStyle(color: color, fontSize: 12)),
      ],
    );
  }
}

/// Ghi hình chỉ bật khi CẢ chính sách hệ thống lẫn đồng ý của người dùng đều
/// đúng (TC-017). Khi đã bật, người dùng phải được thông báo rõ ràng.
class _RecordingBanner extends StatelessWidget {
  const _RecordingBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: Theme.of(context).colorScheme.error,
      padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 16),
      child: const Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          Icon(Icons.fiber_manual_record, color: Colors.white, size: 14),
          SizedBox(width: 6),
          Text(
            'Phiên này đang được ghi hình',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

class _FallbackBanner extends StatelessWidget {
  const _FallbackBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: Colors.orange.shade800,
      padding: const EdgeInsets.all(12),
      child: Text(
        message,
        style:
            const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
      ),
    );
  }
}

/// Nút gọi thoại **luôn hiển thị**, không phụ thuộc trạng thái video.
///
/// FR-007 và runbook SEV-1: người ở hiện trường phải luôn còn một đường ra số
/// cấp cứu thật, kể cả khi mọi thứ khác hỏng.
class _AlwaysVisibleVoiceFallback extends StatelessWidget {
  const _AlwaysVisibleVoiceFallback();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
      child: OutlinedButton.icon(
        icon: const Icon(Icons.phone_in_talk),
        label: const Text('Gọi ${AppConfig.emergencyPhoneNumber}'),
        style: OutlinedButton.styleFrom(
          foregroundColor: Colors.white,
          side: const BorderSide(color: Colors.white54),
        ),
        onPressed: () async {
          final dialled = await EmergencyDialer.callEmergencyNumber();
          if (!dialled && context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text(
                  'Thiết bị không gọi được. Hãy bấm số '
                  '${AppConfig.emergencyPhoneNumber} trên máy khác.',
                ),
              ),
            );
          }
        },
      ),
    );
  }
}
