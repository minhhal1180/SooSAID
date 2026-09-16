import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../main.dart';
import '../models/profile.dart';

/// M08 (phần 2) – Người liên hệ khẩn cấp (FR-009, SOS-027).
///
/// Khi ca cấp cứu được tạo, hệ thống gửi thông báo cho những người ở đây theo
/// **opt-in từng kênh**. Nội dung thông báo cố ý tối thiểu — chỉ mã ca và lời
/// nhắc mở ứng dụng, không có vị trí hay tình trạng người bệnh (TDD §11.3).
class ContactsScreen extends StatelessWidget {
  const ContactsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppStateScope.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Người liên hệ khẩn cấp')),
      floatingActionButton: FloatingActionButton.extended(
        icon: const Icon(Icons.person_add_alt),
        label: const Text('Thêm'),
        onPressed: () => _showAddDialog(context),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            const _PrivacyNotice(),
            const SizedBox(height: 16),

            if (state.emergencyContacts.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: Center(
                  child: Text(
                    'Chưa có người liên hệ nào.\n'
                    'Thêm người thân để họ được báo khi bạn gửi yêu cầu S.O.S.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 16),
                  ),
                ),
              )
            else
              ...state.emergencyContacts.map(
                (contact) => _ContactTile(contact: contact),
              ),

            // Chừa chỗ cho FAB không che mục cuối.
            const SizedBox(height: 80),
          ],
        ),
      ),
    );
  }

  Future<void> _showAddDialog(BuildContext context) async {
    final nameController = TextEditingController();
    final phoneController = TextEditingController();
    final relationController = TextEditingController();
    final state = AppStateScope.of(context);

    final submitted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Thêm người liên hệ'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              TextField(
                controller: nameController,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(
                  labelText: 'Họ tên',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: phoneController,
                keyboardType: TextInputType.phone,
                inputFormatters: <TextInputFormatter>[
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9+]')),
                ],
                decoration: const InputDecoration(
                  labelText: 'Số điện thoại',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: relationController,
                decoration: const InputDecoration(
                  labelText: 'Quan hệ (tuỳ chọn)',
                  hintText: 'Ví dụ: con trai, vợ, hàng xóm',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Hủy'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Thêm'),
          ),
        ],
      ),
    );

    final name = nameController.text.trim();
    final phone = phoneController.text.trim();
    final relation = relationController.text.trim();

    nameController.dispose();
    phoneController.dispose();
    relationController.dispose();

    if (submitted != true || name.isEmpty || phone.isEmpty) return;

    final added = await state.addEmergencyContact(
      name: name,
      phone: phone,
      relation: relation.isEmpty ? null : relation,
    );

    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          added
              ? 'Đã thêm $name.'
              : (state.profileError ?? 'Không thêm được người liên hệ.'),
        ),
      ),
    );
  }
}

class _ContactTile extends StatelessWidget {
  const _ContactTile({required this.contact});

  final EmergencyContact contact;

  @override
  Widget build(BuildContext context) {
    final state = AppStateScope.of(context);

    return Card(
      child: ListTile(
        leading: CircleAvatar(child: Text(contact.priority.toString())),
        title: Text(contact.name),
        subtitle: Text(
          <String>[
            contact.phoneMasked,
            if (contact.relation != null && contact.relation!.isNotEmpty)
              contact.relation!,
            if (contact.notifyByPush) 'thông báo app',
            if (contact.notifyBySms) 'SMS',
          ].join(' · '),
        ),
        trailing: IconButton(
          icon: Icon(Icons.delete_outline,
              color: Theme.of(context).colorScheme.error),
          tooltip: 'Xoá',
          onPressed: () async {
            final confirmed = await showDialog<bool>(
              context: context,
              builder: (dialogContext) => AlertDialog(
                title: Text('Xoá ${contact.name}?'),
                content: const Text(
                  'Người này sẽ không được thông báo khi bạn gửi yêu cầu S.O.S nữa.',
                ),
                actions: <Widget>[
                  TextButton(
                    onPressed: () => Navigator.of(dialogContext).pop(false),
                    child: const Text('Giữ lại'),
                  ),
                  FilledButton(
                    onPressed: () => Navigator.of(dialogContext).pop(true),
                    child: const Text('Xoá'),
                  ),
                ],
              ),
            );

            if (confirmed == true) {
              await state.deleteEmergencyContact(contact.id);
            }
          },
        ),
      ),
    );
  }
}

class _PrivacyNotice extends StatelessWidget {
  const _PrivacyNotice();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(Icons.privacy_tip_outlined,
                  size: 18, color: scheme.onSurfaceVariant),
              const SizedBox(width: 6),
              Text(
                'Thông báo gửi đi gồm những gì',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Chỉ mã ca cấp cứu và lời nhắc mở ứng dụng. KHÔNG gửi vị trí, '
            'tình trạng sức khỏe hay hình ảnh qua thông báo.',
            style: TextStyle(color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}
