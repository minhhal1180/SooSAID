# Checklist TestFlight – những gì cần cung cấp

Tài liệu này chỉ dành cho mục tiêu **đưa app lên TestFlight**, không phải phát
hành App Store công khai. Phạm vi hẹp hơn nhiều, nên danh sách cũng ngắn hơn.

> **Internal Testing** (tối đa 100 người, **không cần Apple review**) là đường
> nhanh nhất và là thứ nên dùng cho hội thi. **External Testing** (tối đa 10.000
> người, chỉ cần email) phải qua Beta App Review ~1–2 ngày và yêu cầu thêm App
> Privacy + chính sách bảo mật.

---

## Bước 0. Chạy thử biên dịch — ✅ đã chạy và đã xanh

Bước này không cần tài khoản Apple, không cần secret nào, và trả lời đúng câu
hỏi đắt nhất: *dự án iOS này có biên dịch được không?*

GitHub → **Actions** → **Mobile iOS – build & TestFlight** → **Run workflow** →
tick **"Chỉ thử biên dịch, không ký, không nộp"** → **Run**.

Nó chạy CocoaPods, biên dịch toàn bộ plugin native (livekit, geolocator,
secure_storage) và kiểm tra `Info.plist` **trong bản dựng** có đủ mô tả quyền
camera/mic/vị trí.

