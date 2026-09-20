# Đưa S.O.S Aid lên iPhone

Hướng dẫn từ con số 0 đến app chạy trên iPhone thật.

> **Chỉ cần TestFlight?** Dùng [`testflight-checklist.md`](testflight-checklist.md)
> — danh sách ngắn hơn hẳn, bỏ qua mọi yêu cầu chỉ phát sinh khi nộp App Store
> công khai (chính sách bảo mật, App Privacy, xoá tài khoản, ảnh chụp màn hình).
> Tài liệu dưới đây là bản đầy đủ, dùng khi tiến tới phát hành công khai.

> **Sự thật cần biết trước:** biên dịch iOS **bắt buộc chạy trên macOS** — Xcode
> không có bản Windows và không có cách nào lách. Máy phát triển hiện tại chạy
> Windows, nên tài liệu này lấy **CI trên macOS runner** làm đường chính.

---

## 0. Ba đường lên iPhone

| Đường | Cần gì | Chi phí | Phù hợp khi |
|---|---|---|---|
| **A. GitHub Actions** ⭐ | Không cần Mac | Repo private: ~0,08 USD/phút macOS (build ~15 phút ≈ **1,2 USD/lần**). Repo public: miễn phí | Anh đang ở Windows — **khuyên dùng** |
| **B. Codemagic** | Không cần Mac | Free 500 phút/tháng (đủ ~30 lần build) | Muốn miễn phí hoàn toàn, repo private |
| **C. Mac thật** | Mac + Xcode | Máy có sẵn / mượn | Cần debug trực tiếp trên thiết bị |

Cả ba đều cần **Apple Developer Program – 99 USD/năm**. Đây là yêu cầu của Apple,
không phải hạn chế của dự án.

> Không có tài khoản trả phí thì vẫn cài được app lên iPhone của chính mình bằng
> Xcode với Apple ID miễn phí, nhưng **app hết hạn sau 7 ngày** và không chia sẻ
> cho người khác được. Không dùng được cho hội thi hay thử nghiệm thực địa.

---

## 1. Chuẩn bị tài khoản Apple (làm một lần, ~1–2 ngày chờ duyệt)

### 1.1 Đăng ký Apple Developer Program

1. Vào <https://developer.apple.com/programs/enroll/>.
2. Chọn **Individual** (cá nhân) hoặc **Organization** (tổ chức — cần mã số
   doanh nghiệp D-U-N-S, duyệt lâu hơn).
3. Trả 99 USD/năm. Apple duyệt trong 24–48 giờ.

> **Với hội thi:** đăng ký **Individual** bằng tài khoản cá nhân là nhanh nhất.
> Nếu trường/đơn vị đứng tên thì phải làm Organization và chuẩn bị D-U-N-S trước
> ít nhất 2 tuần.

### 1.2 Tạo App ID

1. <https://developer.apple.com/account/resources/identifiers/list>
2. **+** → **App IDs** → **App**
3. Bundle ID: `vn.sosaid.mobile` (chọn **Explicit**)
4. Capabilities: **không bật gì thêm**. App chưa dùng Push, Sign in with Apple
   hay HealthKit. Bật thừa sẽ làm provisioning phức tạp và bị hỏi khi review.

### 1.3 Tạo app trên App Store Connect

1. <https://appstoreconnect.apple.com/apps> → **+** → **New App**
2. Platform: **iOS**
3. Name: `S.O.S Aid` (tên phải duy nhất toàn App Store — nếu trùng, thêm hậu tố)
4. Primary Language: **Vietnamese**
5. Bundle ID: chọn `vn.sosaid.mobile` vừa tạo
6. SKU: `sos-aid-mobile` (mã nội bộ, không hiển thị công khai)

### 1.4 Lấy Team ID

<https://developer.apple.com/account> → **Membership** → chép **Team ID**
(10 ký tự, ví dụ `A1B2C3D4E5`).

---

