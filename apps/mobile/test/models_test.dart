import 'package:flutter_test/flutter_test.dart';
import 'package:sos_aid_mobile/models/emergency_case.dart';
import 'package:sos_aid_mobile/models/guidance.dart';
import 'package:sos_aid_mobile/models/profile.dart';

/// Test cho tầng model: đây là nơi dữ liệu từ server biến thành đối tượng app
/// dùng, nên lỗi ở đây hiển thị sai thông tin y tế trên màn hình.
void main() {
  group('CasePhase (Rule 7.1 / ADR-001)', () {
    test('ánh xạ đúng từ mã server', () {
      expect(CasePhase.fromCode('ALERTED'), CasePhase.alerted);
      expect(CasePhase.fromCode('VIDEO_SUPPORT'), CasePhase.videoSupport);
      expect(CasePhase.fromCode('COMPLETED'), CasePhase.completed);
    });

    test('mã lạ rơi về CREATED thay vì crash', () {
      // Server có thể thêm pha mới trước khi app được cập nhật; app cũ phải
      // hiển thị được thứ gì đó thay vì văng giữa lúc cấp cứu.
      expect(CasePhase.fromCode('PHA_MOI_CHUA_BIET'), CasePhase.created);
      expect(CasePhase.fromCode(null), CasePhase.created);
    });

    test('thứ tự 6 bước đúng để vẽ thanh tiến trình', () {
      expect(CasePhase.created.stepIndex, 0);
      expect(CasePhase.alerted.stepIndex, 1);
      expect(CasePhase.connecting.stepIndex, 2);
      expect(CasePhase.videoSupport.stepIndex, 3);
      expect(CasePhase.handover.stepIndex, 4);
      expect(CasePhase.completed.stepIndex, 5);
    });

    test('mọi pha đều có nhãn tiếng Việt', () {
      for (final phase in CasePhase.values) {
        expect(phase.label, isNotEmpty);
      }
    });
  });

  group('EmergencyCase', () {
    test('đọc được response đầy đủ của server', () {
      final emergencyCase = EmergencyCase.fromJson(<String, dynamic>{
        'id': 'case-1',
        'code': 'SOS-20260913-000123',
        'phase': 'ALERTED',
        'createdAt': '2026-09-13T08:00:00.000Z',
        'accessNote': 'Cong chinh, tang 2',
        'realtimeChannel': 'case:case-1',
        'latestLocation': <String, dynamic>{
          'lat': 21.021,
          'lng': 105.841,
          'accuracyMeters': 12,
          'capturedAt': '2026-09-13T08:00:00.000Z',
        },
      });

      expect(emergencyCase.code, 'SOS-20260913-000123');
      expect(emergencyCase.phase, CasePhase.alerted);
      expect(emergencyCase.latestLocation?.lat, closeTo(21.021, 1e-9));
      expect(emergencyCase.isFinished, isFalse);
    });

    test('ca không có toạ độ vẫn parse được (TC-004)', () {
      final emergencyCase = EmergencyCase.fromJson(<String, dynamic>{
        'id': 'case-2',
        'code': 'SOS-20260913-000124',
        'phase': 'CREATED',
        'createdAt': '2026-09-13T08:00:00.000Z',
      });

      expect(emergencyCase.latestLocation, isNull);
    });

    test('mọi pha kết thúc đều tính là đã xong', () {
      for (final code in <String>['COMPLETED']) {
        final emergencyCase = EmergencyCase.fromJson(<String, dynamic>{
          'id': 'case-3',
          'code': 'SOS-20260913-000125',
          'phase': code,
          'createdAt': '2026-09-13T08:00:00.000Z',
        });
        expect(emergencyCase.isFinished, isTrue);
      }
    });
  });

  group('Guidance', () {
    test('sắp xếp các bước theo đúng thứ tự dù server trả lộn xộn', () {
      final guidance = Guidance.fromJson(<String, dynamic>{
        'id': 'g-1',
        'code': 'GUIDE-CALL-115',
        'version': 1,
        'title': 'Goi ho tro y te khan cap',
        'drillOnly': true,
        'content': <String, dynamic>{
          'summary': 'Buoc dau tien',
          'steps': <dynamic>[
            <String, dynamic>{'order': 3, 'text': 'Giu may'},
            <String, dynamic>{'order': 1, 'text': 'Goi 115'},
            <String, dynamic>{'order': 2, 'text': 'Noi ro dia chi'},
          ],
        },
      });

      expect(guidance.steps.map((step) => step.order), <int>[1, 2, 3]);
      expect(guidance.steps.first.text, 'Goi 115');
    });

    test('mặc định drillOnly=true khi server không nói rõ', () {
      // Mặc định an toàn: coi nội dung là CHƯA duyệt thì UI sẽ cảnh báo, còn
      // mặc định ngược lại sẽ trình bày nội dung chưa kiểm duyệt như chính thức.
      final guidance = Guidance.fromJson(<String, dynamic>{
        'id': 'g-2',
        'code': 'GUIDE-X',
        'version': 1,
        'title': 'X',
        'content': <String, dynamic>{},
      });

      expect(guidance.drillOnly, isTrue);
    });

    test('vòng đời cache giữ nguyên nội dung (TC-022)', () {
      final original = Guidance.fromJson(<String, dynamic>{
        'id': 'g-3',
        'code': 'GUIDE-OBSERVE',
        'version': 2,
        'title': 'Ghi nhan dau hieu',
        'drillOnly': false,
        'content': <String, dynamic>{
          'summary': 'Tom tat',
          'disclaimer': 'Khong chan doan',
          'steps': <dynamic>[
            <String, dynamic>{'order': 1, 'text': 'Quan sat'},
          ],
        },
      });

      final restored = Guidance.fromJson(original.toCacheJson());

      expect(restored.code, original.code);
      expect(restored.version, original.version);
      expect(restored.drillOnly, original.drillOnly);
      expect(restored.steps.single.text, 'Quan sat');
      expect(restored.disclaimer, 'Khong chan doan');
    });
  });

  group('EmergencyProfile (TC-015)', () {
    test('mặc định KHÔNG đồng ý chia sẻ', () {
      expect(const EmergencyProfile().consentShareInEmergency, isFalse);

      final fromEmptyJson = EmergencyProfile.fromJson(<String, dynamic>{});
      expect(fromEmptyJson.consentShareInEmergency, isFalse);
    });

    test('giữ nguyên dữ liệu qua vòng serialize', () {
      const profile = EmergencyProfile(
        bloodType: 'O',
        allergies: <String>['penicillin'],
        chronicConditions: <String>['hen suyen'],
        medications: <String>['ventolin'],
        specialNote: 'Mang theo ong hit',
        consentShareInEmergency: true,
      );

      final restored = EmergencyProfile.fromJson(profile.toJson());

      expect(restored.bloodType, 'O');
      expect(restored.allergies, <String>['penicillin']);
      expect(restored.consentShareInEmergency, isTrue);
    });

    test('bỏ qua phần tử không phải chuỗi trong danh sách', () {
      final profile = EmergencyProfile.fromJson(<String, dynamic>{
        'allergies': <dynamic>['penicillin', 42, null],
      });

      expect(profile.allergies, <String>['penicillin']);
    });

    test('isEmpty phản ánh đúng hồ sơ chưa khai báo gì', () {
      expect(const EmergencyProfile().isEmpty, isTrue);
      expect(const EmergencyProfile(bloodType: 'A').isEmpty, isFalse);
    });
  });

  group('EmergencyContact', () {
    test('chỉ nhận số điện thoại dạng che từ server (Rule 11)', () {
      final contact = EmergencyContact.fromJson(<String, dynamic>{
        'id': 'c-1',
        'name': 'Nguyen Van A',
        'phoneMasked': '***567',
        'relation': 'con trai',
      });

      expect(contact.phoneMasked, '***567');
      // Model cố ý KHÔNG có trường số điện thoại đầy đủ.
      expect(contact.name, 'Nguyen Van A');
    });
  });
}
