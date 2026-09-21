import 'package:flutter/material.dart';

import '../core/config.dart';
import '../core/emergency_dialer.dart';
import '../main.dart';
import '../models/guidance.dart';
import '../models/offline_video_guide.dart';
import 'offline_video_player_screen.dart';

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
      appBar: AppBar(title: const Text('Sơ cứu offline')),
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
              children: <Widget>[
                const _CallFirstBanner(),
                const _OfflineLibraryHeader(),
                const SizedBox(height: 12),
                ...bundledOfflineVideoGuides.map(
                  (guide) => _OfflineVideoCard(guide: guide),
                ),
                const SizedBox(height: 18),
                Row(
                  children: <Widget>[
                    Expanded(
                      child: Text(
                        'Hướng dẫn bằng chữ',
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                    ),
                    if (state.guidanceSyncedAt != null)
                      Tooltip(
                        message: 'Đã lưu trên máy',
                        child: Icon(
                          Icons.cloud_done_outlined,
                          color: Theme.of(context).colorScheme.primary,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  guides.isEmpty
                      ? 'Chưa tải được nội dung từ máy chủ. Các video phía trên vẫn dùng được.'
                      : 'Nội dung đã tải được lưu trên máy để đọc khi mất mạng.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 12),
                if (guides.isEmpty)
                  const _EmptyGuidance()
                else
                  ...guides.map((guide) => _GuidanceCard(guidance: guide)),
              ],
            ),
          ),
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
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: scheme.errorContainer,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(Icons.phone_in_talk, color: scheme.onErrorContainer),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  'Nếu có thể, hãy gọi ${AppConfig.emergencyPhoneNumber} trước. '
                  'Các video chỉ hỗ trợ bước đầu trong lúc chờ.',
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: scheme.onErrorContainer,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: EmergencyDialer.callEmergencyNumber,
            icon: const Icon(Icons.call),
            label: const Text('Gọi ${AppConfig.emergencyPhoneNumber}'),
          ),
        ],
      ),
    );
  }
}

class _OfflineLibraryHeader extends StatelessWidget {
  const _OfflineLibraryHeader();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: <Widget>[
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                'Video có sẵn trên máy',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 2),
              Text(
                'Mở được ngay cả khi không có sóng điện thoại.',
                style: TextStyle(color: scheme.onSurfaceVariant),
              ),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: scheme.primaryContainer,
            borderRadius: BorderRadius.circular(999),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(
                Icons.download_done,
                size: 17,
                color: scheme.onPrimaryContainer,
              ),
              const SizedBox(width: 5),
              Text(
                'OFFLINE',
                style: TextStyle(
                  color: scheme.onPrimaryContainer,
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  letterSpacing: .4,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _OfflineVideoCard extends StatelessWidget {
  const _OfflineVideoCard({required this.guide});

  final OfflineVideoGuide guide;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Semantics(
      button: true,
      label:
          'Mở video ${guide.title}, dài ${guide.durationLabel}, có sẵn offline',
      child: Card(
        clipBehavior: Clip.antiAlias,
        margin: const EdgeInsets.only(bottom: 12),
        child: InkWell(
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => OfflineVideoPlayerScreen(guide: guide),
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: <Widget>[
                Container(
                  width: 72,
                  height: 72,
                  decoration: BoxDecoration(
                    color: scheme.errorContainer,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(
                    Icons.play_circle_fill,
                    size: 38,
                    color: scheme.error,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        guide.title,
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        guide.summary,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: scheme.onSurfaceVariant),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        '${guide.durationLabel} · Không cần mạng',
                        style: TextStyle(
                          color: scheme.primary,
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                const Icon(Icons.chevron_right),
              ],
            ),
          ),
        ),
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
                    child: Text(
                      step.text,
                      style: const TextStyle(fontSize: 17),
                    ),
                  ),
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
    return const Card(
      child: Padding(
        padding: EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(Icons.cloud_off_outlined, size: 40),
            SizedBox(height: 12),
            Text(
              'Chưa có hướng dẫn bằng chữ từ máy chủ.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
            ),
            SizedBox(height: 8),
            Text(
              'Khi có mạng, nội dung đã duyệt sẽ tự tải và được lưu lại. '
              'Bộ video offline phía trên vẫn luôn mở được.',
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
