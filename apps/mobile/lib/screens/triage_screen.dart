import 'package:flutter/material.dart';

import '../main.dart';
import '../models/guidance.dart';
import '../state/app_state.dart';

/// M04 – Phiếu ghi nhận dấu hiệu quan sát được (FR-004, SOS-013).
///
/// Ba quy tắc giao diện, đều bắt nguồn từ yêu cầu nghiệp vụ:
///  - MỘT câu hỏi mỗi màn hình cuộn, vùng chạm lớn: người đang run tay vẫn bấm được.
///  - Luôn có lựa chọn "Không rõ": ép chọn có/không sẽ tạo ra dữ liệu sai.
///  - Nhắc rõ đây là ghi nhận quan sát, KHÔNG phải chẩn đoán (Rule 1.2).
class TriageScreen extends StatelessWidget {
  const TriageScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppStateScope.of(context);
    final questionnaire = state.questionnaire;

    return Scaffold(
      appBar: AppBar(title: const Text('Dấu hiệu quan sát được')),
      body: questionnaire == null
          ? const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'Chưa tải được bộ câu hỏi. Bạn vẫn có thể mô tả trực tiếp cho nhân viên trực.',
                  textAlign: TextAlign.center,
                ),
              ),
            )
          : _QuestionList(state: state, questionnaire: questionnaire),
      bottomNavigationBar: questionnaire == null
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: FilledButton(
                  onPressed: state.triageAnswers.isEmpty
                      ? null
                      : () async {
                          await state.submitTriage();
                          if (context.mounted) Navigator.of(context).pop();
                        },
                  child: Text('Gửi ${state.triageAnswers.length} câu trả lời'),
                ),
              ),
            ),
    );
  }
}

class _QuestionList extends StatelessWidget {
  const _QuestionList({required this.state, required this.questionnaire});

  final AppState state;
  final TriageQuestionnaire questionnaire;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(questionnaire.disclaimer),
        ),
        const SizedBox(height: 16),

        ...questionnaire.questions.map((question) {
          final selected = state.triageAnswers[question.code];

          return Card(
            margin: const EdgeInsets.only(bottom: 14),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    question.label,
                    style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
                  ),
                  if (question.helpText.isNotEmpty) ...<Widget>[
                    const SizedBox(height: 4),
                    Text(
                      question.helpText,
                      style: TextStyle(fontSize: 14, color: scheme.onSurfaceVariant),
                    ),
                  ],
                  const SizedBox(height: 12),
                  Row(
                    children: question.allowedValues.map((value) {
                      final isSelected = selected == value;

                      return Expanded(
                        child: Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: SizedBox(
                            // Vùng chạm cao 52px – ngón tay run vẫn bấm trúng.
                            height: 52,
                            child: isSelected
                                ? FilledButton(
                                    onPressed: () =>
                                        state.setTriageAnswer(question.code, value),
                                    child: Text(triageAnswerLabels[value] ?? value),
                                  )
                                : OutlinedButton(
                                    onPressed: () =>
                                        state.setTriageAnswer(question.code, value),
                                    child: Text(triageAnswerLabels[value] ?? value),
                                  ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                ],
              ),
            ),
          );
        }),
      ],
    );
  }
}
