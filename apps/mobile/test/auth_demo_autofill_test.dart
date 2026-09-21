import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sos_aid_mobile/core/api_client.dart';
import 'package:sos_aid_mobile/core/offline_cache.dart';
import 'package:sos_aid_mobile/core/secure_store.dart';
import 'package:sos_aid_mobile/main.dart';
import 'package:sos_aid_mobile/state/app_state.dart';

class _DemoApiClient extends ApiClient {
  @override
  Future<dynamic> post(String path, {Object? body, String? idempotencyKey}) async {
    if (path == '/auth/otp/request') {
      return <String, dynamic>{'accepted': true, 'delivery': 'in_app_demo', 'demoOtp': '654321'};
    }
    throw StateError('Unexpected request: $path');
  }
}

void main() {
  testWidgets('OTP diễn tập được thông báo và điền tự động', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    SharedPreferences.setMockInitialValues(<String, Object>{});
    final cache = await OfflineCache.open();
    final state = AppState(apiClient: _DemoApiClient(), cache: cache, secureStore: SecureStore())
      ..authStage = AuthStage.loggedOut;

    await tester.pumpWidget(SosAidApp(appState: state));
    await tester.enterText(find.byType(TextField).first, '+84900000001');
    final requestButton = find.text('Nhận mã xác thực');
    await tester.ensureVisible(requestButton);
    await tester.pumpAndSettle();
    await tester.tap(requestButton);
    await tester.pumpAndSettle();

    expect(find.text('Mã diễn tập đã được điền tự động'), findsOneWidget);
    final otpField = tester
        .widgetList<TextField>(find.byType(TextField))
        .singleWhere((field) => field.decoration?.labelText == 'Mã 6 số');
    expect(otpField.controller?.text, '654321');
    expect(find.text('Xác nhận'), findsOneWidget);

    state.dispose();
  });
}
