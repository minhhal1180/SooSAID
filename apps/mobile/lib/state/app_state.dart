import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

import '../core/api_client.dart';
import '../core/config.dart';
import '../core/location_service.dart';
import '../core/offline_cache.dart';
import '../models/emergency_case.dart';
import '../models/guidance.dart';

/// Trạng thái toàn ứng dụng.
///
/// Dùng `ChangeNotifier` của Flutter thay vì một thư viện quản lý state bên
/// ngoài: phạm vi state ở đây nhỏ và Rule 14 yêu cầu không thêm dependency
/// không cần thiết.
enum AuthStage { unknown, loggedOut, awaitingOtp, loggedIn }

/// Vì sao ca không tạo được — quyết định màn hình dự phòng nào hiển thị.
enum SosFailureKind { none, offline, serverError, rejected }

class AppState extends ChangeNotifier {
  AppState({
    required ApiClient apiClient,
    required OfflineCache cache,
    LocationService? locationService,
  })  : _api = apiClient,
        _cache = cache,
        _location = locationService ?? LocationService();

  final ApiClient _api;
  final OfflineCache _cache;
  final LocationService _location;
  final Uuid _uuid = const Uuid();

  // --- Xác thực -------------------------------------------------------------
  AuthStage authStage = AuthStage.unknown;
  String pendingPhone = '';
  String? authError;

  // --- Ca đang hoạt động ----------------------------------------------------
  EmergencyCase? activeCase;
  bool sosInProgress = false;
  bool sosButtonLocked = false;
  SosFailureKind lastFailure = SosFailureKind.none;
  String? lastFailureMessage;

  // --- Vị trí ---------------------------------------------------------------
  LocationOutcome lastLocationOutcome = LocationOutcome.unavailable;
  LocationSample? lastLocation;

  /// Người dùng tự nhập khi không có GPS (TC-004).
  String manualAddress = '';
  String accessNote = '';

  // --- Nội dung ------------------------------------------------------------
  List<Guidance> guidance = const [];
  TriageQuestionnaire? questionnaire;
  final Map<String, String> triageAnswers = <String, String>{};

  Timer? _pollTimer;
  Timer? _lockTimer;
  StreamSubscription<LocationSample>? _locationSubscription;

  bool get hasActiveCase => activeCase != null && !activeCase!.isFinished;

  bool get locationIsLowAccuracy {
    final accuracy = lastLocation?.accuracyMeters;
    return accuracy != null && accuracy > AppConfig.lowAccuracyThresholdMeters;
  }

  // ==========================================================================
  // Khởi động
  // ==========================================================================

  Future<void> bootstrap() async {
    // Hướng dẫn đã cache hiển thị được ngay, kể cả khi chưa có mạng (TC-022).
    guidance = _cache.loadGuidance();

    final token = _cache.accessToken;
    if (token == null) {
      authStage = AuthStage.loggedOut;
      notifyListeners();
      return;
    }

    _api.setAccessToken(token);
    authStage = AuthStage.loggedIn;
    notifyListeners();

    await Future.wait<void>([
      _refreshGuidance(),
      _refreshQuestionnaire(),
      _restoreActiveCase(),
    ]);
  }

  // ==========================================================================
  // Xác thực bằng OTP
  // ==========================================================================

  Future<void> requestOtp(String phone) async {
    authError = null;
    pendingPhone = phone.trim();
    notifyListeners();

    try {
      await _api.post('/auth/otp/request', body: <String, dynamic>{'phone': pendingPhone});
      authStage = AuthStage.awaitingOtp;
    } on ApiException catch (error) {
      authError = error.message;
    }
    notifyListeners();
  }

  Future<void> verifyOtp(String otp) async {
    authError = null;
    notifyListeners();

    try {
      final data = await _api.post(
        '/auth/otp/verify',
        body: <String, dynamic>{'phone': pendingPhone, 'otp': otp.trim()},
      ) as Map<String, dynamic>;

      await _cache.saveTokens(
        accessToken: data['accessToken'] as String,
        refreshToken: data['refreshToken'] as String,
      );
      _api.setAccessToken(data['accessToken'] as String);
      authStage = AuthStage.loggedIn;

      await _registerDevice();
      await Future.wait<void>([_refreshGuidance(), _refreshQuestionnaire()]);
    } on ApiException catch (error) {
      authError = error.message;
    }
    notifyListeners();
  }

  Future<void> logout() async {
    _stopPolling();
    await _cache.clearSession();
    _api.setAccessToken(null);
    activeCase = null;
    authStage = AuthStage.loggedOut;
    notifyListeners();
  }

