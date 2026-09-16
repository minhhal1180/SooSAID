import 'package:flutter/material.dart';

import 'core/api_client.dart';
import 'core/offline_cache.dart';
import 'core/secure_store.dart';
import 'screens/auth_screen.dart';
import 'screens/home_screen.dart';
import 'state/app_state.dart';

/// Điểm khởi động ứng dụng S.O.S Aid dành cho người dân.
///
/// Màn hình theo TDD §8.1: M01 Auth, M02 Home, M03 SOS Active, M04 Triage,
/// M06 Guidance, M08 Profile, M09 Offline.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final cache = await OfflineCache.open();
  final apiClient = ApiClient();
  final appState = AppState(
    apiClient: apiClient,
    cache: cache,
    // Token nằm trong Keychain/EncryptedSharedPreferences, tách khỏi cache
    // thường — xem ghi chú trong SecureStore.
    secureStore: SecureStore(),
  );

  // Nạp phiên và nội dung cache TRƯỚC khi vẽ giao diện, để người dùng không
  // thấy màn hình đăng nhập nhấp nháy rồi mới vào màn hình chính.
  await appState.bootstrap();

  runApp(SosAidApp(appState: appState));
}

class SosAidApp extends StatelessWidget {
  const SosAidApp({super.key, required this.appState});

  final AppState appState;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'S.O.S Aid',
      debugShowCheckedModeBanner: false,
      theme: _buildTheme(),
      home: AppStateScope(
        state: appState,
        child: ListenableBuilder(
          listenable: appState,
          builder: (context, _) {
            return switch (appState.authStage) {
              AuthStage.unknown => const _SplashScreen(),
              AuthStage.loggedOut ||
              AuthStage.awaitingOtp =>
                const AuthScreen(),
              AuthStage.loggedIn => const HomeScreen(),
            };
          },
        ),
      ),
    );
  }

  /// Giao diện cho tình huống khẩn cấp: chữ lớn, tương phản cao, vùng chạm rộng
  /// (TDD §8.1 M04 – "large tap targets").
  ThemeData _buildTheme() {
    const seed = Color(0xFFD32F2F);

    return ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: seed),
      textTheme: const TextTheme(
        bodyLarge: TextStyle(fontSize: 17, height: 1.45),
        bodyMedium: TextStyle(fontSize: 16, height: 1.45),
        titleLarge: TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
      ),
    );
  }
}

/// Cấp `AppState` xuống toàn bộ cây widget mà không cần thư viện ngoài.
class AppStateScope extends InheritedNotifier<AppState> {
  const AppStateScope(
      {super.key, required AppState state, required super.child})
      : super(notifier: state);

  static AppState of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AppStateScope>();
    assert(scope != null, 'AppStateScope không tồn tại phía trên widget này');
    return scope!.notifier!;
  }
}

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: Center(child: CircularProgressIndicator()));
  }
}
