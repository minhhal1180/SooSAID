import 'livekit_video_adapter.dart';
import 'mock_video_adapter.dart';
import 'video_call_adapter.dart';

/// Chọn driver video theo đúng provider mà BACKEND báo về.
///
/// Điểm then chốt: client không tự quyết định. Response của
/// `POST /emergency-cases/{id}/video/session` mang trường `provider`, và client
/// dùng đúng driver tương ứng. Nhờ vậy hai đầu luôn khớp — backend đổi sang
/// LiveKit thật thì app tự dùng LiveKit mà không cần phát hành bản mới.
class VideoAdapterFactory {
  const VideoAdapterFactory._();

  static VideoCallAdapter create(String providerName) {
    return switch (providerName) {
      'livekit' => LiveKitVideoCallAdapter(),
      // Provider lạ (nhà cung cấp mới chưa hỗ trợ) rơi về mock thay vì crash:
      // trong tình huống cấp cứu, mất video còn hơn mất cả ứng dụng.
      _ => MockVideoCallAdapter(),
    };
  }
}