  /// Đăng ký thiết bị để nhận thông báo và để gắn `deviceId` vào ca.
  Future<void> _registerDevice() async {
    final deviceId = _cache.deviceId ?? _uuid.v4();
    await _cache.saveDeviceId(deviceId);

    try {
      await _api.post('/me/devices', body: <String, dynamic>{
        'deviceId': deviceId,
        'platform': defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android',
      });
    } on ApiException {
      // Không đăng ký được thiết bị thì vẫn dùng app bình thường; chỉ mất kênh
      // push. Không chặn người dùng vì lý do này.
    }
  }

  // ==========================================================================
  // Luồng S.O.S (Rule 7.2)
  // ==========================================================================

  /// Bấm nút S.O.S.
  ///
  /// Thứ tự bám đúng Rule 7.2: lấy vị trí best-effort (bước 3) rồi gọi API tạo
  /// ca (bước 1, 2, 4, 5) — server là bên sinh mã ca và phát cảnh báo.
  Future<void> triggerSos({bool isDrill = false}) async {
    if (sosInProgress || sosButtonLocked) return;

    sosInProgress = true;
    lastFailure = SosFailureKind.none;
    lastFailureMessage = null;
    _lockSosButton();
    notifyListeners();

    final locationResult = await _location.getBestEffortLocation();
    lastLocationOutcome = locationResult.outcome;
    lastLocation = locationResult.sample;
    notifyListeners();

    final deviceId = _cache.deviceId ?? _uuid.v4();
    await _cache.saveDeviceId(deviceId);

    // Vị trí thiếu KHÔNG chặn tạo ca (TC-004): gửi toạ độ 0,0 là sai lệch nguy
    // hiểm, nên khi không có GPS ta chỉ gửi mô tả bằng lời trong `addressText`.
    final sample = locationResult.sample;
    if (sample == null && manualAddress.trim().isEmpty) {
      sosInProgress = false;
      lastFailure = SosFailureKind.rejected;
      lastFailureMessage =
          'Chưa có vị trí. Hãy bật định vị hoặc nhập địa chỉ/mốc nhận dạng rồi thử lại.';
      notifyListeners();
      return;
    }

    try {
      final data = await _api.post(
        '/emergency-cases',
        // Idempotency-Key sinh MỘT LẦN cho lần bấm này: mọi retry mạng đều dùng
        // lại key đó nên không sinh ca thứ hai (FR-002, TC-002).
        idempotencyKey: _uuid.v4(),
        body: <String, dynamic>{
          'deviceId': deviceId,
          'triggerSource': isDrill ? 'drill' : 'sos_button',
          if (accessNote.trim().isNotEmpty) 'accessNote': accessNote.trim(),
          'location': <String, dynamic>{
            'lat': sample?.lat ?? 0,
            'lng': sample?.lng ?? 0,
            if (sample?.accuracyMeters != null) 'accuracyMeters': sample!.accuracyMeters,
            'capturedAt': sample?.capturedAt ?? DateTime.now().toUtc().toIso8601String(),
            if (manualAddress.trim().isNotEmpty) 'addressText': manualAddress.trim(),
            if (accessNote.trim().isNotEmpty) 'accessNote': accessNote.trim(),
          },
        },
      ) as Map<String, dynamic>;

      activeCase = EmergencyCase.fromJson(data);
      await _cache.saveActiveCaseId(activeCase!.id);
      _startPolling();
      _startLocationStream();
    } on ApiException catch (error) {
      // TDD §12: KHÔNG được hiển thị "đã gửi" khi chưa chắc ca đã được tạo.
      activeCase = null;
      lastFailure =
          error.isConnectivityProblem ? SosFailureKind.offline : SosFailureKind.serverError;
      lastFailureMessage = error.message;
    } finally {
      sosInProgress = false;
      notifyListeners();
    }
  }

  Future<void> cancelActiveCase(String reason) async {
    final current = activeCase;
    if (current == null) return;

    try {
      final data = await _api.post(
        '/emergency-cases/${current.id}/status',
        body: <String, dynamic>{'toStatus': 'CANCELLED', 'reason': reason},
      ) as Map<String, dynamic>;
      activeCase = EmergencyCase.fromJson(data);
    } on ApiException catch (error) {
      lastFailureMessage = error.message;
    }
    notifyListeners();
  }

  Future<void> submitTriage() async {
    final current = activeCase;
    final form = questionnaire;
    if (current == null || form == null || triageAnswers.isEmpty) return;

    try {
      await _api.post('/emergency-cases/${current.id}/triage', body: <String, dynamic>{
        'questionnaireVersion': form.version,
        'answers': triageAnswers.entries
            .map((entry) => <String, String>{'questionCode': entry.key, 'value': entry.value})
            .toList(),
      });
    } on ApiException catch (error) {
      lastFailureMessage = error.message;
      notifyListeners();
    }
  }

