import 'package:flutter/material.dart';

import '../core/config.dart';
import '../main.dart';
import '../models/emergency_case.dart';
import '../state/app_state.dart';
import 'guidance_screen.dart';
import 'triage_screen.dart';

/// M03 – Màn hình theo dõi ca đang hoạt động.
///
/// Ba thông tin quan trọng nhất, theo đúng thứ tự người dùng cần:
///   1. MÃ CA – để đọc qua điện thoại cho nhân viên y tế.
///   2. Đang ở bước nào – để biết đã có ai tiếp nhận chưa.
///   3. Việc cần làm tiếp – phiếu quan sát, hướng dẫn.
class SosActiveScreen extends StatelessWidget {
  const SosActiveScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppStateScope.of(context);
    final activeCase = state.activeCase;

    if (activeCase == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Yêu cầu đang xử lý')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: <Widget>[
            _CaseCodeCard(code: activeCase.code),
            const SizedBox(height: 20),

            _PhaseStepper(current: activeCase.phase),
            const SizedBox(height: 20),

            _LocationStatus(state: state),
            const SizedBox(height: 20),

            FilledButton.icon(
              icon: const Icon(Icons.fact_check_outlined),
              label: const Text('Trả lời câu hỏi quan sát'),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const TriageScreen()),
              ),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              icon: const Icon(Icons.menu_book_outlined),
              label: const Text('Xem hướng dẫn sơ cấp cứu'),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const GuidanceScreen()),
              ),
            ),

            const SizedBox(height: 28),
            const Divider(),
            const SizedBox(height: 8),

            // Hủy ca chỉ hợp lệ trước khi có người tiếp nhận (TDD §7.1). Sau đó
            // nút biến mất thay vì hiển thị rồi báo lỗi.
            if (activeCase.phase == CasePhase.created ||
                activeCase.phase == CasePhase.alerted)
              TextButton(
                onPressed: () => _confirmCancel(context, state),
                child: const Text('Tôi bấm nhầm, hủy yêu cầu'),
              ),

            Text(
              'Nếu tình trạng xấu đi hoặc chưa ai liên hệ, hãy gọi '
              '${AppConfig.emergencyPhoneNumber} ngay.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmCancel(BuildContext context, AppState state) async {
    final controller = TextEditingController();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Hủy yêu cầu cấp cứu?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Text('Chỉ hủy khi bạn chắc chắn không cần hỗ trợ y tế.'),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              decoration: const InputDecoration(
                labelText: 'Lý do hủy (bắt buộc)',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Giữ yêu cầu'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Xác nhận hủy'),
          ),
        ],
      ),
    );

    final reason = controller.text.trim();
    controller.dispose();

    if (confirmed == true && reason.isNotEmpty) {
      await state.cancelActiveCase(reason);
    }
  }
}

/// Mã ca: chữ to nhất màn hình vì đây là thứ người dùng phải đọc qua điện thoại.
class _CaseCodeCard extends StatelessWidget {
  const _CaseCodeCard({required this.code});

  final String code;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 16),
      decoration: BoxDecoration(
        color: scheme.primaryContainer,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: <Widget>[
          Text('MÃ CA CẤP CỨU', style: TextStyle(color: scheme.onPrimaryContainer)),
          const SizedBox(height: 6),
          SelectableText(
            code,
            style: TextStyle(
              fontSize: 26,
              fontWeight: FontWeight.w800,
              letterSpacing: 1.2,
              fontFamily: 'monospace',
              color: scheme.onPrimaryContainer,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Đọc mã này cho nhân viên y tế khi được hỏi',
            style: TextStyle(fontSize: 13, color: scheme.onPrimaryContainer),
          ),
        ],
      ),
    );
  }
}

/// Thanh 6 bước theo `CasePhase` (Rule 7.1 / ADR-001).
class _PhaseStepper extends StatelessWidget {
  const _PhaseStepper({required this.current});

  final CasePhase current;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text('Tiến trình xử lý', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 10),
        ...CasePhase.values.map((phase) {
          final isDone = phase.stepIndex < current.stepIndex;
          final isCurrent = phase == current;

          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 5),
            child: Row(
              children: <Widget>[
                Icon(
                  isDone
                      ? Icons.check_circle
                      : isCurrent
                          ? Icons.radio_button_checked
                          : Icons.radio_button_unchecked,
                  color: isDone || isCurrent ? scheme.primary : scheme.outlineVariant,
                  size: 24,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    phase.label,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: isCurrent ? FontWeight.w700 : FontWeight.w400,
                      color: isDone || isCurrent ? scheme.onSurface : scheme.outline,
                    ),
                  ),
                ),
              ],
            ),
          );
        }),
      ],
    );
  }
}

class _LocationStatus extends StatelessWidget {
  const _LocationStatus({required this.state});

  final AppState state;

  @override
  Widget build(BuildContext context) {
    final location = state.activeCase?.latestLocation ?? state.lastLocation;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                const Icon(Icons.location_on_outlined, size: 20),
                const SizedBox(width: 8),
                Text('Vị trí đã gửi', style: Theme.of(context).textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: 8),
            if (location == null)
              const Text('Chưa có toạ độ. Hãy mô tả vị trí khi được hỏi.')
            else ...<Widget>[
              Text(
                '${location.lat.toStringAsFixed(6)}, ${location.lng.toStringAsFixed(6)}',
                style: const TextStyle(fontFamily: 'monospace'),
              ),
              if (location.accuracyMeters != null)
                Text(
                  state.locationIsLowAccuracy
                      ? 'Sai số ±${location.accuracyMeters!.round()} m – độ chính xác thấp'
                      : 'Sai số ±${location.accuracyMeters!.round()} m',
                  style: TextStyle(
                    color: state.locationIsLowAccuracy
                        ? Theme.of(context).colorScheme.error
                        : null,
                  ),
                ),
            ],
            if (state.accessNote.trim().isNotEmpty) ...<Widget>[
              const SizedBox(height: 6),
              Text('Lối vào: ${state.accessNote}'),
            ],
          ],
        ),
      ),
    );
  }
}
