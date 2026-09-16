import 'package:flutter/material.dart';

import '../main.dart';
import '../models/profile.dart';
import 'contacts_screen.dart';
import 'history_screen.dart';

/// M08 – Hồ sơ sức khỏe khẩn cấp (FR-011).
///
/// Điểm quan trọng nhất của màn hình này là **công tắc đồng ý chia sẻ**. Nó
/// không phải một tuỳ chọn thông thường: tắt nghĩa là server sẽ KHÔNG gắn hồ sơ
/// vào ca cấp cứu (TC-015). Giao diện nói rõ hệ quả của cả hai lựa chọn, và mặc
/// định là TẮT — im lặng không phải đồng ý.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final TextEditingController _bloodTypeController = TextEditingController();
  final TextEditingController _allergiesController = TextEditingController();
  final TextEditingController _conditionsController = TextEditingController();
  final TextEditingController _medicationsController = TextEditingController();
  final TextEditingController _noteController = TextEditingController();

  bool _consent = false;
  bool _loaded = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await AppStateScope.of(context).loadProfile();
      if (mounted) _populateFromState();
    });
  }

  @override
  void dispose() {
    _bloodTypeController.dispose();
    _allergiesController.dispose();
    _conditionsController.dispose();
    _medicationsController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  void _populateFromState() {
    final profile = AppStateScope.of(context).emergencyProfile;
    if (profile == null) return;

    _bloodTypeController.text = profile.bloodType ?? '';
    _allergiesController.text = profile.allergies.join(', ');
    _conditionsController.text = profile.chronicConditions.join(', ');
    _medicationsController.text = profile.medications.join(', ');
    _noteController.text = profile.specialNote ?? '';
    setState(() {
      _consent = profile.consentShareInEmergency;
      _loaded = true;
    });
  }

  /// Người dùng nhập danh sách bằng dấu phẩy — cách nhập nhanh nhất trên điện
  /// thoại, thay vì bắt thêm/xoá từng dòng.
  List<String> _parseList(TextEditingController controller) {
    return controller.text
        .split(',')
        .map((item) => item.trim())
        .where((item) => item.isNotEmpty)
        .toList();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final state = AppStateScope.of(context);

    final saved = await state.saveEmergencyProfile(
      EmergencyProfile(
        bloodType: _bloodTypeController.text.trim().isEmpty
            ? null
            : _bloodTypeController.text.trim(),
        allergies: _parseList(_allergiesController),
        chronicConditions: _parseList(_conditionsController),
        medications: _parseList(_medicationsController),
        specialNote: _noteController.text.trim().isEmpty
            ? null
            : _noteController.text.trim(),
        consentShareInEmergency: _consent,
      ),
    );

    if (!mounted) return;
    setState(() => _saving = false);

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(saved
            ? 'Đã lưu hồ sơ sức khỏe.'
            : (state.profileError ?? 'Lưu thất bại.')),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = AppStateScope.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Hồ sơ của tôi')),
      body: SafeArea(
        child: state.profileLoading && !_loaded
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.all(16),
                children: <Widget>[
                  _AccountCard(profile: state.userProfile),
                  const SizedBox(height: 16),
                  _ConsentCard(
                    consent: _consent,
                    onChanged: (value) => setState(() => _consent = value),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'Thông tin sức khỏe',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Tất cả đều tự nguyện. Chỉ khai những gì bạn muốn nhân viên y tế '
                    'biết trong tình huống khẩn cấp.',
                    style: TextStyle(fontSize: 14),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _bloodTypeController,
                    decoration: const InputDecoration(
                      labelText: 'Nhóm máu',
                      hintText: 'Ví dụ: O, A, B, AB',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  _ListField(
                    controller: _allergiesController,
                    label: 'Dị ứng',
                    hint: 'Ngăn cách bằng dấu phẩy',
                  ),
                  const SizedBox(height: 12),
                  _ListField(
                    controller: _conditionsController,
                    label: 'Bệnh nền',
                    hint: 'Ngăn cách bằng dấu phẩy',
                  ),
                  const SizedBox(height: 12),
                  _ListField(
                    controller: _medicationsController,
                    label: 'Thuốc đang dùng',
                    hint: 'Ngăn cách bằng dấu phẩy',
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _noteController,
                    maxLines: 3,
                    maxLength: 2000,
                    decoration: const InputDecoration(
                      labelText: 'Lưu ý đặc biệt',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  if (state.profileError != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(
                        state.profileError!,
                        style: TextStyle(
                            color: Theme.of(context).colorScheme.error),
                      ),
                    ),
                  FilledButton(
                    onPressed: _saving ? null : () => _save(),
                    child: Text(_saving ? 'Đang lưu…' : 'Lưu hồ sơ'),
                  ),
                  const SizedBox(height: 24),
                  const Divider(),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.contacts_outlined),
                    title: const Text('Người liên hệ khẩn cấp'),
                    subtitle: Text('${state.emergencyContacts.length} người'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                          builder: (_) => const ContactsScreen()),
                    ),
                  ),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.history),
                    title: const Text('Lịch sử yêu cầu của tôi'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                          builder: (_) => const HistoryScreen()),
                    ),
                  ),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(Icons.logout,
                        color: Theme.of(context).colorScheme.error),
                    title: Text(
                      'Đăng xuất',
                      style:
                          TextStyle(color: Theme.of(context).colorScheme.error),
                    ),
                    onTap: () async {
                      await state.logout();
                      if (context.mounted) Navigator.of(context).pop();
                    },
                  ),
                ],
              ),
      ),
    );
  }
}

class _AccountCard extends StatelessWidget {
  const _AccountCard({required this.profile});

  final UserProfile? profile;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: const Icon(Icons.person_outline, size: 32),
        title: Text(profile?.fullName ?? 'Chưa đặt tên'),
        // Chỉ hiển thị 3 số cuối, kể cả cho chính chủ (Rule 11).
        subtitle: Text('Số điện thoại: ${profile?.phoneMasked ?? '***'}'),
      ),
    );
  }
}

/// Công tắc đồng ý chia sẻ – phần quan trọng nhất của màn hình.
class _ConsentCard extends StatelessWidget {
  const _ConsentCard({required this.consent, required this.onChanged});

  final bool consent;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Card(
      color: consent ? scheme.primaryContainer : scheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: consent,
              onChanged: onChanged,
              title: const Text(
                'Chia sẻ hồ sơ khi có ca cấp cứu',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
            // Nói rõ hệ quả của CẢ HAI lựa chọn, không chỉ khen lựa chọn "bật".
            Text(
              consent
                  ? 'Khi bạn gửi yêu cầu S.O.S, nhân viên y tế đang xử lý ca sẽ xem được '
                      'thông tin bên dưới. Mỗi lần xem đều được ghi nhật ký.'
                  : 'Hiện KHÔNG chia sẻ. Thông tin bên dưới chỉ mình bạn thấy và sẽ không '
                      'được gửi kèm ca cấp cứu.',
              style: TextStyle(
                color: consent
                    ? scheme.onPrimaryContainer
                    : scheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ListField extends StatelessWidget {
  const _ListField({
    required this.controller,
    required this.label,
    required this.hint,
  });

  final TextEditingController controller;
  final String label;
  final String hint;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        border: const OutlineInputBorder(),
      ),
    );
  }
}
