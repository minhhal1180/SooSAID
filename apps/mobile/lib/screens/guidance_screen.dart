import 'package:flutter/material.dart';

import '../core/config.dart';
import '../main.dart';
import '../models/guidance.dart';

/// M06 + M09 – Hướng dẫn sơ cấp cứu, hoạt động cả khi mất mạng (SOS-051, TC-022).
///
/// Nội dung lấy từ cache cục bộ nên mở được ngay khi không có sóng. Mọi mục
/// chưa được chuyên gia y tế phê duyệt đều mang nhãn cảnh báo rõ ràng — trình
/// bày nội dung chưa kiểm duyệt như hướng dẫn chính thức là điều Rule 1.2 và
/// Rule 14 nghiêm cấm.
class GuidanceScreen extends StatelessWidget {
  const GuidanceScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppStateScope.of(context);
    final guides = state.guidance;

    return Scaffold(
      appBar: AppBar(title: const Text('Hướng dẫn sơ cấp cứu')),
      body: SafeArea(
        child: guides.isEmpty
            ? const _EmptyGuidance()
            : ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: guides.length + 1,
                itemBuilder: (context, index) {
                  if (index == 0) return const _CallFirstBanner();
                  return _GuidanceCard(guidance: guides[index - 1]);
                },
              ),
      ),
    );
  }
}

/// Nhắc gọi cấp cứu trước mọi hướng dẫn khác — đây luôn là bước đầu tiên.
class _CallFirstBanner extends StatelessWidget {
  const _CallFirstBanner();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: scheme.errorContainer,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: <Widget>[
          Icon(Icons.phone_in_talk, color: scheme.onErrorContainer),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              'Việc đầu tiên: gọi ${AppConfig.emergencyPhoneNumber}. '
              'Các hướng dẫn dưới đây chỉ hỗ trợ trong lúc chờ.',
              style: TextStyle(
                fontWeight: FontWeight.w600,
                color: scheme.onErrorContainer,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _GuidanceCard extends StatelessWidget {
  const _GuidanceCard({required this.guidance});

  final Guidance guidance;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Card(
      margin: const EdgeInsets.only(bottom: 14),
      child: ExpansionTile(
        title: Text(
          guidance.title,
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
        ),
        subtitle: guidance.summary == null ? null : Text(guidance.summary!),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        children: <Widget>[
          if (guidance.drillOnly)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.only(bottom: 12),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: scheme.tertiaryContainer,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                'Nội dung dùng cho diễn tập, chưa được chuyên gia y tế phê duyệt.',
                style: TextStyle(
                  color: scheme.onTertiaryContainer,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ...guidance.steps.map(
            (step) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  CircleAvatar(
                    radius: 14,
                    backgroundColor: scheme.primaryContainer,
                    child: Text(
                      '${step.order}',
                      style: TextStyle(
                        color: scheme.onPrimaryContainer,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  // Chữ lớn: người dùng cầm điện thoại cách xa hoặc tay đang bẩn.
                  Expanded(
                      child: Text(step.text,
                          style: const TextStyle(fontSize: 17))),
                ],
              ),
            ),
          ),
          if (guidance.disclaimer != null) ...<Widget>[
            const Divider(),
            Text(
              guidance.disclaimer!,
              style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
            ),
          ],
          const SizedBox(height: 6),
          Text(
            'Mã ${guidance.code} · phiên bản ${guidance.version}',
            style: TextStyle(fontSize: 12, color: scheme.outline),
          ),
        ],
      ),
    );
  }
}

class _EmptyGuidance extends StatelessWidget {
  const _EmptyGuidance();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          Icon(Icons.cloud_off, size: 48),
          SizedBox(height: 12),
          Text(
            'Chưa có nội dung hướng dẫn nào được tải về máy.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 17),
          ),
          SizedBox(height: 8),
          Text(
            'Hãy kết nối mạng một lần để tải nội dung, sau đó vẫn xem được khi mất sóng. '
            'Trong lúc này, gọi ${AppConfig.emergencyPhoneNumber} để được hướng dẫn trực tiếp.',
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
