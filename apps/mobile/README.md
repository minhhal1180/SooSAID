# S.O.S Aid – Ứng dụng di động (Flutter)

Ứng dụng dành cho **người dân** trong tình huống cấp cứu ngoài bệnh viện.

> **Trạng thái:** mã nguồn hoàn chỉnh cho các màn hình M01–M04, M06, M09 theo
> TDD §8.1, **chưa được biên dịch** vì máy phát triển hiện tại không có Flutter
> SDK. Chạy `flutter analyze` và `flutter test` trước khi merge.

## Chạy thử

```bash
# 1. Cài phụ thuộc
flutter pub get

# 2. Chạy backend trước (xem ../api/README hoặc README ở gốc repo)

# 3. Chạy app
#    Android emulator: host machine là 10.0.2.2
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/v1

#    iOS simulator / thiết bị thật trong cùng LAN
flutter run --dart-define=API_BASE_URL=http://<IP-LAN-cua-may>:3000/v1
```

Đăng nhập bằng số điện thoại mô phỏng `+84900000001`. Mã OTP chỉ hiển thị trong
log của backend khi `AUTH_OTP_DEV_ECHO=true` (mặc định bật ở `.env` phát triển).

## Cấu trúc

| Đường dẫn | Vai trò |
|---|---|
| `lib/core/config.dart` | Mọi endpoint, ngưỡng, TTL (Rule 9.2 – không hard-code) |
| `lib/core/api_client.dart` | REST client, tự gỡ envelope `{success,data}` (ADR-003) |
| `lib/core/location_service.dart` | GPS best-effort; thiếu vị trí KHÔNG chặn tạo ca (TC-004) |
| `lib/core/offline_cache.dart` | Token + hướng dẫn đã duyệt cho chế độ offline (SOS-051) |
| `lib/models/` | `CasePhase` (6 pha của ADR-001), hướng dẫn, phiếu quan sát |
| `lib/state/app_state.dart` | Luồng S.O.S theo đúng thứ tự Rule 7.2 |
| `lib/screens/` | M01 Auth · M02 Home · M03 SOS Active · M04 Triage · M06/M09 Guidance |

## Quyết định thiết kế đáng lưu ý

**App chỉ biết 6 pha, không biết 12 trạng thái.** `CasePhase` trong
`models/emergency_case.dart` là 6 pha hiển thị của Rule 7.1; 12 trạng thái kỹ
thuật chỉ tồn tại ở backend và dashboard (ADR-001). Người đang xử lý sự cố cần
biết "đang ở bước nào", không cần phân biệt `HANDOVER_PENDING` với `HANDED_OVER`.

**Server là nguồn sự thật.** App không bao giờ tự suy ra pha kế tiếp; nó hiển
thị đúng `phase` mà server trả về và lấy snapshot theo chu kỳ
(`AppConfig.casePollInterval`). Push notification chỉ là tín hiệu, không phải dữ
liệu (TDD §3.1).

**Không có mạng thì nói thật.** Khi `POST /emergency-cases` thất bại, màn hình
hiển thị "yêu cầu CHƯA được gửi" kèm số cấp cứu, tuyệt đối không hiển thị "đã
gửi" (TDD §12).

**Idempotency-Key sinh một lần cho mỗi lần bấm.** Mọi retry mạng dùng lại đúng
key đó nên không sinh ca thứ hai (FR-002, TC-002); nút cũng tự khoá
`AppConfig.sosButtonLockDuration` sau khi bấm (TC-003).

## Việc còn lại trước Pilot

- [ ] **M05 Video**: tích hợp WebRTC client qua adapter tương ứng
      `VideoProvider` của backend (Rule 8.1). Backend đang chạy driver `mock`
      nên chưa có luồng media thật để nối vào.
- [ ] **M07 Map**: hiển thị bản đồ. Backend đang ở `MAP_PROVIDER=mock`; hiện tại
      app hiển thị toạ độ + chỉ dẫn tiếp cận bằng chữ (đủ theo TDD §12).
- [ ] **M08 Profile/Contacts**: màn hình hồ sơ sức khỏe khẩn cấp và danh bạ
      người thân (API backend đã sẵn sàng: `/me/emergency-profile`,
      `/me/emergency-contacts`).
- [ ] **M10 Case History**: lịch sử ca của người dùng (`/emergency-cases/mine`).
- [ ] **Secure storage**: chuyển token từ `shared_preferences` sang Keychain /
      EncryptedSharedPreferences trước khi có dữ liệu thật — xem
      `docs/security/README.md`.
- [ ] **Quyền nền**: khai báo `NSLocationWhenInUseUsageDescription`,
      `ACCESS_FINE_LOCATION`, quyền camera/mic trong project iOS/Android.
