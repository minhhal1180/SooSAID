import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:livekit_client/livekit_client.dart' as lk;

import 'video_call_adapter.dart';

/// Driver WebRTC thật qua LiveKit.
///
/// **File DUY NHẤT trong app được phép import `livekit_client`** (Rule 8.1).
/// Đổi sang Twilio/Agora = thêm một file cùng cài `VideoCallAdapter` và sửa
/// `VideoAdapterFactory`; không màn hình nào phải thay đổi.
///
/// Dùng `Room` như một `ChangeNotifier` (lắng nghe bằng `addListener`) thay vì
/// đăng ký từng loại sự kiện: API sự kiện của SDK thay đổi nhiều giữa các phiên
/// bản, còn `addListener` ổn định và đủ cho nhu cầu ở đây — ta chỉ cần biết
/// "đã kết nối chưa" và "có ai trong phòng chưa".
class LiveKitVideoCallAdapter implements VideoCallAdapter {
  LiveKitVideoCallAdapter();

  @override
  String get providerName => 'livekit';

  final ValueNotifier<VideoCallState> _state =
      ValueNotifier<VideoCallState>(VideoCallState.initial);

  lk.Room? _room;

  @override
  ValueListenable<VideoCallState> get state => _state;

  @override
  Future<void> connect(VideoJoinTicket ticket) async {
    // Token hết hạn thì đừng thử kết nối: SDK sẽ báo lỗi khó hiểu, trong khi
    // nguyên nhân thật là client giữ ticket quá lâu. Yêu cầu lấy ticket mới.
    if (ticket.isExpired) {
      _fail('Phiên video đã hết hạn. Vui lòng thử kết nối lại.');
      return;
    }

    await _disposeRoom();
    _state.value = _state.value.copyWith(status: VideoCallStatus.connecting);

    final room = lk.Room(
      roomOptions: const lk.RoomOptions(
        // adaptiveStream + dynacast giảm băng thông khi mạng yếu — hiện trường
        // cấp cứu thường ở nơi sóng kém.
        adaptiveStream: true,
        dynacast: true,
      ),
    );
    _room = room;
    room.addListener(_onRoomChanged);

    try {
      await room.connect(ticket.serverUrl, ticket.token);
      await room.localParticipant?.setCameraEnabled(true);
      await room.localParticipant?.setMicrophoneEnabled(true);
      _onRoomChanged();
    } catch (_) {
      // Không hiển thị lỗi gốc của SDK cho người dùng; UI sẽ chuyển sang
      // phương án thoại (FR-007, TC-009).
      _fail('Không kết nối được video. Hãy dùng phương án gọi thoại.');
      await _disposeRoom();
    }
  }

  @override
  Future<void> disconnect() async {
    await _disposeRoom();
    _state.value = const VideoCallState(status: VideoCallStatus.disconnected);
  }

  @override
  Future<void> setCameraEnabled(bool enabled) async {
    await _room?.localParticipant?.setCameraEnabled(enabled);
    _state.value = _state.value.copyWith(cameraEnabled: enabled);
  }

  @override
  Future<void> setMicrophoneEnabled(bool enabled) async {
    await _room?.localParticipant?.setMicrophoneEnabled(enabled);
    _state.value = _state.value.copyWith(microphoneEnabled: enabled);
  }

  @override
  Future<void> switchCamera() async {
    final track = _localVideoTrack();
    if (track == null) return;

    final current = track.currentOptions;
    if (current is lk.CameraCaptureOptions) {
      await track.setCameraPosition(
        current.cameraPosition == lk.CameraPosition.front
            ? lk.CameraPosition.back
            : lk.CameraPosition.front,
      );
    }
  }

  @override
  Widget? buildLocalPreview() {
    final track = _localVideoTrack();
    if (track == null) return null;
    return lk.VideoTrackRenderer(track, fit: lk.VideoViewFit.cover);
  }

  @override
  Widget? buildRemoteView() {
    final track = _firstRemoteVideoTrack();
    if (track == null) return null;
    return lk.VideoTrackRenderer(track, fit: lk.VideoViewFit.contain);
  }

  @override
  void dispose() {
    final room = _room;
    _room = null;

    if (room != null) {
      room.removeListener(_onRoomChanged);
      // `dispose` bất đồng bộ nhưng `ChangeNotifier.dispose` thì không; bỏ qua
      // Future một cách tường minh thay vì để lint cảnh báo.
      unawaited(room.dispose());
    }
    _state.dispose();
  }

  // --- Nội bộ ---------------------------------------------------------------

  void _onRoomChanged() {
    final room = _room;
    if (room == null) return;

    final remoteCount = room.remoteParticipants.length;
    final status = switch (room.connectionState) {
      lk.ConnectionState.connected => VideoCallStatus.connected,
      lk.ConnectionState.connecting => VideoCallStatus.connecting,
      lk.ConnectionState.reconnecting => VideoCallStatus.reconnecting,
      lk.ConnectionState.disconnected => VideoCallStatus.disconnected,
    };

    _state.value = _state.value.copyWith(
      status: status,
      remoteParticipantCount: remoteCount,
    );
  }

  lk.LocalVideoTrack? _localVideoTrack() {
    for (final publication in _room?.localParticipant?.videoTrackPublications ??
        const <lk.LocalTrackPublication<lk.LocalVideoTrack>>[]) {
      final track = publication.track;
      if (track != null) return track;
    }
    return null;
  }

  lk.VideoTrack? _firstRemoteVideoTrack() {
    for (final participant
        in _room?.remoteParticipants.values ?? const <lk.RemoteParticipant>[]) {
      for (final publication in participant.videoTrackPublications) {
        final track = publication.track;
        if (track != null && publication.subscribed) return track;
      }
    }
    return null;
  }

  void _fail(String message) {
    _state.value = _state.value.copyWith(
      status: VideoCallStatus.failed,
      errorMessage: message,
    );
  }

  Future<void> _disposeRoom() async {
    final room = _room;
    if (room == null) return;

    room.removeListener(_onRoomChanged);
    _room = null;
    await room.disconnect();
    await room.dispose();
  }
}
