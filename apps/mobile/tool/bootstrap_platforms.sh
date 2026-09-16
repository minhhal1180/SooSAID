#!/usr/bin/env bash
#
# Sinh thư mục nền tảng iOS/Android rồi áp cấu hình riêng của S.O.S Aid.
#
# Vì sao cần script này thay vì commit thẳng ios/ và android/:
#   - `flutter create` sinh project Xcode/Gradle đúng theo phiên bản Flutter
#     đang dùng; project pbxproj viết tay rất dễ hỏng và khó review.
#   - Nhưng `flutter create` cũng ghi đè Info.plist và AndroidManifest bằng bản
#     mặc định KHÔNG có quyền camera/mic/vị trí.
#   => Sinh trước, áp cấu hình sau. Chạy lại bao nhiêu lần cũng cho kết quả như nhau.
#
# Dùng:
#   cd apps/mobile
#   ./tool/bootstrap_platforms.sh
#
# Biến môi trường (tuỳ chọn):
#   BUNDLE_ID       mặc định vn.sosaid.mobile
#   APPLE_TEAM_ID   Team ID 10 ký tự, cần khi export IPA

set -euo pipefail

BUNDLE_ID="${BUNDLE_ID:-vn.sosaid.mobile}"
APPLE_TEAM_ID="${APPLE_TEAM_ID:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMPLATE_DIR="$SCRIPT_DIR/platform"

cd "$PROJECT_DIR"

echo "==> Sinh thư mục nền tảng (bundle id: $BUNDLE_ID)"
# `--project-name` phải khớp `name:` trong pubspec.yaml, nếu không Flutter báo lỗi.
flutter create \
  --platforms=ios,android \
  --org "${BUNDLE_ID%.*}" \
  --project-name sos_aid_mobile \
  .

# `flutter create` sinh test mẫu tham chiếu lớp `MyApp` — lớp đó không tồn tại
# trong dự án này (app tên `SosAidApp`), nên để lại sẽ làm `flutter analyze` và
# `flutter test` thất bại ngay ở CI.
rm -f test/widget_test.dart

echo "==> Áp cấu hình iOS"
cp "$TEMPLATE_DIR/ios/Info.plist" ios/Runner/Info.plist
cp "$TEMPLATE_DIR/ios/Podfile" ios/Podfile

# ExportOptions.plist chứa Team ID nên được sinh ra (không commit giá trị thật).
if [ -n "$APPLE_TEAM_ID" ]; then
  sed "s/\${APPLE_TEAM_ID}/$APPLE_TEAM_ID/g" \
    "$TEMPLATE_DIR/ios/ExportOptions.plist" > ios/ExportOptions.plist
  echo "    ExportOptions.plist đã sinh với Team ID $APPLE_TEAM_ID"
else
  echo "    BỎ QUA ExportOptions.plist (chưa đặt APPLE_TEAM_ID)"
fi

echo "==> Áp cấu hình Android"
cp "$TEMPLATE_DIR/android/AndroidManifest.xml" android/app/src/main/AndroidManifest.xml

# minSdk 23: yêu cầu tối thiểu của flutter_secure_storage và livekit_client.
# Sửa tại chỗ thay vì copy cả build.gradle, để không đè cấu hình ký của Gradle.
GRADLE_FILE=""
for candidate in android/app/build.gradle.kts android/app/build.gradle; do
  if [ -f "$candidate" ]; then GRADLE_FILE="$candidate"; break; fi
done

if [ -n "$GRADLE_FILE" ]; then
  sed -i.bak -E 's/minSdk(Version)? *=? *(flutter\.minSdkVersion|[0-9]+)/minSdk = 23/' "$GRADLE_FILE"
  rm -f "$GRADLE_FILE.bak"
  echo "    Đặt minSdk = 23 trong $GRADLE_FILE"
fi

echo "==> Cài dependency"
flutter pub get

echo ""
echo "Hoàn tất. Bước tiếp theo:"
echo "  flutter analyze"
echo "  flutter test"
echo "  flutter build ipa   # chỉ chạy được trên macOS"
