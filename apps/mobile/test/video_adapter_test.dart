import 'package:flutter_test/flutter_test.dart';
import 'package:sos_aid_mobile/core/video/mock_video_adapter.dart';
import 'package:sos_aid_mobile/core/video/video_adapter_factory.dart';
import 'package:sos_aid_mobile/core/video/video_call_adapter.dart';

VideoJoinTicket _ticket({
  String provider = 'mock',
  Duration validFor = const Duration(minutes: 5),
  bool recordingEnabled = false,
}) {
  return VideoJoinTicket(
    provider: provider,
    room: 'case-abc',
    token: 'token',
    serverUrl: 'mock://local-video',
    expiresAt: DateTime.now().add(validFor),
    recordingEnabled: recordingEnabled,
  );
}

void main() {
  group('VideoJoinTicket', () {
    test('phát hiện token hết hạn', () {
      expect(_ticket(validFor: const Duration(minutes: 5)).isExpired, isFalse);
      expect(_ticket(validFor: const Duration(seconds: -1)).isExpired, isTrue);
    });

    test('đọc được response của backend', () {
      final ticket = VideoJoinTicket.fromJson(<String, dynamic>{
        'provider': 'livekit',
        'room': 'case-1f2e',
        'token': 'jwt',
        'serverUrl': 'wss://livekit.example.com',
        'expiresAt': '2026-09-13T08:05:00.000Z',
        'recordingEnabled': true,
      });

      expect(ticket.provider, 'livekit');
      expect(ticket.room, 'case-1f2e');
      expect(ticket.recordingEnabled, isTrue);
    });

    test('mặc định recordingEnabled=false khi server không nói rõ (TC-016)',
        () {
      final ticket = VideoJoinTicket.fromJson(<String, dynamic>{
        'provider': 'mock',
        'room': 'case-1',
        'token': 't',
        'serverUrl': 's',
        'expiresAt': '2026-09-13T08:05:00.000Z',
      });

      expect(ticket.recordingEnabled, isFalse);
    });

    test('tên phòng không chứa PII, chỉ có tiền tố và id ca', () {
      final ticket = _ticket();
      expect(ticket.room, startsWith('case-'));
      expect(RegExp(r'^case-[A-Za-z0-9-]+$').hasMatch(ticket.room), isTrue);
    });
  });

  group('VideoAdapterFactory (Rule 8.1)', () {
    test('chọn driver theo provider mà backend báo về', () {
      expect(VideoAdapterFactory.create('mock').providerName, 'mock');
      expect(VideoAdapterFactory.create('livekit').providerName, 'livekit');
    });

    test('provider lạ rơi về mock thay vì crash', () {
      // Backend có thể đổi sang nhà cung cấp mới trước khi app được cập nhật;
      // mất video còn hơn mất cả ứng dụng giữa lúc cấp cứu.
      expect(
          VideoAdapterFactory.create('nha-cung-cap-moi').providerName, 'mock');
    });
  });

  group('MockVideoCallAdapter', () {
    test('đi qua đúng vòng đời idle → connecting → connected', () async {
      final adapter = MockVideoCallAdapter();
      addTearDown(adapter.dispose);

      expect(adapter.state.value.status, VideoCallStatus.idle);

      await adapter.connect(_ticket());
      expect(adapter.state.value.status, VideoCallStatus.connecting);

      // Chờ quá độ trễ mô phỏng kết nối.
      await Future<void>.delayed(const Duration(seconds: 2));
      expect(adapter.state.value.status, VideoCallStatus.connected);
      expect(adapter.state.value.cameraEnabled, isTrue);
    });

    test('mô phỏng nhân viên trực tham gia sau vài giây', () async {
      final adapter = MockVideoCallAdapter();
      addTearDown(adapter.dispose);

      await adapter.connect(_ticket());
      expect(adapter.state.value.hasRemoteParticipant, isFalse);

      await Future<void>.delayed(const Duration(seconds: 5));
      expect(adapter.state.value.hasRemoteParticipant, isTrue);
      expect(adapter.buildRemoteView(), isNotNull);
    });

    test('bật/tắt mic và camera phản ánh vào state', () async {
      final adapter = MockVideoCallAdapter();
      addTearDown(adapter.dispose);

      await adapter.setMicrophoneEnabled(false);
      expect(adapter.state.value.microphoneEnabled, isFalse);

      await adapter.setCameraEnabled(true);
      expect(adapter.state.value.cameraEnabled, isTrue);
    });

    test('disconnect đưa về trạng thái đã rời phòng', () async {
      final adapter = MockVideoCallAdapter();
      addTearDown(adapter.dispose);

      await adapter.connect(_ticket());
      await adapter.disconnect();

      expect(adapter.state.value.status, VideoCallStatus.disconnected);
      expect(adapter.state.value.hasRemoteParticipant, isFalse);
    });

    test('disconnect huỷ timer nên không có cập nhật muộn', () async {
      final adapter = MockVideoCallAdapter();
      addTearDown(adapter.dispose);

      await adapter.connect(_ticket());
      await adapter.disconnect();
      await Future<void>.delayed(const Duration(seconds: 5));

      // Nếu timer không bị huỷ, state sẽ nhảy về `connected` ở đây.
      expect(adapter.state.value.status, VideoCallStatus.disconnected);
    });
  });

  group('VideoCallState', () {
    test('isLive chỉ đúng khi đã connected', () {
      const connected = VideoCallState(status: VideoCallStatus.connected);
      const connecting = VideoCallState(status: VideoCallStatus.connecting);
      const failed = VideoCallState(status: VideoCallStatus.failed);

      expect(connected.isLive, isTrue);
      expect(connecting.isLive, isFalse);
      expect(failed.isLive, isFalse);
    });

    test('copyWith giữ nguyên trường không truyền vào', () {
      const initial = VideoCallState(
        status: VideoCallStatus.connected,
        cameraEnabled: true,
        microphoneEnabled: true,
        remoteParticipantCount: 1,
      );

      final updated = initial.copyWith(cameraEnabled: false);

      expect(updated.cameraEnabled, isFalse);
      expect(updated.microphoneEnabled, isTrue);
      expect(updated.remoteParticipantCount, 1);
      expect(updated.status, VideoCallStatus.connected);
    });
  });
}
