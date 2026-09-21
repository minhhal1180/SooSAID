import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/config.dart';
import '../core/emergency_dialer.dart';
import '../main.dart';
import '../state/app_state.dart';
import 'guidance_screen.dart';

/// M01 – Đăng nhập bằng OTP (SOS-003).
///
/// Màn hình nói rõ ứng dụng KHÔNG thay thế 115 ngay từ lần mở đầu tiên: người
/// dùng phải hiểu đúng vai trò của ứng dụng trước khi cần đến nó (Rule 1.2).
class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final TextEditingController _phoneController = TextEditingController();
  final TextEditingController _otpController = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _phoneController.dispose();
    _otpController.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    await action();
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final state = AppStateScope.of(context);
    final awaitingOtp = state.authStage == AuthStage.awaitingOtp;

    return Scaffold(
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      Container(
                        width: 52,
                        height: 52,
                        decoration: BoxDecoration(
                          color: Theme.of(context).colorScheme.error,
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: const Icon(
                          Icons.monitor_heart_outlined,
                          color: Colors.white,
                          size: 30,
                        ),
                      ),
                      const SizedBox(width: 14),
                      const Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(
                              'S.O.S Aid',
                              style: TextStyle(
                                fontSize: 26,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            Text('Hỗ trợ sơ cấp cứu ngoài bệnh viện'),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  const _EmergencyAccessCard(),
                  const SizedBox(height: 18),
                  const _ScopeNotice(),
                  const SizedBox(height: 24),
                  Text(
                    awaitingOtp
                        ? 'Nhập mã xác thực'
                        : 'Đăng nhập để gửi yêu cầu',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 6),
                  Text(
                    awaitingOtp
                        ? 'Mã đã gửi tới ${_maskPhone(state.pendingPhone)}'
                        : 'Dùng số điện thoại để đồng bộ hồ sơ và kết nối tổng đài.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 14),
                  if (!awaitingOtp) ...<Widget>[
                    TextField(
                      controller: _phoneController,
                      keyboardType: TextInputType.phone,
                      textInputAction: TextInputAction.done,
                      autofillHints: const <String>[
                        AutofillHints.telephoneNumber,
                      ],
                      inputFormatters: <TextInputFormatter>[
                        FilteringTextInputFormatter.allow(RegExp(r'[0-9+]')),
                      ],
                      decoration: const InputDecoration(
                        labelText: 'Số điện thoại',
                        hintText: '0901234567',
                        prefixIcon: Icon(Icons.phone_outlined),
                      ),
                      onSubmitted: _busy
                          ? null
                          : (_) => _run(
                              () => state.requestOtp(_phoneController.text),
                            ),
                    ),
                    const SizedBox(height: 14),
                    FilledButton(
                      onPressed: _busy
                          ? null
                          : () => _run(
                              () => state.requestOtp(_phoneController.text),
                            ),
                      child: Text(_busy ? 'Đang gửi…' : 'Nhận mã xác thực'),
                    ),
                  ] else ...<Widget>[
                    TextField(
                      controller: _otpController,
                      keyboardType: TextInputType.number,
                      maxLength: 6,
                      autofocus: true,
                      autofillHints: const <String>[AutofillHints.oneTimeCode],
                      style: const TextStyle(fontSize: 26, letterSpacing: 7),
                      textAlign: TextAlign.center,
                      decoration: const InputDecoration(labelText: 'Mã 6 số'),
                      onSubmitted: _busy
                          ? null
                          : (_) => _run(
                              () => state.verifyOtp(_otpController.text),
                            ),
                    ),
                    const SizedBox(height: 6),
                    FilledButton(
                      onPressed: _busy
                          ? null
                          : () => _run(
                              () => state.verifyOtp(_otpController.text),
                            ),
                      child: Text(_busy ? 'Đang xác thực…' : 'Xác nhận'),
                    ),
                    TextButton(
                      onPressed: _busy
                          ? null
                          : () => _run(
                              () => state.requestOtp(state.pendingPhone),
                            ),
                      child: const Text('Gửi lại mã'),
                    ),
                  ],
                  if (state.authError != null) ...<Widget>[
                    const SizedBox(height: 14),
                    _ErrorBox(message: state.authError!),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// Chỉ hiển thị 3 số cuối – màn hình có thể bị người khác nhìn thấy (Rule 11).
  String _maskPhone(String phone) {
    final digits = phone.replaceAll(RegExp(r'\D'), '');
    return digits.length < 4
        ? '***'
        : '***${digits.substring(digits.length - 3)}';
  }
}

/// Hai hành động sống còn luôn dùng được trước đăng nhập và khi mất mạng.
class _EmergencyAccessCard extends StatelessWidget {
  const _EmergencyAccessCard();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Card(
      color: scheme.surfaceContainerLow,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(
              'Cần trợ giúp ngay?',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              'Không cần đăng nhập để gọi cấp cứu hoặc xem video đã lưu.',
              style: TextStyle(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: EmergencyDialer.callEmergencyNumber,
              style: FilledButton.styleFrom(
                backgroundColor: scheme.error,
                foregroundColor: scheme.onError,
              ),
              icon: const Icon(Icons.phone_in_talk),
              label: const Text('Gọi ${AppConfig.emergencyPhoneNumber}'),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const GuidanceScreen()),
              ),
              icon: const Icon(Icons.ondemand_video_outlined),
              label: const Text('Xem video sơ cứu offline'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Thông điệp phạm vi – hiển thị ở màn hình đầu tiên, không giấu trong điều khoản.
class _ScopeNotice extends StatelessWidget {
  const _ScopeNotice();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(Icons.info_outline, color: scheme.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Ứng dụng KHÔNG thay thế tổng đài 115',
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: scheme.onSurface,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'S.O.S Aid hỗ trợ kết nối và ghi nhận thông tin trong lúc chờ lực lượng y tế. '
            'Trong mọi tình huống nguy cấp, hãy gọi 115 hoặc số cấp cứu địa phương.',
            style: TextStyle(color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _ErrorBox extends StatelessWidget {
  const _ErrorBox({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: scheme.error),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(message, style: TextStyle(color: scheme.error)),
    );
  }
}
