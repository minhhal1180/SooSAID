import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

import '../core/api_client.dart';
import '../core/config.dart';
import '../core/location_service.dart';
import '../core/offline_cache.dart';
import '../core/secure_store.dart';
import '../core/video/video_call_adapter.dart';
import '../models/emergency_case.dart';
import '../models/guidance.dart';
import '../models/profile.dart';

/// Trạng thái toàn ứng dụng.
///
/// Dùng `ChangeNotifier` của Flutter thay vì thư viện quản lý state bên ngoài:
/// phạm vi state ở đây nhỏ và Rule 14 yêu cầu không thêm dependency thừa.
enum AuthStage { unknown, loggedOut, awaitingOtp, loggedIn }

/// Vì sao ca không tạo được — quyết định màn hình dự phòng nào hiển thị.
enum SosFailureKind { none, offline, serverError, rejected }

/// Điểm hỗ trợ tại chỗ quanh hiện trường (M07).
class NearbyResource {
  const NearbyResource({
    required this.id,
    required this.resourceType,
    required this.name,
    required this.lat,
    required this.lng,
    required this.distanceMeters,
    this.accessInstruction,
  });

  final String id;
  final String resourceType;
  final String name;
  final double lat;
  final double lng;
  final int distanceMeters;
  final String? accessInstruction;

  factory NearbyResource.fromJson(Map<String, dynamic> json) {
    final location = (json['location'] as Map<String, dynamic>?) ??
        const <String, dynamic>{};
    return NearbyResource(
      id: json['id'] as String,
      resourceType: json['resourceType'] as String? ?? '',
      name: json['name'] as String? ?? '',
      lat: (location['lat'] as num?)?.toDouble() ?? 0,
      lng: (location['lng'] as num?)?.toDouble() ?? 0,
      distanceMeters: (json['distanceMeters'] as num?)?.toInt() ?? 0,
      accessInstruction: json['accessInstruction'] as String?,
    );
  }
}

class AppState extends ChangeNotifier {
  AppState({
    required ApiClient apiClient,
    required OfflineCache cache,
    required SecureStore secureStore,
    LocationService? locationService,
  })  : _api = apiClient,
        _cache = cache,
        _secureStore = secureStore,
        _location = locationService ?? LocationService();

  final ApiClient _api;
  final OfflineCache _cache;
  final SecureStore _secureStore;
  final LocationService _location;
  final Uuid _uuid = const Uuid();

  // --- Xác thực -------------------------------------------------------------
  AuthStage authStage = AuthStage.unknown;
  String pendingPhone = '';
  String? authError;
  /// Chỉ có ở môi trường diễn tập và đúng số demo; không lưu xuống thiết bị.
  String? demoOtp;

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
  List<Guidance> guidance = const <Guidance>[];
  DateTime? guidanceSyncedAt;
  TriageQuestionnaire? questionnaire;
  final Map<String, String> triageAnswers = <String, String>{};

  // --- Hồ sơ (M08) ----------------------------------------------------------
  UserProfile? userProfile;
  EmergencyProfile? emergencyProfile;
  List<EmergencyContact> emergencyContacts = const <EmergencyContact>[];
  bool profileLoading = false;
  String? profileError;

  // --- Lịch sử ca (M10) -----------------------------------------------------
  List<EmergencyCase> caseHistory = const <EmergencyCase>[];
  bool historyLoading = false;

  // --- Bản đồ và điểm hỗ trợ (M07) -----------------------------------------
  List<NearbyResource> nearbyResources = const <NearbyResource>[];

  /// `approximate` khi backend chạy driver memory (ADR-004) — UI phải nói rõ.
  String nearbySpatialAccuracy = 'exact';

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
    guidanceSyncedAt = _cache.guidanceSyncedAt;

    final token = await _secureStore.readAccessToken();
    if (token == null) {
      authStage = AuthStage.loggedOut;
      notifyListeners();
      return;
    }

    _api.setAccessToken(token);
    authStage = AuthStage.loggedIn;
    notifyListeners();

