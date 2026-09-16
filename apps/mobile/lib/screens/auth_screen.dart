import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../main.dart';
import '../state/app_state.dart';

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
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              const SizedBox(height: 24),
              Text('S.O.S Aid', style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 4),
              const Text('Hỗ trợ sơ cấp cứu ngoài bệnh viện'),
              const SizedBox(height: 20),

              const _ScopeNotice(),
              const SizedBox(height: 24),

              if (!awaitingOtp) ...<Widget>[
                TextField(
                  controller: _phoneController,
                  keyboardType: TextInputType.phone,
                  inputFormatters: <TextInputFormatter>[
                    FilteringTextInputFormatter.allow(RegExp(r'[0-9+]')),
                  ],
                  decoration: const InputDecoration(
                    labelText: 'Số điện thoại',
                    hintText: '0901234567',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _busy
                      ? null
                      : () => _run(() => state.requestOtp(_phoneController.text)),
                  child: Text(_busy ? 'Đang gửi…' : 'Nhận mã xác thực'),
                ),
              ] else ...<Widget>[
                Text('Mã xác thực đã được gửi tới ${_maskPhone(state.pendingPhone)}'),
                const SizedBox(height: 16),
                TextField(
                  controller: _otpController,
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                  style: const TextStyle(fontSize: 28, letterSpacing: 8),
                  textAlign: TextAlign.center,
                  decoration: const InputDecoration(
                    labelText: 'Mã 6 số',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 8),
                FilledButton(
                  onPressed:
                      _busy ? null : () => _run(() => state.verifyOtp(_otpController.text)),
                  child: Text(_busy ? 'Đang xác thực…' : 'Xác nhận'),
                ),
                TextButton(
                  onPressed: _busy
                      ? null
                      : () => _run(() => state.requestOtp(state.pendingPhone)),
                  child: const Text('Gửi lại mã'),
                ),
              ],

              if (state.authError != null) ...<Widget>[
                const SizedBox(height: 16),
                _ErrorBox(message: state.authError!),
              ],
            ],
          ),
        ),
      ),
    );
  }

  /// Chỉ hiển thị 3 số cuối – màn hình có thể bị người khác nhìn thấy (Rule 11).
  String _maskPhone(String phone) {
    final digits = phone.replaceAll(RegExp(r'\D'), '');
    return digits.length < 4 ? '***' : '***${digits.substring(digits.length - 3)}';
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
        color: scheme.errorContainer,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(Icons.info_outline, color: scheme.onErrorContainer),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Ứng dụng KHÔNG thay thế tổng đài 115',
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: scheme.onErrorContainer,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'S.O.S Aid hỗ trợ kết nối và ghi nhận thông tin trong lúc chờ lực lượng y tế. '
            'Trong mọi tình huống nguy cấp, hãy gọi 115 hoặc số cấp cứu địa phương.',
            style: TextStyle(color: scheme.onErrorContainer),
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
