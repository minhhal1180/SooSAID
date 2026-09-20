# Đưa app lên iPhone không cần tài khoản Apple (PWA)

Đây là đường **miễn phí hoàn toàn**: không tài khoản Apple Developer, không 99
USD, không hết hạn sau 7 ngày, gửi link là người khác cài được.

Cùng một mã nguồn Flutter trong [`apps/mobile/`](../../apps/mobile), chỉ khác
đích biên dịch. Không có bản sao thứ hai phải bảo trì song song.

**Địa chỉ:** <https://minhhal1180.github.io/SooSAID/>

---

## 1. Cài lên iPhone

1. Mở link **bằng Safari**. Chrome hay Firefox trên iOS **không** có mục "Thêm
   vào màn hình chính" — đây là hạn chế của iOS, không phải lỗi của app.
2. Bấm nút **Chia sẻ** (ô vuông có mũi tên lên).
3. Kéo xuống, chọn **Thêm vào Màn hình chính**.
4. Bấm **Thêm**.

Xong. App có icon riêng, mở ra toàn màn hình, không thanh địa chỉ.

Gỡ cài đặt: giữ icon → Xoá, như mọi app khác.

---

## 2. Trỏ về backend thật

Bản build mặc định trỏ tới một tên miền `.invalid` không bao giờ phân giải
được — app mở ra và chạy, nhưng mọi thao tác gọi API sẽ rơi vào nhánh "không gửi
được" kèm nút gọi cấp cứu. Đó đúng là hành vi thiết kế cho tình huống mất mạng
(TDD §12), nhưng không phải thứ để trình diễn.

### Bước 1 — mở backend ra Internet

```bash
# Cửa sổ 1
cd apps/api && npm run start:dev

# Cửa sổ 2
cloudflared tunnel --url http://localhost:3000
# → in ra https://<ngau-nhien>.trycloudflare.com
```

### Bước 2 — cho backend chấp nhận tên miền của PWA

Trong `apps/api/.env`:

```
CORS_ORIGINS=http://localhost:3001,https://minhhal1180.github.io
```

Chỉ ghi **gốc**, không kèm `/SooSAID/`: chuẩn CORS chỉ so khớp scheme + host +
port. Bỏ sót bước này thì app mở được nhưng mọi lệnh gọi API bị trình duyệt
chặn, và lỗi chỉ hiện trong console chứ không hiện trên màn hình. Khởi động lại
backend sau khi sửa.

### Bước 3 — build lại với URL mới

GitHub → **Actions** → **Web PWA – build & GitHub Pages** → **Run workflow** →
dán `https://<ngau-nhien>.trycloudflare.com/v1` vào ô URL → **Run**.

Khoảng 3 phút. Trên iPhone, đóng hẳn app rồi mở lại để service worker lấy bản
mới.

> **Vì sao phải build lại thay vì đổi URL trong app?**
> Vì cho phép đổi backend lúc chạy (ví dụ `?api=...`) sẽ tạo ra một đường lừa
> đảo thật: gửi cho nạn nhân một link trỏ về máy chủ giả là hứng được OTP và hồ
> sơ y tế của họ. Với ứng dụng chạm vào dữ liệu y tế (Rule 5.1), ba phút build
> lại là cái giá rẻ hơn nhiều.

URL cloudflared đổi sau **mỗi** lần khởi động lại. Cần địa chỉ ổn định thì deploy
container bằng [`apps/api/Dockerfile`](../../apps/api/Dockerfile) lên
Render/Railway/Fly.io.

---

## 3. Chạy được gì, không chạy được gì

Đã xác minh **biên dịch** được (`flutter build web` xanh, toàn bộ 7 plugin có
bản web). Chưa xác minh trên iPhone thật — máy phát triển không có thiết bị iOS.
Cột "Trên iOS Safari" dưới đây dựa trên khả năng của nền tảng, hãy tự kiểm lại
trước khi trình diễn.

| Tính năng | Trên iOS Safari |
|---|---|
| Giao diện, điều hướng, toàn bộ luồng S.O.S | ✅ |
| Gọi `tel:115` khi mất mạng | ✅ |
| Vị trí GPS | ✅ khi app đang mở (Safari hỏi quyền) |
| Camera + micro cho video call | ✅ từ iOS 14.3 trở lên |
| Bản đồ OpenStreetMap | ✅ |
| Xem offline nội dung đã tải | ✅ nhờ service worker |
| Vị trí chạy nền | ❌ nền tảng không cho |
| Thông báo đẩy | ❌ chưa làm (iOS 16.4+ có Web Push nếu bổ sung sau) |
| Lưu token trong Keychain | ⚠️ xem mục 4 |

---

## 4. Điều phải ghi vào threat model

Trên iOS native, `flutter_secure_storage` lưu token trong **Keychain** — hệ điều
hành bảo vệ, app khác không đọc được.

Trên web, nó mã hoá bằng WebCrypto rồi ghi vào **localStorage**. Yếu hơn thật
sự, vì khoá giải mã cũng nằm trong cùng trình duyệt đó. Bất kỳ lỗ hổng XSS nào
trên cùng nguồn gốc đều lấy được token.

Hệ quả cụ thể:

- Bản PWA phù hợp cho **trình diễn, thi đấu, thử nghiệm nội bộ**.
- Chạy Pilot với dữ liệu bệnh nhân thật thì dùng bản native, hoặc rút ngắn tuổi
  thọ access token và bắt đăng nhập lại thường xuyên hơn.
- Mục này thuộc nhóm còn treo trong
  [`docs/security/README.md`](../security/README.md), không phải đã giải quyết.

---

## 5. Khi có trục trặc

| Hiện tượng | Nguyên nhân thường gặp |
|---|---|
| Trang trắng, không có gì | `--base-href` sai. Workflow đã có bước tự kiểm; xem log bước "Kiểm tra bản dựng". |
| Không thấy "Thêm vào Màn hình chính" | Đang mở bằng Chrome/Firefox. Phải dùng Safari. |
| App mở được, mọi thao tác báo lỗi mạng | Backend chưa bật, hoặc thiếu gốc `https://minhhal1180.github.io` trong `CORS_ORIGINS`. |
| Vẫn là bản cũ sau khi deploy | Service worker giữ bản cũ. Đóng hẳn app (vuốt lên) rồi mở lại. |
| Video call không mở được camera | iOS dưới 14.3, hoặc đã bấm Từ chối quyền. Vào Cài đặt → Safari → Camera để cấp lại. |

---

## 6. So với các đường khác

| | PWA | TestFlight | Sideload |
|---|---|---|---|
| Chi phí | 0 | 99 USD/năm | 0 |
| Tài khoản Apple | không cần | Developer Program | Apple ID thường |
| Hết hạn | không | 90 ngày/bản build | **7 ngày** |
| Gửi cho người ở xa | ✅ một link | ✅ email mời | ❌ phải cầm máy họ |
| Số người dùng | không giới hạn | 100 (Internal) | 3 app/máy |

Muốn lên TestFlight thật: [`testflight-checklist.md`](testflight-checklist.md).
