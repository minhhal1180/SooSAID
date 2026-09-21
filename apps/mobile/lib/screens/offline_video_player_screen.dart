import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../core/config.dart';
import '../core/emergency_dialer.dart';
import '../models/offline_video_guide.dart';

/// Trình phát video sơ cứu đóng gói sẵn trong app.
///
/// Không tự phát: trong tình huống căng thẳng, người dùng phải chủ động bấm
/// phát để tránh âm thanh/hình ảnh bất ngờ. Transcript luôn nằm ngay bên dưới
/// để nội dung vẫn dùng được nếu video codec lỗi hoặc người dùng không nghe rõ.
class OfflineVideoPlayerScreen extends StatefulWidget {
  const OfflineVideoPlayerScreen({super.key, required this.guide});

  final OfflineVideoGuide guide;

  @override
  State<OfflineVideoPlayerScreen> createState() =>
      _OfflineVideoPlayerScreenState();
}

class _OfflineVideoPlayerScreenState extends State<OfflineVideoPlayerScreen>
    with WidgetsBindingObserver {
  late final VideoPlayerController _controller;
  late final Future<void> _initializeFuture;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _controller = VideoPlayerController.asset(widget.guide.assetPath);
    _initializeFuture = _controller.initialize();
    _controller.addListener(_refreshControls);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) _controller.pause();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _controller
      ..removeListener(_refreshControls)
      ..dispose();
    super.dispose();
  }

  void _refreshControls() {
    if (mounted) setState(() {});
  }

  Future<void> _togglePlayback() async {
    if (_controller.value.isPlaying) {
      await _controller.pause();
      return;
    }
    if (_controller.value.position >= _controller.value.duration) {
      await _controller.seekTo(Duration.zero);
    }
    await _controller.play();
  }

  @override
  Widget build(BuildContext context) {
    final guide = widget.guide;
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: Text(guide.title)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
          children: <Widget>[
            Semantics(
              label: 'Video ${guide.title}',
              child: ClipRRect(
                borderRadius: BorderRadius.circular(20),
                child: ColoredBox(
                  color: const Color(0xFF4A1010),
                  child: FutureBuilder<void>(
                    future: _initializeFuture,
                    builder: (context, snapshot) {
                      if (snapshot.hasError) {
                        return const AspectRatio(
                          aspectRatio: 9 / 16,
                          child: _VideoUnavailable(),
                        );
                      }
                      if (snapshot.connectionState != ConnectionState.done) {
                        return const AspectRatio(
                          aspectRatio: 9 / 16,
                          child: Center(
                            child: CircularProgressIndicator(
                              color: Colors.white,
                            ),
                          ),
                        );
                      }
                      return AspectRatio(
                        aspectRatio: _controller.value.aspectRatio,
                        child: Stack(
                          alignment: Alignment.center,
                          children: <Widget>[
                            Positioned.fill(child: VideoPlayer(_controller)),
                            if (!_controller.value.isPlaying)
                              Semantics(
                                button: true,
                                label:
                                    _controller.value.position >=
                                        _controller.value.duration
                                    ? 'Xem lại video'
                                    : 'Phát video',
                                child: IconButton.filledTonal(
                                  tooltip:
                                      _controller.value.position >=
                                          _controller.value.duration
                                      ? 'Xem lại'
                                      : 'Phát video',
                                  onPressed: _togglePlayback,
                                  icon: Icon(
                                    _controller.value.position >=
                                            _controller.value.duration
                                        ? Icons.replay
                                        : Icons.play_arrow,
                                    size: 36,
                                  ),
                                  style: IconButton.styleFrom(
                                    minimumSize: const Size(64, 64),
                                    backgroundColor: scheme.surface.withValues(
                                      alpha: .9,
                                    ),
                                    foregroundColor: scheme.error,
                                  ),
                                ),
                              ),
                            Positioned(
                              left: 12,
                              right: 12,
                              bottom: 10,
                              child: VideoProgressIndicator(
                                _controller,
                                allowScrubbing: true,
                                padding: const EdgeInsets.symmetric(
                                  vertical: 10,
                                ),
                                colors: const VideoProgressColors(
                                  playedColor: Colors.white,
                                  bufferedColor: Colors.white38,
                                  backgroundColor: Colors.black38,
                                ),
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: <Widget>[
                _StatusChip(
                  icon: Icons.download_done,
                  label: 'Có sẵn offline',
                  color: scheme.primaryContainer,
                ),
                const SizedBox(width: 8),
                _StatusChip(
                  icon: Icons.closed_caption_outlined,
                  label: 'Có bản chữ',
                  color: scheme.secondaryContainer,
                ),
              ],
            ),
            const SizedBox(height: 16),
            if (guide.drillOnly) const _DraftWarning(),
            Text(
              'Các bước bằng chữ',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 10),
            ...guide.steps.indexed.map(
              (entry) => _TranscriptStep(number: entry.$1 + 1, text: entry.$2),
            ),
            const SizedBox(height: 12),
            Card(
              color: scheme.errorContainer,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Text(
                      'Ưu tiên liên hệ lực lượng y tế',
                      style: TextStyle(
                        color: scheme.onErrorContainer,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Video chỉ hỗ trợ bước đầu và không thay thế hướng dẫn '
                      'trực tiếp của nhân viên y tế.',
                      style: TextStyle(color: scheme.onErrorContainer),
                    ),
                    const SizedBox(height: 12),
                    FilledButton.icon(
                      onPressed: EmergencyDialer.callEmergencyNumber,
                      icon: const Icon(Icons.phone_in_talk),
                      label: const Text(
                        'Gọi ${AppConfig.emergencyPhoneNumber}',
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              '${guide.code} · phiên bản ${guide.version} · video không âm thanh',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

class _VideoUnavailable extends StatelessWidget {
  const _VideoUnavailable();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(Icons.video_file_outlined, color: Colors.white, size: 48),
            SizedBox(height: 10),
            Text(
              'Không mở được video trên thiết bị này. Hãy dùng các bước bằng chữ bên dưới.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white),
            ),
          ],
        ),
      ),
    );
  }
}

class _DraftWarning extends StatelessWidget {
  const _DraftWarning();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: 18),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: scheme.tertiaryContainer,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(Icons.science_outlined, color: scheme.onTertiaryContainer),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Bản diễn tập: chưa được chuyên gia y tế phê duyệt để sử dụng cho ca thật.',
              style: TextStyle(
                color: scheme.onTertiaryContainer,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _TranscriptStep extends StatelessWidget {
  const _TranscriptStep({required this.number, required this.text});

  final int number;
  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          CircleAvatar(
            radius: 16,
            backgroundColor: scheme.primaryContainer,
            foregroundColor: scheme.onPrimaryContainer,
            child: Text(
              '$number',
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 17))),
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({
    required this.icon,
    required this.label,
    required this.color,
  });

  final IconData icon;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Chip(
      avatar: Icon(icon, size: 18),
      label: Text(label),
      backgroundColor: color,
      side: BorderSide.none,
      visualDensity: VisualDensity.compact,
    );
  }
}
