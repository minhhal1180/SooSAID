import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sos_aid_mobile/core/api_client.dart';
import 'package:sos_aid_mobile/core/offline_cache.dart';
import 'package:sos_aid_mobile/core/secure_store.dart';
import 'package:sos_aid_mobile/main.dart';
import 'package:sos_aid_mobile/state/app_state.dart';

void main() {
  testWidgets('mở thư viện offline trước đăng nhập không mất AppStateScope', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    SharedPreferences.setMockInitialValues(<String, Object>{});
    final cache = await OfflineCache.open();
    final state = AppState(
      apiClient: ApiClient(),
      cache: cache,
      secureStore: SecureStore(),
    )..authStage = AuthStage.loggedOut;

    await tester.pumpWidget(SosAidApp(appState: state));
    await tester.pumpAndSettle();

    expect(find.text('Xem video sơ cứu offline'), findsOneWidget);
    await tester.tap(find.text('Xem video sơ cứu offline'));
    await tester.pumpAndSettle();

    expect(find.text('Sơ cứu offline'), findsOneWidget);
    expect(find.text('Video có sẵn trên máy'), findsOneWidget);
    expect(tester.takeException(), isNull);

    state.dispose();
  });
}
