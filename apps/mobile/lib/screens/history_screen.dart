import 'package:flutter/material.dart';

import '../main.dart';
import '../models/emergency_case.dart';

/// M10 – Lịch sử yêu cầu của chính người dùng.
///
/// Chỉ hiển thị **tóm tắt**: mã ca, thời điểm, pha kết thúc. Không có nhật ký y
/// tế, không có video, không có xuất dữ liệu (TDD §8.1 M10: "no unrestricted
/// media export"). Người dùng cần bằng chứng đã từng gửi yêu cầu, không cần bản
/// sao hồ sơ chuyên môn.
class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      AppStateScope.of(context).loadCaseHistory();
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = AppStateScope.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Lịch sử yêu cầu')),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: state.loadCaseHistory,
          child: state.historyLoading && state.caseHistory.isEmpty
              ? const Center(child: CircularProgressIndicator())
              : state.caseHistory.isEmpty
                  ? ListView(
                      // ListView (không phải Center) để kéo-để-làm-mới vẫn hoạt
                      // động khi danh sách rỗng.
                      children: const <Widget>[
                        SizedBox(height: 120),
                        Center(
                          child: Padding(
                            padding: EdgeInsets.all(24),
                            child: Text(
                              'Bạn chưa từng gửi yêu cầu nào.',
                              style: TextStyle(fontSize: 16),
                            ),
                          ),
                        ),
                      ],
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: state.caseHistory.length,
                      itemBuilder: (context, index) =>
                          _HistoryTile(item: state.caseHistory[index]),
                    ),
        ),
      ),
    );
  }
}

class _HistoryTile extends StatelessWidget {
  const _HistoryTile({required this.item});

  final EmergencyCase item;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final createdAt = DateTime.tryParse(item.createdAt)?.toLocal();

    return Card(
      child: ListTile(
        leading: Icon(
          item.isFinished ? Icons.check_circle_outline : Icons.pending_outlined,
          color: item.isFinished ? scheme.outline : scheme.error,
        ),
        title: Text(
          item.code,
          style: const TextStyle(
              fontFamily: 'monospace', fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          <String>[
            if (createdAt != null) _formatDateTime(createdAt),
            item.phase.label,
          ].join(' · '),
        ),
      ),
    );
  }

  String _formatDateTime(DateTime value) {
    String two(int number) => number.toString().padLeft(2, '0');
    return '${two(value.day)}/${two(value.month)}/${value.year} '
        '${two(value.hour)}:${two(value.minute)}';
  }
}