    await Future.wait<void>(<Future<void>>[
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
    demoOtp = null;
    pendingPhone = phone.trim();
    notifyListeners();

    try {
      final data = await _api.post(
        '/auth/otp/request',
        body: <String, dynamic>{'phone': pendingPhone},
      ) as Map<String, dynamic>;
      demoOtp = data['demoOtp'] as String?;
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

      await _secureStore.saveTokens(
        accessToken: data['accessToken'] as String,
        refreshToken: data['refreshToken'] as String,
      );
      _api.setAccessToken(data['accessToken'] as String);
      demoOtp = null;
      authStage = AuthStage.loggedIn;

      await _registerDevice();
      await Future.wait<void>(<Future<void>>[
        _refreshGuidance(),
        _refreshQuestionnaire(),
      ]);
    } on ApiException catch (error) {
      authError = error.message;
    }
    notifyListeners();
  }

  Future<void> logout() async {
    _stopPolling();
    await _secureStore.clear();
    await _cache.clearSession();
    _api.setAccessToken(null);

    activeCase = null;
    demoOtp = null;
    userProfile = null;
    emergencyProfile = null;
    emergencyContacts = const <EmergencyContact>[];
    caseHistory = const <EmergencyCase>[];
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
        'platform':
            defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android',
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

    // Vị trí thiếu KHÔNG chặn tạo ca (TC-004), nhưng gửi toạ độ 0,0 là sai lệch
    // nguy hiểm — nên khi không có GPS, bắt buộc phải có mô tả bằng lời.
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
            if (sample?.accuracyMeters != null)
              'accuracyMeters': sample!.accuracyMeters,
            'capturedAt':
                sample?.capturedAt ?? DateTime.now().toUtc().toIso8601String(),
            if (manualAddress.trim().isNotEmpty)
              'addressText': manualAddress.trim(),
            if (accessNote.trim().isNotEmpty) 'accessNote': accessNote.trim(),
          },
        },
      ) as Map<String, dynamic>;

      activeCase = EmergencyCase.fromJson(data);
      await _cache.saveActiveCaseId(activeCase!.id);
      _startPolling();
      _startLocationStream();
      unawaited(refreshNearbyResources());
    } on ApiException catch (error) {
      // TDD §12: KHÔNG được hiển thị "đã gửi" khi chưa chắc ca đã được tạo.
      activeCase = null;
      lastFailure = error.isConnectivityProblem
          ? SosFailureKind.offline
          : SosFailureKind.serverError;
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
      await _api.post('/emergency-cases/${current.id}/triage',
          body: <String, dynamic>{
            'questionnaireVersion': form.version,
            'answers': triageAnswers.entries
                .map((entry) => <String, String>{
                      'questionCode': entry.key,
                      'value': entry.value
                    })
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
  // Video (M05)
  // ==========================================================================

  /// Xin vé tham gia phòng video từ backend.
  ///
  /// Trả `null` khi provider không khả dụng — màn hình video khi đó phải hiển
  /// thị phương án thoại thay vì quay vòng chờ (FR-007, TC-009).
  Future<VideoJoinTicket?> requestVideoTicket() async {
    final current = activeCase;
    if (current == null) return null;

    try {
      final data = await _api.post(
        '/emergency-cases/${current.id}/video/session',
        body: const <String, dynamic>{},
      ) as Map<String, dynamic>;
      return VideoJoinTicket.fromJson(data);
    } on ApiException catch (error) {
      lastFailureMessage = error.message;
      notifyListeners();
      return null;
    }
  }

  Future<void> endVideoSession() async {
    final current = activeCase;
    if (current == null) return;

    try {
      await _api.delete('/emergency-cases/${current.id}/video/session');
    } on ApiException {
      // Rời phòng phía client là đủ; phiên trên server sẽ tự đóng.
    }
  }

  // ==========================================================================
  // Bản đồ và điểm hỗ trợ (M07)
  // ==========================================================================

  Future<void> refreshNearbyResources() async {
    final location = activeCase?.latestLocation ?? lastLocation;
    if (location == null) return;

    try {
      final data = await _api.get(
        '/resources/nearby?lat=${location.lat}&lng=${location.lng}'
        '&radiusMeters=${AppConfig.nearbyResourceRadiusMeters}',
      ) as Map<String, dynamic>;

      nearbyResources = ((data['items'] as List<dynamic>?) ?? const <dynamic>[])
          .map((item) => NearbyResource.fromJson(item as Map<String, dynamic>))
          .toList();
      nearbySpatialAccuracy = data['spatialAccuracy'] as String? ?? 'exact';
      notifyListeners();
    } on ApiException {
      // Mất danh sách điểm hỗ trợ không chặn luồng ca (TDD §12).
    }
  }

  // ==========================================================================
  // Hồ sơ (M08)
  // ==========================================================================

  Future<void> loadProfile() async {
    profileLoading = true;
    profileError = null;
    notifyListeners();

    try {
      final results = await Future.wait<Object?>(<Future<Object?>>[
        _api.get('/me'),
        _api.get('/me/emergency-profile'),
        _api.get('/me/emergency-contacts'),
      ]);

      userProfile = UserProfile.fromJson(results[0]! as Map<String, dynamic>);

      final profileJson = results[1] as Map<String, dynamic>?;
      emergencyProfile = profileJson == null
          ? const EmergencyProfile()
          : EmergencyProfile.fromJson(profileJson);

      final contactsJson = results[2]! as Map<String, dynamic>;
      emergencyContacts = ((contactsJson['items'] as List<dynamic>?) ??
              const <dynamic>[])
          .map(
              (item) => EmergencyContact.fromJson(item as Map<String, dynamic>))
          .toList();
    } on ApiException catch (error) {
      profileError = error.message;
    } finally {
      profileLoading = false;
      notifyListeners();
    }
  }

  Future<bool> saveEmergencyProfile(EmergencyProfile profile) async {
    profileError = null;
    notifyListeners();

    try {
      final data = await _api.put(
        '/me/emergency-profile',
        body: profile.toJson(),
      ) as Map<String, dynamic>;
      emergencyProfile = EmergencyProfile.fromJson(data);
      notifyListeners();
      return true;
    } on ApiException catch (error) {
      profileError = error.message;
      notifyListeners();
      return false;
    }
  }

  Future<bool> addEmergencyContact({
    required String name,
    required String phone,
    String? relation,
  }) async {
    profileError = null;
    notifyListeners();

    try {
      await _api.post('/me/emergency-contacts', body: <String, dynamic>{
        'name': name.trim(),
        'phone': phone.trim(),
        if (relation != null && relation.trim().isNotEmpty)
          'relation': relation.trim(),
      });
      await loadProfile();
      return true;
    } on ApiException catch (error) {
      profileError = error.message;
      notifyListeners();
      return false;
    }
  }

  Future<bool> deleteEmergencyContact(String contactId) async {
    try {
      await _api.delete('/me/emergency-contacts/$contactId');
      await loadProfile();
      return true;
    } on ApiException catch (error) {
      profileError = error.message;
      notifyListeners();
      return false;
    }
  }

  // ==========================================================================
  // Lịch sử ca (M10)
  // ==========================================================================

  Future<void> loadCaseHistory() async {
    historyLoading = true;
    notifyListeners();

    try {
      final data = await _api.get('/emergency-cases/mine') as List<dynamic>;
      caseHistory = data
          .map((item) => EmergencyCase.fromJson(item as Map<String, dynamic>))
          .toList();
    } on ApiException {
      // Giữ nguyên danh sách cũ; màn hình hiển thị thông báo mất kết nối.
    } finally {
      historyLoading = false;
      notifyListeners();
    }
  }

  // ==========================================================================
  // Đồng bộ trạng thái
  // ==========================================================================

  Future<void> _restoreActiveCase() async {
    final caseId = _cache.activeCaseId;
    if (caseId == null) return;

    try {
      final data =
          await _api.get('/emergency-cases/$caseId') as Map<String, dynamic>;
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
        final data = await _api.get('/emergency-cases/${current.id}')
            as Map<String, dynamic>;
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
        await _api.post('/emergency-cases/${current.id}/location',
            body: sample.toJson());
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
      final items = ((data['items'] as List<dynamic>?) ?? const <dynamic>[])
          .map((item) => Guidance.fromJson(item as Map<String, dynamic>))
          .toList();

      guidance = items;
      await _cache.saveGuidance(items);
      guidanceSyncedAt = _cache.guidanceSyncedAt;
      notifyListeners();
    } on ApiException {
      // Giữ nguyên bản cache — có hướng dẫn cũ vẫn hơn không có gì (TC-022).
    }
  }

  Future<void> _refreshQuestionnaire() async {
    try {
      final data =
          await _api.get('/triage/questionnaire') as Map<String, dynamic>;
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
