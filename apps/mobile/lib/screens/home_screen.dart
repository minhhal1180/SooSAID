import 'package:flutter/material.dart';

import '../core/config.dart';
import '../core/location_service.dart';
import '../main.dart';
import '../state/app_state.dart';
import 'guidance_screen.dart';
import 'sos_active_screen.dart';

/// M02 – Màn hình chính.
///
/// Thiết kế theo một nguyên tắc duy nhất: **nút S.O.S phải là thứ dễ bấm nhất
/// trên màn hình**. Mọi chức năng khác (hướng dẫn, diễn tập, đăng xuất) đều nhỏ
/// hơn và đặt xa vùng ngón cái.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppStateScope.of(context);

    // Đang có ca hoạt động thì đưa thẳng vào màn hình theo dõi ca.
    if (state.hasActiveCase) return const SosActiveScreen();

    return Scaffold(
      appBar: AppBar(
        title: const Text('S.O.S Aid'),
        actions: <Widget>[
          IconButton(
            tooltip: 'Đăng xuất',
            icon: const Icon(Icons.logout),
            onPressed: () => state.logout(),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            children: <Widget>[
              if (state.lastFailure != SosFailureKind.none)
                _FailureFallback(
                  kind: state.lastFailure,
                  message: state.lastFailureMessage,
                ),

              Expanded(child: Center(child: _SosButton(state: state))),

              _LocationHint(state: state),
              const SizedBox(height: 16),

              Row(
                children: <Widget>[
                  Expanded(
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.menu_book_outlined),
                      label: const Text('Hướng dẫn'),
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(builder: (_) => const GuidanceScreen()),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.science_outlined),
                      label: const Text('Diễn tập'),
                      // Ca diễn tập được tách khỏi KPI thật ở báo cáo (TDD §8.2).
                      onPressed: () => state.triggerSos(isDrill: true),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                'Trong mọi tình huống nguy cấp, hãy gọi ${AppConfig.emergencyPhoneNumber}.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Nút S.O.S: vùng chạm lớn, phản hồi trạng thái rõ ràng, tự khoá sau khi bấm.
class _SosButton extends StatelessWidget {
  const _SosButton({required this.state});

  final AppState state;

  static const double _diameter = 220;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final disabled = state.sosInProgress || state.sosButtonLocked;

    return Semantics(
      button: true,
      label: 'Nút gửi yêu cầu cấp cứu khẩn cấp',
      child: GestureDetector(
        onTap: disabled ? null : () => state.triggerSos(),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          width: _diameter,
          height: _diameter,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: disabled ? scheme.surfaceContainerHighest : scheme.error,
            boxShadow: disabled
                ? null
                : <BoxShadow>[
                    BoxShadow(
                      color: scheme.error.withValues(alpha: 0.35),
                      blurRadius: 32,
                      spreadRadius: 4,
                    ),
                  ],
          ),
          child: Center(
            child: state.sosInProgress
                ? const CircularProgressIndicator(color: Colors.white)
                : Column(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(
                        'S.O.S',
                        style: TextStyle(
                          fontSize: 48,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 2,
                          color: disabled ? scheme.onSurfaceVariant : scheme.onError,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        disabled ? 'Vui lòng chờ…' : 'Nhấn để gọi hỗ trợ',
                        style: TextStyle(
                          color: disabled ? scheme.onSurfaceVariant : scheme.onError,
                        ),
                      ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}

/// Nhắc người dùng bổ sung thông tin khi GPS không sẵn sàng (TC-004, TC-005).
class _LocationHint extends StatelessWidget {
  const _LocationHint({required this.state});

  final AppState state;

  @override
  Widget build(BuildContext context) {
    final outcome = state.lastLocationOutcome;
    final needsManualInput = outcome == LocationOutcome.permissionDenied ||
        outcome == LocationOutcome.serviceDisabled ||
        outcome == LocationOutcome.unavailable;

    if (!needsManualInput && !state.locationIsLowAccuracy) {
      return const SizedBox.shrink();
    }

    return Card(
      color: Theme.of(context).colorScheme.secondaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              needsManualInput
                  ? 'Chưa lấy được vị trí'
                  : 'Vị trí chưa đủ chính xác',
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            const Text('Hãy mô tả nơi xảy ra sự cố để lực lượng y tế tìm được nhanh hơn.'),
            const SizedBox(height: 10),
            TextField(
              decoration: const InputDecoration(
                labelText: 'Địa chỉ / mốc nhận dạng',
                hintText: 'Ví dụ: Trường THPT X, sân sau, gần cổng phụ',
                border: OutlineInputBorder(),
                isDense: true,
              ),
              onChanged: state.setManualAddress,
            ),
            const SizedBox(height: 8),
            TextField(
              decoration: const InputDecoration(
                labelText: 'Lối vào (cổng, tầng, thang máy)',
                border: OutlineInputBorder(),
                isDense: true,
              ),
              onChanged: state.setAccessNote,
            ),
          ],
        ),
      ),
    );
  }
}

/// M09 – Màn hình dự phòng khi không tạo được ca.
///
/// TDD §12: tuyệt đối KHÔNG hiển thị "đã gửi" khi chưa chắc ca đã được tạo;
/// phải đưa ra hành động khẩn cấp trực tiếp.
class _FailureFallback extends StatelessWidget {
  const _FailureFallback({required this.kind, this.message});

  final SosFailureKind kind;
  final String? message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    final String headline = switch (kind) {
      SosFailureKind.offline => 'Không có kết nối mạng',
      SosFailureKind.serverError => 'Chưa gửi được yêu cầu',
      SosFailureKind.rejected => 'Cần bổ sung thông tin',
      SosFailureKind.none => '',
    };

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: scheme.errorContainer,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            headline,
            style: TextStyle(fontWeight: FontWeight.w700, color: scheme.onErrorContainer),
          ),
          const SizedBox(height: 4),
          Text(
            message ?? 'Yêu cầu của bạn CHƯA được gửi đi.',
            style: TextStyle(color: scheme.onErrorContainer),
          ),
          if (kind != SosFailureKind.rejected) ...<Widget>[
            const SizedBox(height: 10),
            Text(
              'Hãy gọi trực tiếp ${AppConfig.emergencyPhoneNumber} ngay bây giờ.',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 17,
                color: scheme.onErrorContainer,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
