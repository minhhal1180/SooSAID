/// Một bước trong hướng dẫn sơ cấp cứu.
class GuidanceStep {
  const GuidanceStep({required this.order, required this.text});

  final int order;
  final String text;

  factory GuidanceStep.fromJson(Map<String, dynamic> json) => GuidanceStep(
        order: (json['order'] as num?)?.toInt() ?? 0,
        text: json['text'] as String? ?? '',
      );

  Map<String, dynamic> toJson() => <String, dynamic>{'order': order, 'text': text};
}

/// Nội dung hướng dẫn đã version hoá (FR-010).
///
/// `drillOnly` là thông tin BẮT BUỘC hiển thị: nội dung chưa được chuyên gia y
/// tế phê duyệt phải được đánh dấu rõ trên giao diện, không được trình bày như
/// hướng dẫn chính thức (Rule 1.2, Rule 14).
class Guidance {
  const Guidance({
    required this.id,
    required this.code,
    required this.version,
    required this.title,
    required this.steps,
    required this.drillOnly,
    this.summary,
    this.disclaimer,
  });

  final String id;
  final String code;
  final int version;
  final String title;
  final List<GuidanceStep> steps;
  final bool drillOnly;
  final String? summary;
  final String? disclaimer;

  factory Guidance.fromJson(Map<String, dynamic> json) {
    final content = (json['content'] as Map<String, dynamic>?) ?? const {};
    final rawSteps = (content['steps'] as List<dynamic>?) ?? const [];

    return Guidance(
      id: json['id'] as String,
      code: json['code'] as String,
      version: (json['version'] as num?)?.toInt() ?? 1,
      title: json['title'] as String? ?? '',
      steps: rawSteps
          .map((step) => GuidanceStep.fromJson(step as Map<String, dynamic>))
          .toList()
        ..sort((a, b) => a.order.compareTo(b.order)),
      drillOnly: json['drillOnly'] as bool? ?? true,
      summary: content['summary'] as String?,
      disclaimer: content['disclaimer'] as String?,
    );
  }

  /// Dạng rút gọn để lưu offline (SOS-051).
  Map<String, dynamic> toCacheJson() => <String, dynamic>{
        'id': id,
        'code': code,
        'version': version,
        'title': title,
        'drillOnly': drillOnly,
        'content': <String, dynamic>{
          'summary': summary,
          'disclaimer': disclaimer,
          'steps': steps.map((step) => step.toJson()).toList(),
        },
      };
}

/// Một câu hỏi quan sát trong phiếu phân loại (FR-004).
class TriageQuestion {
  const TriageQuestion({
    required this.code,
    required this.label,
    required this.helpText,
    required this.allowedValues,
  });

  final String code;
  final String label;
  final String helpText;
  final List<String> allowedValues;

  factory TriageQuestion.fromJson(Map<String, dynamic> json) => TriageQuestion(
        code: json['code'] as String,
        label: json['label'] as String? ?? '',
        helpText: json['helpText'] as String? ?? '',
        allowedValues:
            ((json['allowedValues'] as List<dynamic>?) ?? const []).cast<String>(),
      );
}

class TriageQuestionnaire {
  const TriageQuestionnaire({
    required this.version,
    required this.title,
    required this.disclaimer,
    required this.questions,
  });

  final String version;
  final String title;
  final String disclaimer;
  final List<TriageQuestion> questions;

  factory TriageQuestionnaire.fromJson(Map<String, dynamic> json) => TriageQuestionnaire(
        version: json['version'] as String,
        title: json['title'] as String? ?? '',
        disclaimer: json['disclaimer'] as String? ?? '',
        questions: ((json['questions'] as List<dynamic>?) ?? const [])
            .map((question) => TriageQuestion.fromJson(question as Map<String, dynamic>))
            .toList(),
      );
}

/// Nhãn tiếng Việt cho giá trị câu trả lời.
const Map<String, String> triageAnswerLabels = <String, String>{
  'yes': 'Có',
  'no': 'Không',
  'unknown': 'Không rõ',
};