  void setTriageAnswer(String questionCode, String value) {
    triageAnswers[questionCode] = value;
    notifyListeners();
  }

  void setManualAddress(String value) {
    manualAddress = value;
    notifyListeners();
  }

  void setAccessNote(String value) {
    accessNote = value;
    notifyListeners();
  }

  // ==========================================================================
  // Đồng bộ trạng thái
  // ==========================================================================

  Future<void> _restoreActiveCase() async {
    final caseId = _cache.activeCaseId;
    if (caseId == null) return;

    try {
      final data = await _api.get('/emergency-cases/$caseId') as Map<String, dynamic>;
      final restored = EmergencyCase.fromJson(data);

      if (restored.isFinished) {
        await _cache.saveActiveCaseId(null);
      } else {
        activeCase = restored;
        _startPolling();
        _startLocationStream();
      }
    } on ApiException {
      // Không khôi phục được (mất mạng hoặc ca đã bị xoá): không hiển thị ca cũ
      // như đang hoạt động, vì đó là thông tin sai trong tình huống khẩn cấp.
      await _cache.saveActiveCaseId(null);
    }
    notifyListeners();
  }

  /// Lấy snapshot trạng thái ca theo chu kỳ.
  ///
  /// Server là nguồn sự thật (TDD §3.1); app không tự suy diễn pha kế tiếp.
  void _startPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(AppConfig.casePollInterval, (_) async {
      final current = activeCase;
      if (current == null) return;

      try {
        final data = await _api.get('/emergency-cases/${current.id}') as Map<String, dynamic>;
        activeCase = EmergencyCase.fromJson(data);

        if (activeCase!.isFinished) {
          _stopPolling();
          await _cache.saveActiveCaseId(null);
        }
        notifyListeners();
      } on ApiException {
        // Mất mạng tạm thời: giữ nguyên trạng thái đã biết và thử lại ở nhịp sau.
      }
    });
  }

  /// Gửi mẫu vị trí mới trong lúc ca đang hoạt động (FR-003).
  void _startLocationStream() {
    _locationSubscription?.cancel();

    DateTime lastSent = DateTime.fromMillisecondsSinceEpoch(0);
    _locationSubscription = _location.watchPosition().listen((sample) async {
      lastLocation = sample;
      notifyListeners();

      // Giới hạn nhịp gửi: mạng di động yếu ở hiện trường, gửi quá dày làm
      // nghẽn chính kênh đang cần cho video.
      final now = DateTime.now();
      if (now.difference(lastSent) < AppConfig.locationRefreshInterval) return;
      lastSent = now;

      final current = activeCase;
      if (current == null) return;

      try {
        await _api.post('/emergency-cases/${current.id}/location', body: sample.toJson());
      } on ApiException {
        // Mẫu vị trí rớt không phải lỗi nghiêm trọng; mẫu sau sẽ bù.
      }
    });
  }

  void _stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
    _locationSubscription?.cancel();
    _locationSubscription = null;
  }

  /// Khoá nút S.O.S trong ít giây sau khi bấm (TC-003).
  void _lockSosButton() {
    sosButtonLocked = true;
    _lockTimer?.cancel();
    _lockTimer = Timer(AppConfig.sosButtonLockDuration, () {
      sosButtonLocked = false;
      notifyListeners();
    });
  }

  // ==========================================================================
  // Nội dung
  // ==========================================================================

  Future<void> _refreshGuidance() async {
    try {
      final data = await _api.get('/first-aid-guides') as Map<String, dynamic>;
      final items = (data['items'] as List<dynamic>? ?? const [])
          .map((item) => Guidance.fromJson(item as Map<String, dynamic>))
          .toList();

      guidance = items;
      await _cache.saveGuidance(items);
      notifyListeners();
    } on ApiException {
      // Giữ nguyên bản cache — có hướng dẫn cũ vẫn hơn không có gì (TC-022).
    }
  }

  Future<void> _refreshQuestionnaire() async {
    try {
      final data = await _api.get('/triage/questionnaire') as Map<String, dynamic>;
      questionnaire = TriageQuestionnaire.fromJson(data);
      notifyListeners();
    } on ApiException {
      // Không có bộ câu hỏi thì bỏ qua bước phân loại, không chặn luồng S.O.S.
    }
  }

  @override
  void dispose() {
    _stopPolling();
    _lockTimer?.cancel();
    super.dispose();
  }
}
