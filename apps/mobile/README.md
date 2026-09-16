# S.O.S Aid – Ứng dụng di động (Flutter)

Ứng dụng dành cho **người dân** trong tình huống cấp cứu ngoài bệnh viện.

> **Chưa biên dịch trên máy này.** Máy phát triển hiện tại (Windows) không có
> Flutter SDK, nên toàn bộ mã nguồn **chưa qua `flutter analyze` / `flutter test`**.
> Chạy hai lệnh đó trước khi merge. CI ([`ci.yml`](../../.github/workflows/ci.yml))
> cũng chặn PR nếu chúng không xanh.

## Chạy thử

```bash
cd apps/mobile

# 1. Sinh thư mục nền tảng + áp cấu hình quyền của dự án (chạy một lần)
./tool/bootstrap_platforms.sh          # macOS/Linux/Git Bash
.\tool\bootstrap_platforms.ps1         # Windows PowerShell

# 2. Chạy backend trước (xem README ở gốc repo)

# 3. Chạy app
#    Android emulator: máy host là 10.0.2.2
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/v1

#    iOS simulator / thiết bị thật trong cùng LAN
flutter run --dart-define=API_BASE_URL=http://<IP-LAN>:3000/v1
```

Đăng nhập bằng số mô phỏng `+84900000001`. Mã OTP hiện trong log backend khi
`AUTH_OTP_DEV_ECHO=true` (mặc định bật ở `.env` phát triển).

**Lên iPhone thật:** xem [`docs/mobile/ios-release.md`](../../docs/mobile/ios-release.md).

## Màn hình

| Mã | Màn hình | File |
|---|---|---|
| M01 | Đăng nhập OTP | `screens/auth_screen.dart` |
| M02 | Trang chính, nút S.O.S | `screens/home_screen.dart` |
| M03 | Theo dõi ca đang xử lý | `screens/sos_active_screen.dart` |
| M04 | Phiếu quan sát | `screens/triage_screen.dart` |
| M05 | Video với nhân viên trực | `screens/video_call_screen.dart` |
| M06 | Hướng dẫn sơ cấp cứu | `screens/guidance_screen.dart` |
| M07 | Bản đồ và điểm hỗ trợ | `screens/map_screen.dart` |
| M08 | Hồ sơ sức khỏe + người liên hệ | `screens/profile_screen.dart`, `screens/contacts_screen.dart` |
| M09 | Chế độ offline | Trong `guidance_screen.dart` + `_FailureFallback` ở `home_screen.dart` |
| M10 | Lịch sử yêu cầu | `screens/history_screen.dart` |

## Kiến trúc

```
lib/
├── core/
│   ├── config.dart              Mọi endpoint/ngưỡng/TTL (Rule 9.2)
│   ├── api_client.dart          REST + tự gỡ envelope {success,data} (ADR-003)
│   ├── secure_store.dart        Token → Keychain / EncryptedSharedPreferences
│   ├── offline_cache.dart       Dữ liệu KHÔNG nhạy cảm → shared_preferences
│   ├── location_service.dart    GPS best-effort; thiếu GPS vẫn tạo được ca
│   ├── emergency_dialer.dart    Gọi thẳng số cấp cứu — phương án cuối cùng
│   ├── video/                   Port + driver mock/livekit (Rule 8.1)
│   └── map/                     Port + driver OpenStreetMap
├── models/                      CasePhase (6 pha), hướng dẫn, hồ sơ
├── state/app_state.dart         Luồng S.O.S theo đúng thứ tự Rule 7.2
└── screens/                     M01–M10
```

### Quy tắc adapter (Rule 8.1)

SDK bên ngoài **chỉ được import trong đúng một file**:

| SDK | File duy nhất được import |
|---|---|
| `livekit_client` | `core/video/livekit_video_adapter.dart` |
| `flutter_map` | `core/map/osm_map_adapter.dart` |

Màn hình chỉ biết `VideoCallAdapter` và `MapViewAdapter`. Đổi LiveKit → Twilio,
hoặc OSM → Mapbox, là thêm một file và sửa một dòng ở factory.

Driver video do **backend quyết định** qua trường `provider` trong response của
`POST /emergency-cases/{id}/video/session` — hai đầu luôn khớp, và backend đổi
nhà cung cấp không cần phát hành bản app mới.

## Quyết định thiết kế đáng lưu ý

**App chỉ biết 6 pha, không biết 12 trạng thái.** `CasePhase` là 6 pha hiển thị
của Rule 7.1; 12 trạng thái kỹ thuật chỉ tồn tại ở backend và dashboard
(ADR-001). Người đang xử lý sự cố cần biết "đang ở bước nào", không cần phân
biệt `HANDOVER_PENDING` với `HANDED_OVER`.

**Server là nguồn sự thật.** App không tự suy ra pha kế tiếp; nó hiển thị đúng
`phase` server trả về và lấy snapshot theo chu kỳ. Push chỉ là tín hiệu, không
phải dữ liệu (TDD §3.1).

**Không có mạng thì nói thật.** Khi `POST /emergency-cases` thất bại, màn hình
hiện "yêu cầu CHƯA được gửi" kèm nút gọi cấp cứu — tuyệt đối không hiện "đã gửi"
(TDD §12).

**Nút gọi cấp cứu luôn hiện diện.** Trên trang chính, trong màn hình ca, và cố
định ở màn hình video — không ẩn trong menu, không chờ video hỏng mới xuất hiện.

**Idempotency-Key sinh một lần cho mỗi lần bấm.** Mọi retry mạng dùng lại đúng
key đó nên không sinh ca thứ hai (FR-002, TC-002); nút cũng tự khoá 5 giây sau
khi bấm (TC-003).

**Chỉ xin 3 quyền.** Camera, micro, vị trí-khi-dùng. Không xin danh bạ (người
liên hệ do người dùng tự nhập), không xin vị trí nền, không xin ảnh. Podfile tắt
tường minh mọi quyền khác của `permission_handler` để một dependency mới không
vô tình kéo chúng vào.

## Cấu hình lúc build

| `--dart-define` | Mặc định | Ý nghĩa |
|---|---|---|
| `API_BASE_URL` | `http://10.0.2.2:3000/v1` | Endpoint backend |
| `EMERGENCY_PHONE` | `115` | Số cấp cứu hiển thị và quay |
| `OSM_TILE_URL` | tile.openstreetmap.org | Đổi khi dùng nhà cung cấp có SLA |

## Việc còn lại

- [ ] **Push notification (FCM/APNs)** — code đăng ký thiết bị đã có
      (`POST /me/devices`), còn thiếu tích hợp Firebase. Cố ý chưa thêm: thiếu
      `GoogleService-Info.plist` sẽ làm **hỏng build iOS**, mà file đó phải do
      chủ dự án tạo từ Firebase project của mình.
- [ ] **Xoá tài khoản trong app** — App Store điều 5.1.1(v) **bắt buộc** với app
      có đăng nhập. Chưa có API backend tương ứng.
- [ ] **Chính sách bảo mật công khai** — bắt buộc để nộp App Store.
- [ ] **Chạy nền khi có ca** — hiện chỉ gửi vị trí khi app ở tiền cảnh. Mở rộng
      cần khai `NSLocationAlwaysAndWhenInUseUsageDescription` và giải trình với
      Apple.
- [ ] **Kiểm thử trên thiết bị thật** — simulator không có GPS thật và không có
      camera, nên hai luồng quan trọng nhất chưa được kiểm chứng.