Kết quả lần chạy
[35484707633](https://github.com/minhhal1180/SooSAID/actions/runs/35484707633):

```
Building vn.sosaid.mobile for device (ios-release)...
Xcode build done.                                           70.9s
✓ Built build/ios/iphoneos/Runner.app (39.9MB)
  OK  NSCameraUsageDescription
  OK  NSMicrophoneUsageDescription
  OK  NSLocationWhenInUseUsageDescription
```

Lần chạy đầu tiên **đỏ**, và nó bắt được đúng hai lỗi sẽ chặn bản nộp:

| Lỗi | Hậu quả nếu không phát hiện |
|---|---|
| `connectivity_plus` gọi `NWPath.isUltraConstrained` — API chỉ có ở SDK iOS 26, runner `macos-14` chỉ có Xcode 15 | Build luôn đỏ sau khi đã mua tài khoản |
| `flutter create` sinh bundle id `vn.sosaid.sosAidMobile` chứ không phải `vn.sosaid.mobile` | Provisioning profile không khớp, Apple từ chối bản nộp |

Đó chính là lý do bước này đáng chạy trước. Repo để **public** nên macOS runner
miễn phí — chạy bao nhiêu lần cũng không tốn gì.

---

## A. Những thứ CHỈ ANH cung cấp được

### A1. Tài khoản Apple Developer — **99 USD/năm**

Không có cách nào lách. Đăng ký tại
<https://developer.apple.com/programs/enroll/>, chọn **Individual** cho nhanh
(Organization cần mã D-U-N-S, duyệt lâu hơn 1–2 tuần).

Apple duyệt trong 24–48 giờ.

### A2. Bốn thao tác trên web (~15 phút, sau khi tài khoản được duyệt)

| # | Việc | Nơi làm | Kết quả cần ghi lại |
|---|---|---|---|
| 1 | Lấy **Team ID** | developer.apple.com → Membership | 10 ký tự, ví dụ `A1B2C3D4E5` |
| 2 | Đăng ký **App ID** | Certificates, IDs & Profiles → Identifiers → **+** → App IDs → App → Explicit → `vn.sosaid.mobile` | — (không bật capability nào) |
| 3 | Tạo **App record** | appstoreconnect.com/apps → **+** → New App. Platform iOS, Language Vietnamese, Bundle ID `vn.sosaid.mobile`, SKU `sos-aid-mobile` | — |
| 4 | Tạo **API Key** | App Store Connect → Users and Access → Integrations → Team Keys → **+**, quyền **App Manager** | `Issuer ID`, `Key ID`, file `AuthKey_XXXX.p8` |

> File `.p8` **chỉ tải được một lần duy nhất**. Mất là phải tạo key mới.

### A3. Chứng chỉ phân phối — có script làm hộ

```bash
cd apps/mobile

# Lượt 1: sinh khoá + CSR
./tool/make-ios-cert.sh init email-cua-anh@example.com

# → Lên https://developer.apple.com/account/resources/certificates/list
#   + → Apple Distribution → tải CSR lên → Download distribution.cer
#   → chép file .cer vào apps/mobile/.ios-signing/

# Lượt 2: đóng gói .p12 + xuất sẵn giá trị cho GitHub Secrets
./tool/make-ios-cert.sh pack
```

Script tự sinh mật khẩu ngẫu nhiên, tự đối chiếu khoá với chứng chỉ, tự xác
minh `.p12` mở lại được, và ghi cả hai giá trị vào
`apps/mobile/.ios-signing/github-secrets.txt`.

### A4. Backend chạy công khai HTTPS

**Đây là thứ dễ bị quên nhất.** Điện thoại người thử nghiệm không gọi được
`localhost` — backend phải có một URL HTTPS công khai.

Hai lựa chọn:

**Nhanh nhất cho demo/hội thi — cloudflared (đã cài sẵn trên máy anh):**

```bash
# Cửa sổ 1: chạy backend
cd apps/api && npm run start:dev

# Cửa sổ 2: mở tunnel công khai
cloudflared tunnel --url http://localhost:3000
# → in ra một URL dạng https://<ngau-nhien>.trycloudflare.com
```

Dùng `https://<ngau-nhien>.trycloudflare.com/v1` làm `MOBILE_API_BASE_URL`.

Hạn chế: URL đổi mỗi lần khởi động lại, và máy anh phải bật. Đủ cho buổi trình
diễn, không đủ cho thử nghiệm thực địa nhiều ngày.

**Bền vững hơn — deploy container:**

```bash
docker build -f apps/api/Dockerfile -t sos-aid-api .
```

Đẩy lên Render / Railway / Fly.io (đều có gói miễn phí kèm PostgreSQL). Nhớ đặt
`PERSISTENCE_DRIVER=postgres`, `CACHE_DRIVER=redis`, `NODE_ENV=production` và
sinh secret JWT mới — cấu hình `memory` bị backend **từ chối khởi động** ở
production.

### A5. Nơi đặt repo — ✅ đã xong

<https://github.com/minhhal1180/SooSAID> (public, nhánh `master`).

> Public nên macOS runner **miễn phí**. Nếu sau này chuyển sang private, mỗi lần
> build ~15 phút × 0,08 USD/phút ≈ **1,2 USD**.

---

## B. Nạp vào GitHub Secrets

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Lấy từ |
|---|---|
| `APPLE_TEAM_ID` | A2 #1 |
| `APPSTORE_ISSUER_ID` | A2 #4 |
| `APPSTORE_KEY_ID` | A2 #4 |
| `APPSTORE_PRIVATE_KEY` | Toàn bộ nội dung file `.p8`, **kể cả dòng `-----BEGIN` và `-----END`** |
| `IOS_DIST_CERT_P12_BASE64` | `github-secrets.txt` từ A3 |
| `IOS_DIST_CERT_PASSWORD` | `github-secrets.txt` từ A3 |
| `MOBILE_API_BASE_URL` | A4, nhớ có hậu tố `/v1` |

Workflow **kiểm tra đủ 6 secret đầu ngay bước thứ hai** và dừng với thông điệp
rõ ràng nếu thiếu — không để anh chờ 15 phút rồi mới báo lỗi.

---

## C. Bấm build

1. GitHub → tab **Actions** → **Mobile iOS – build & TestFlight**
2. **Run workflow** → chọn nhánh → tick **Nộp lên TestFlight** → **Run**
3. Chờ ~15–20 phút
4. App Store Connect → **TestFlight** → bản build hiện sau khi Apple xử lý (5–30 phút)
5. **Internal Testing** → thêm người thử nghiệm bằng email
6. Người thử nghiệm cài app **TestFlight** từ App Store, mở link mời, bấm cài

---

## D. Những gì KHÔNG cần cho TestFlight Internal

Các mục này chỉ bắt buộc khi nộp App Store công khai hoặc dùng External Testing:

| Mục | Internal Testing | External Testing | App Store |
|---|---|---|---|
| Chính sách bảo mật (URL công khai) | không | **cần** | **cần** |
| App Privacy (nutrition label) | không | **cần** | **cần** |
| Chức năng xoá tài khoản trong app | không | không | **cần** (5.1.1(v)) |
| Nội dung sơ cứu được bác sĩ phê duyệt | không | nên có | **cần** (1.4.1) |
| Ảnh chụp màn hình, mô tả App Store | không | không | **cần** |
| Beta App Review | không | **cần** (~1–2 ngày) | — |

Vì vậy bản hiện tại **đủ điều kiện lên TestFlight Internal ngay**, dù chưa đủ
điều kiện nộp App Store.

---

## E. Kiểm tra trước khi mời người thử nghiệm

- [ ] Backend công khai trả về đúng: `curl https://<url>/v1/health`
- [ ] `MOBILE_API_BASE_URL` có hậu tố `/v1`
- [ ] `EMERGENCY_PHONE` đúng số cấp cứu địa bàn (mặc định `115`) — đặt ở
      **Settings → Variables → Actions**, không phải Secrets
- [ ] Tự cài bản TestFlight lên máy mình và thử **trọn luồng S.O.S** trước khi
      mời người khác
- [ ] Thử tình huống **tắt mạng**: app phải báo "chưa gửi được" kèm nút gọi cấp
      cứu, tuyệt đối không hiện "đã gửi"
- [ ] Thử **từ chối quyền vị trí**: vẫn tạo được ca sau khi nhập địa chỉ tay

---

## F. Ước tính thời gian

| Việc | Thời gian |
|---|---|
| Bước 0 — chạy thử biên dịch | ~20 phút, máy chạy, anh không phải làm gì |
| A5 — tạo repo | ✅ đã xong |
| Đăng ký Apple Developer | 24–48 giờ chờ duyệt |
| A2 + A3 (thao tác web + chứng chỉ) | ~30 phút |
| A4 backend công khai (cloudflared) | ~5 phút |
| B (nạp 7 secrets) | ~10 phút |
| C (build + Apple xử lý) | ~30–50 phút |

**Tổng thời gian thao tác: khoảng 45 phút.** Phần còn lại là chờ Apple.