## 2. Tạo chứng chỉ và khoá API

Phần này cần **một máy Mac một lần duy nhất** để tạo file `.p12`, hoặc dùng
OpenSSL trên Windows theo cách ở §2.1b.

> **Có script làm hộ.** `apps/mobile/tool/make-ios-cert.sh` thực hiện toàn bộ
> phần OpenSSL ở §2.1b, tự đối chiếu khoá với chứng chỉ, tự xác minh `.p12` mở
> lại được, và xuất sẵn hai giá trị cho GitHub Secrets. Xem
> [`testflight-checklist.md` §A3](testflight-checklist.md). Phần dưới đây giải
> thích script làm gì, để người review hiểu và kiểm chứng được.

### 2.1a Có Mac — cách chuẩn

```bash
# Trên Mac: Keychain Access > Certificate Assistant
#   > Request a Certificate From a Certificate Authority
#   > lưu ra file CertificateSigningRequest.certSigningRequest
```

1. <https://developer.apple.com/account/resources/certificates/list> → **+**
2. Chọn **Apple Distribution** → tải CSR lên → tải file `.cer` về
3. Nhấp đúp `.cer` để cài vào Keychain
4. Trong Keychain Access, chuột phải chứng chỉ → **Export** → định dạng
   **.p12** → đặt mật khẩu (nhớ mật khẩu này)

### 2.1b Không có Mac — dùng OpenSSL trên Windows

```bash
# Git Bash đã có sẵn openssl

# 1. Sinh private key và CSR
openssl genrsa -out ios_distribution.key 2048
openssl req -new -key ios_distribution.key -out ios_distribution.csr \
  -subj "/emailAddress=EMAIL_CUA_ANH/CN=SOS Aid Distribution/C=VN"

# 2. Tải ios_distribution.csr lên developer.apple.com (bước 2.1a mục 1-2)
#    Tải về file distribution.cer

# 3. Chuyển .cer sang .pem rồi đóng gói thành .p12
openssl x509 -inform DER -in distribution.cer -out distribution.pem
openssl pkcs12 -export \
  -inkey ios_distribution.key \
  -in distribution.pem \
  -out ios_distribution.p12 \
  -name "SOS Aid Distribution"
# openssl sẽ hỏi mật khẩu export — ĐẶT MẬT KHẨU và ghi nhớ
```

> **Giữ `ios_distribution.key` và `.p12` thật cẩn thận.** Ai có chúng thì ký
> được app mạo danh tổ chức của anh. Không commit vào git — `.gitignore` đã chặn
> `*.p12` và `*.key`, nhưng đừng thử.

### 2.2 Tạo App Store Connect API Key

Dùng để CI tự nộp bản build mà không cần mật khẩu Apple ID.

1. <https://appstoreconnect.apple.com/access/integrations/api>
2. Tab **Team Keys** → **+**
3. Name: `GitHub Actions CI`
4. Access: **App Manager**
5. **Generate** → tải file `AuthKey_XXXXXXXXXX.p8`

> File `.p8` **chỉ tải được đúng một lần**. Mất là phải tạo key mới.

Ghi lại 3 giá trị: **Issuer ID** (đầu trang), **Key ID** (`XXXXXXXXXX`), và nội
dung file `.p8`.

---

## 3. Nạp secrets vào GitHub

Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Secret | Giá trị | Lấy từ |
|---|---|---|
| `APPLE_TEAM_ID` | `A1B2C3D4E5` | §1.4 |
| `IOS_DIST_CERT_P12_BASE64` | Xem lệnh bên dưới | §2.1 |
| `IOS_DIST_CERT_PASSWORD` | Mật khẩu đặt khi export `.p12` | §2.1 |
| `APPSTORE_ISSUER_ID` | UUID dạng `1a2b3c4d-...` | §2.2 |
| `APPSTORE_KEY_ID` | 10 ký tự | §2.2 |
| `APPSTORE_PRIVATE_KEY` | Toàn bộ nội dung file `.p8`, **kể cả dòng BEGIN/END** | §2.2 |
| `MOBILE_API_BASE_URL` | `https://api-cua-anh.example.com/v1` | Hạ tầng của anh |

