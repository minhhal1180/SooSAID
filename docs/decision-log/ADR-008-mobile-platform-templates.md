# ADR-008 – Không commit `ios/` và `android/`; sinh lại từ template

- **Status:** Accepted
- **Date:** 2026-09-16

## Bối cảnh

Dự án Flutter thường commit cả `ios/` và `android/`. Hai thư mục này chứa project
Xcode (`project.pbxproj`) và Gradle do `flutter create` sinh ra theo đúng phiên
bản Flutter đang dùng.

Ba vấn đề gặp phải khi commit chúng:

1. **Xung đột merge liên miên.** `project.pbxproj` là file phẳng với id sinh ngẫu
   nhiên; hai người thêm plugin cùng lúc gần như chắc chắn xung đột, và giải
   xung đột bằng tay rất dễ tạo project hỏng.
2. **Lệch phiên bản.** Nâng Flutter lên bản mới thường kèm thay đổi trong project
   nền tảng. Nếu thư mục đã commit từ bản cũ, lỗi biểu hiện lúc build với thông
   điệp khó lần.
3. **`flutter create` ghi đè.** Chạy lại để sửa thư mục hỏng sẽ **xoá mất**
   `Info.plist` và `AndroidManifest.xml` đã tuỳ chỉnh — mất toàn bộ khai báo
   quyền, và app sẽ crash khi xin quyền camera trên thiết bị thật.

## Quyết định

`ios/` và `android/` **không được commit** (đã thêm vào `.gitignore`). Nguồn sự
thật của cấu hình nền tảng nằm ở `apps/mobile/tool/platform/`:

```
tool/
├── platform/
│   ├── ios/
│   │   ├── Info.plist           Chuỗi quyền, ATS, background mode, export compliance
│   │   ├── Podfile              iOS 13.0 + macro PERMISSION_* của permission_handler
│   │   └── ExportOptions.plist  Mẫu; Team ID được thay lúc sinh
│   └── android/
│       └── AndroidManifest.xml  Quyền + khối <queries> cho scheme tel:
├── bootstrap_platforms.sh       macOS / Linux / Git Bash
└── bootstrap_platforms.ps1      Windows
```

Script làm đúng hai bước, theo đúng thứ tự đó:

1. `flutter create --platforms=ios,android .` — sinh project nền tảng đúng phiên
   bản Flutter hiện tại.
2. Copy đè các file cấu hình của dự án lên bản mặc định.

Chạy lại bao nhiêu lần cũng cho cùng kết quả. CI gọi chính script này trước khi
build, nên cấu hình trên máy lập trình viên và trên CI không thể lệch nhau.

## Hai chi tiết dễ bị bỏ sót, đều gây hậu quả nặng

**Macro `PERMISSION_*` trong Podfile.** Không khai báo thì `permission_handler`
biên dịch kèm **mọi** loại quyền — danh bạ, ảnh, HealthKit, Bluetooth. Apple đọc
binary, thấy app xin quyền mà `Info.plist` không giải thích, và **từ chối bản
nộp**. Podfile của dự án bật đúng 3 quyền và tắt tường minh phần còn lại.

**`ITSAppUsesNonExemptEncryption = false`.** Thiếu dòng này, mỗi lần nộp
TestFlight sẽ treo ở câu hỏi export compliance chờ người trả lời thủ công — CI
đứng im mà không báo lỗi gì.

## Hệ quả

- ✅ Không còn xung đột merge trên file project nền tảng.
- ✅ Cấu hình quyền được review như code, trong file nhỏ và đọc được.
- ✅ Nâng Flutter chỉ cần chạy lại script.
- ⚠️ Lập trình viên **phải chạy bootstrap một lần** sau khi clone, nếu không
  `flutter run` sẽ báo thiếu thư mục nền tảng. Đã ghi ở đầu `apps/mobile/README.md`.
- ⚠️ Tuỳ chỉnh Xcode làm trực tiếp trong IDE (thêm capability, đổi icon) sẽ **mất
  khi chạy lại script**. Mọi tuỳ chỉnh cần giữ phải đưa vào `tool/platform/`.
