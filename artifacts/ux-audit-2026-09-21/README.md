# UX audit — S.O.S Aid mobile/PWA

Ngày kiểm tra: 2026-09-21

Viewport: 390 × 844, Microsoft Edge headless
Phạm vi: màn hình trước đăng nhập, thư viện sơ cứu offline và trình phát video.

## Kết quả

### 1. Điểm vào khẩn cấp

- Nút **Gọi 115** và **Xem video sơ cứu offline** hiện trước bước đăng nhập.
- Đăng nhập OTP được hạ xuống thành tác vụ phụ, không chặn nội dung hỗ trợ khẩn cấp.
- Thông báo phạm vi sản phẩm được viết lại rõ hơn: ứng dụng không thay thế tổng đài 115.

Bằng chứng: [07-final-start.png](07-final-start.png)

### 2. Thư viện offline

- Bốn video đóng gói sẵn được trình bày thành danh sách dễ quét, có thời lượng và nhãn
  **Không cần mạng**.
- Nút gọi 115 được giữ ở đầu màn hình.
- Mục hướng dẫn dạng chữ vẫn được giữ làm phương án dự phòng.

Bằng chứng: [08-final-library.png](08-final-library.png)

### 3. Trình phát và khả năng tiếp cận nội dung

- Video không tự phát; nút phát có vùng chạm 64 × 64.
- Mỗi video có transcript theo từng bước và thông báo rõ đây là bản diễn tập chưa được
  chuyên gia y tế phê duyệt.
- Nếu video không giải mã được, phần hướng dẫn chữ vẫn dùng được.

Bằng chứng: [09-final-player.png](09-final-player.png)

### 4. Kiểm tra mất mạng

Sau khi service worker cài và cache xong, trình duyệt được đặt về trạng thái offline hoàn
toàn. PWA vẫn mở được thư viện, mở player và phát video từ asset cục bộ.

- Player mở khi offline: [10-offline-verified.png](10-offline-verified.png)
- Video đang phát khi offline: [11-offline-playing.png](11-offline-playing.png)

## Lỗi quan trọng đã sửa

1. Thư viện sơ cứu bị chặn sau đăng nhập.
2. `AppStateScope` nằm trong `MaterialApp.home`, khiến route được push không nhận được state
   và có thể trắng màn hình.
3. Video web chỉ được cache sau lần mở đầu tiên; hiện bốn MP4 được thêm vào `CORE` của
   service worker ngay sau build.
4. UI cũ chưa phân cấp rõ hành động khẩn cấp và hành động đăng nhập.

## Giới hạn của lần kiểm tra

- Chưa chạy VoiceOver/TalkBack và chưa kiểm tra trên thiết bị iOS/Android vật lý.
- Bốn video hiện tại chỉ là nội dung demo/drill. Không được dùng cho ca thật trước khi có
  phê duyệt y khoa và quyền phân phối media bằng văn bản.
- Luồng SOS online vẫn cần một backend HTTPS thực; GitHub Pages chỉ phục vụ frontend/PWA.