Chuyển `.p12` sang base64:

```bash
# Git Bash / macOS / Linux
base64 -w 0 ios_distribution.p12 > p12_base64.txt
```

```powershell
# PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("ios_distribution.p12")) |
  Set-Content p12_base64.txt -Encoding ascii
```

Mở `p12_base64.txt`, chép **toàn bộ** một dòng dài đó vào secret. Xoá file sau
khi dùng xong.

Thêm một **variable** (không phải secret) nếu muốn đổi số cấp cứu:
**Settings → Variables → Actions** → `EMERGENCY_PHONE` = `115`.

---

## 4. Build và nộp

1. Push code lên GitHub.
2. Tab **Actions** → chọn workflow **Mobile iOS – build & TestFlight**.
3. **Run workflow** → chọn nhánh → tick **Nộp lên TestFlight** → **Run**.
4. Chờ ~15–20 phút.

Workflow sẽ: cài Flutter → sinh `ios/` + `android/` → áp `Info.plist` và
`Podfile` của dự án → `flutter analyze` → `flutter test` → nạp chứng chỉ → tải
provisioning profile → `flutter build ipa` → nộp App Store Connect.

**Build number** lấy từ số thứ tự lần chạy workflow, nên luôn tăng và không bao
giờ trùng — App Store Connect từ chối bản nộp có build number đã tồn tại.

---

## 5. Cài lên iPhone qua TestFlight

1. Sau khi nộp, Apple xử lý 5–30 phút. Theo dõi tại
   **App Store Connect → TestFlight**.
2. Lần đầu tiên Apple sẽ hỏi **Export Compliance** — `Info.plist` đã khai
   `ITSAppUsesNonExemptEncryption = false` nên bước này tự động qua.
3. Thêm người thử nghiệm:
   - **Internal Testing**: tối đa 100 người, phải có tài khoản trong App Store
     Connect, **không cần Apple review** → dùng cho đội phát triển và ban giám khảo.
   - **External Testing**: tối đa 10.000 người, chỉ cần email, **cần Apple
     review lần đầu** (~1–2 ngày).
4. Người thử nghiệm cài app **TestFlight** từ App Store, mở link mời, bấm cài.

> **Cho hội thi:** dùng **Internal Testing** và mời email của ban giám khảo. Nhanh
> hơn và không phụ thuộc lịch review của Apple.

---

## 6. Nộp lên App Store (khi cần phát hành công khai)

**CHƯA NÊN LÀM cho tới khi các mục chặn Pilot được chốt** (xem
[docs/security](../security/README.md)). App Store review rất khắt khe với ứng
dụng y tế, và bản hiện tại sẽ bị từ chối vì các lý do dưới đây.

### Rủi ro bị từ chối đã biết

| Vấn đề | Điều khoản | Xử lý |
|---|---|---|
| Nội dung hướng dẫn sơ cứu chưa được chuyên gia duyệt | 1.4.1 – Physical Harm | Phải có bộ nội dung được bác sĩ phê duyệt; hiện toàn bộ đang ở trạng thái `DRAFT` |
| App liên quan cấp cứu nhưng không nêu rõ giới hạn | 1.4.1 | Đã có: màn hình đăng nhập và mọi màn hình đều nhắc "không thay thế 115" |
| Không có chính sách bảo mật | 5.1.1 | **Bắt buộc** viết và đăng công khai một URL, khai trong App Store Connect |
| Đăng nhập OTP mà không có cách xoá tài khoản | 5.1.1(v) | **Bắt buộc** bổ sung chức năng xoá tài khoản ngay trong app |
| Quyền nền `audio` | 2.5.4 | Giải trình trong App Review notes: giữ cuộc gọi video khi người dùng làm sơ cứu bằng hai tay |
| Tài khoản demo cho reviewer | 2.1 | Cung cấp số điện thoại + OTP cố định, hoặc backend có tài khoản reviewer riêng |

