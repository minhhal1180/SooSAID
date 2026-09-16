/// Hồ sơ tài khoản (M08).
///
/// `phoneMasked`: server chỉ trả 3 số cuối, kể cả cho chính chủ (Rule 11) —
/// màn hình điện thoại có thể bị người khác nhìn thấy trong tình huống khẩn cấp.
class UserProfile {
  const UserProfile({
    required this.id,
    required this.roles,
    this.phoneMasked,
    this.fullName,
    this.locale = 'vi-VN',
  });

  final String id;
  final List<String> roles;
  final String? phoneMasked;
  final String? fullName;
  final String locale;

  factory UserProfile.fromJson(Map<String, dynamic> json) => UserProfile(
        id: json['id'] as String,
        roles: ((json['roles'] as List<dynamic>?) ?? const <dynamic>[])
            .cast<String>(),
        phoneMasked: json['phoneMasked'] as String?,
        fullName: json['fullName'] as String?,
        locale: json['locale'] as String? ?? 'vi-VN',
      );
}

/// Hồ sơ sức khỏe khẩn cấp tự nguyện khai báo (FR-011).
///
/// `consentShareInEmergency` là cốt lõi: **false nghĩa là server KHÔNG gắn hồ sơ
/// này vào ca cấp cứu** (TC-015). Giao diện phải nói rõ hệ quả của việc tắt/bật,
/// không được trình bày như một tuỳ chọn vô thưởng vô phạt.
class EmergencyProfile {
  const EmergencyProfile({
    this.bloodType,
    this.allergies = const <String>[],
    this.chronicConditions = const <String>[],
    this.medications = const <String>[],
    this.preferredFacility,
    this.specialNote,
    this.consentShareInEmergency = false,
    this.version = 0,
  });

  final String? bloodType;
  final List<String> allergies;
  final List<String> chronicConditions;
  final List<String> medications;
  final String? preferredFacility;
  final String? specialNote;
  final bool consentShareInEmergency;

  /// Tăng mỗi lần lưu; ca cũ tham chiếu đúng phiên bản đã dùng lúc đó.
  final int version;

  bool get isEmpty =>
      (bloodType == null || bloodType!.isEmpty) &&
      allergies.isEmpty &&
      chronicConditions.isEmpty &&
      medications.isEmpty &&
      (specialNote == null || specialNote!.isEmpty);

  factory EmergencyProfile.fromJson(Map<String, dynamic> json) =>
      EmergencyProfile(
        bloodType: json['bloodType'] as String?,
        allergies: _stringList(json['allergies']),
        chronicConditions: _stringList(json['chronicConditions']),
        medications: _stringList(json['medications']),
        preferredFacility: json['preferredFacility'] as String?,
        specialNote: json['specialNote'] as String?,
        consentShareInEmergency:
            json['consentShareInEmergency'] as bool? ?? false,
        version: (json['version'] as num?)?.toInt() ?? 0,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'bloodType': bloodType,
        'allergies': allergies,
        'chronicConditions': chronicConditions,
        'medications': medications,
        'preferredFacility': preferredFacility,
        'specialNote': specialNote,
        'consentShareInEmergency': consentShareInEmergency,
      };

  EmergencyProfile copyWith({
    String? bloodType,
    List<String>? allergies,
    List<String>? chronicConditions,
    List<String>? medications,
    String? preferredFacility,
    String? specialNote,
    bool? consentShareInEmergency,
  }) {
    return EmergencyProfile(
      bloodType: bloodType ?? this.bloodType,
      allergies: allergies ?? this.allergies,
      chronicConditions: chronicConditions ?? this.chronicConditions,
      medications: medications ?? this.medications,
      preferredFacility: preferredFacility ?? this.preferredFacility,
      specialNote: specialNote ?? this.specialNote,
      consentShareInEmergency:
          consentShareInEmergency ?? this.consentShareInEmergency,
      version: version,
    );
  }

  static List<String> _stringList(Object? value) {
    if (value is! List) return const <String>[];
    return value.whereType<String>().toList();
  }
}

/// Người liên hệ khẩn cấp (FR-009).
class EmergencyContact {
  const EmergencyContact({
    required this.id,
    required this.name,
    required this.phoneMasked,
    this.relation,
    this.priority = 1,
    this.notifyByPush = true,
    this.notifyBySms = true,
  });

  final String id;
  final String name;

  /// Server chỉ trả dạng che; app không bao giờ có số đầy đủ của người liên hệ.
  final String phoneMasked;
  final String? relation;
  final int priority;
  final bool notifyByPush;
  final bool notifyBySms;

  factory EmergencyContact.fromJson(Map<String, dynamic> json) =>
      EmergencyContact(
        id: json['id'] as String,
        name: json['name'] as String? ?? '',
        phoneMasked: json['phoneMasked'] as String? ?? '***',
        relation: json['relation'] as String?,
        priority: (json['priority'] as num?)?.toInt() ?? 1,
        notifyByPush: json['notifyByPush'] as bool? ?? true,
        notifyBySms: json['notifyBySms'] as bool? ?? true,
      );
}
