/// 6 pha nghiệp vụ hiển thị cho người dân (Rule 7.1 / ADR-001).
///
/// Mobile CỐ Ý chỉ biết 6 pha này, không biết 12 trạng thái kỹ thuật: người
/// đang xử lý sự cố cần biết "đang ở bước nào", không cần biết ca đang ở
/// `HANDOVER_PENDING` hay `HANDED_OVER`.
enum CasePhase {
  created('CREATED', 'Đang khởi tạo yêu cầu'),
  alerted('ALERTED', 'Đã gửi cảnh báo'),
  connecting('CONNECTING', 'Đang kết nối người hỗ trợ'),
  videoSupport('VIDEO_SUPPORT', 'Đang được hỗ trợ'),
  handover('HANDOVER', 'Đang bàn giao cho lực lượng y tế'),
  completed('COMPLETED', 'Đã hoàn tất');

  const CasePhase(this.code, this.label);

  final String code;
  final String label;

  static CasePhase fromCode(String? code) {
    return CasePhase.values.firstWhere(
      (phase) => phase.code == code,
      orElse: () => CasePhase.created,
    );
  }

  /// Vị trí trong chuỗi 6 bước, để vẽ thanh tiến trình.
  int get stepIndex => CasePhase.values.indexOf(this);
}

class LocationSample {
  const LocationSample({
    required this.lat,
    required this.lng,
    required this.capturedAt,
    this.accuracyMeters,
    this.addressText,
    this.accessNote,
  });

  final double lat;
  final double lng;
  final String capturedAt;
  final double? accuracyMeters;
  final String? addressText;
  final String? accessNote;

  factory LocationSample.fromJson(Map<String, dynamic> json) {
    return LocationSample(
      lat: (json['lat'] as num).toDouble(),
      lng: (json['lng'] as num).toDouble(),
      capturedAt: json['capturedAt'] as String? ?? '',
      accuracyMeters: (json['accuracyMeters'] as num?)?.toDouble(),
      addressText: json['addressText'] as String?,
      accessNote: json['accessNote'] as String?,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'lat': lat,
        'lng': lng,
        'capturedAt': capturedAt,
        if (accuracyMeters != null) 'accuracyMeters': accuracyMeters,
        if (addressText != null) 'addressText': addressText,
        if (accessNote != null) 'accessNote': accessNote,
      };
}

/// Ảnh chụp trạng thái ca như server trả về.
///
/// Server là nguồn sự thật duy nhất: app KHÔNG tự suy ra pha kế tiếp, chỉ hiển
/// thị `phase` nhận được (FR-012).
class EmergencyCase {
  const EmergencyCase({
    required this.id,
    required this.code,
    required this.phase,
    required this.createdAt,
    this.latestLocation,
    this.accessNote,
    this.realtimeChannel,
  });

  final String id;

  /// Mã đọc được bằng lời qua điện thoại, ví dụ `SOS-20260913-000123`.
  final String code;
  final CasePhase phase;
  final String createdAt;
  final LocationSample? latestLocation;
  final String? accessNote;
  final String? realtimeChannel;

  bool get isFinished => phase == CasePhase.completed;

  factory EmergencyCase.fromJson(Map<String, dynamic> json) {
    final location = json['latestLocation'] as Map<String, dynamic>?;
    return EmergencyCase(
      id: json['id'] as String,
      code: json['code'] as String,
      phase: CasePhase.fromCode(json['phase'] as String?),
      createdAt: json['createdAt'] as String? ?? '',
      latestLocation:
          location == null ? null : LocationSample.fromJson(location),
      accessNote: json['accessNote'] as String?,
      realtimeChannel: json['realtimeChannel'] as String?,
    );
  }
}