### Ghi chú gợi ý cho App Review

```
S.O.S Aid ket noi nguoi dan voi nhan vien y te truc trong tinh huong cap cuu
ngoai benh vien. Ung dung KHONG chan doan benh, KHONG thay the tong dai 115 va
KHONG dua ra quyet dinh y khoa. Moi noi dung huong dan so cuu deu do chuyen gia
y te phe duyet va duoc version hoa.

Quyen nen "audio" dung de giu cuoc goi video voi nhan vien truc khi nguoi dung
khoa man hinh de thuc hien so cuu bang hai tay.

Tai khoan thu nghiem:
  So dien thoai: +84900000001
  Ma OTP: <dien ma co dinh cua moi truong review>
```

---

## 7. Xử lý sự cố thường gặp

| Lỗi | Nguyên nhân | Cách sửa |
|---|---|---|
| `No profiles for 'vn.sosaid.mobile' were found` | Chưa tạo App ID, hoặc API key thiếu quyền | Kiểm tra §1.2; API key phải ở mức **App Manager** |
| `Code signing identity not found` | `.p12` sai hoặc mật khẩu sai | Tạo lại theo §2.1; kiểm tra base64 chép đủ một dòng |
| `Unsupported export method 'app-store-connect'` | Xcode cũ | Sửa `tool/platform/ios/ExportOptions.plist` thành `app-store` |
| `The bundle version must be higher than...` | Build number trùng | Workflow đã dùng `github.run_number`; nếu vẫn trùng thì bấm Run workflow lại |
| `pod install` lỗi deployment target | Podfile mặc định của Flutter ghi đè | Chạy lại `tool/bootstrap_platforms.sh` — script copy đè Podfile của dự án |
| App crash khi bấm S.O.S trên thiết bị thật | Thiếu chuỗi `NS*UsageDescription` | Kiểm tra `ios/Runner/Info.plist` đã được copy đè chưa |
| Nút gọi 115 không phản ứng | Thiếu `LSApplicationQueriesSchemes` | Như trên |

---

## 8. Nếu có Mac (đường C)

```bash
cd apps/mobile
./tool/bootstrap_platforms.sh

# Chạy thẳng lên iPhone đang cắm cáp
flutter run --release \
  --dart-define=API_BASE_URL=https://api-cua-anh.example.com/v1

# Hoặc build IPA để nộp thủ công
export APPLE_TEAM_ID=A1B2C3D4E5
./tool/bootstrap_platforms.sh
flutter build ipa --export-options-plist=ios/ExportOptions.plist
open build/ios/ipa   # kéo file .ipa vào Transporter
```

Lần đầu mở Xcode: `open ios/Runner.xcworkspace` → tab **Signing & Capabilities**
→ chọn Team → Xcode tự tạo provisioning profile.

---

## 9. Danh sách kiểm tra trước mỗi lần nộp

- [ ] `flutter analyze` sạch
- [ ] `flutter test` xanh
- [ ] Backend production đang chạy và `MOBILE_API_BASE_URL` trỏ đúng
- [ ] `EMERGENCY_PHONE` đúng số cấp cứu của địa bàn triển khai
- [ ] Đã thử luồng S.O.S trên thiết bị thật, không chỉ simulator
  (simulator **không có GPS thật và không có camera**)
- [ ] Đã thử tình huống **tắt mạng**: app phải báo "chưa gửi được" và hiện nút
      gọi cấp cứu, tuyệt đối không hiển thị "đã gửi"
- [ ] Đã thử **từ chối quyền vị trí**: app vẫn tạo được ca sau khi nhập địa chỉ
- [ ] Build number tăng so với lần nộp trước
