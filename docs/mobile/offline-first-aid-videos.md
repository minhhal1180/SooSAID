# Video hướng dẫn sơ cứu offline

## Mục tiêu

Người dùng phải mở được hướng dẫn ban đầu khi không có sóng, chưa đăng nhập
hoặc backend đang lỗi. Video vì vậy được đóng gói trong ứng dụng, không stream
từ Internet và không phụ thuộc API.

## Luồng người dùng

1. Màn hình đầu tiên luôn có nút **Xem video sơ cứu offline**.
2. Thư viện hiển thị bốn video đã lưu trên máy, thời lượng và transcript.
3. Video không tự phát; người dùng chủ động bấm Play.
4. Nếu codec/player lỗi, các bước bằng chữ vẫn hiển thị ngay bên dưới.
5. Nút gọi 115 có ở thư viện và từng màn hình video.

## Cách lưu offline

- Native iOS/Android: MP4 nằm trong Flutter assets và đi cùng binary.
- PWA: sau `flutter build web`, script
  `apps/mobile/tool/precache_offline_videos.mjs` đưa bốn MP4 vào danh sách
  `CORE` của Flutter service worker. Chúng được tải ngay khi PWA được cài/lần
  đầu tải thành công, thay vì chờ người dùng mở từng video.
- Workflow GitHub Pages kiểm tra cả sự tồn tại của file lẫn mục precache trước
  khi deploy.

## Quản trị nội dung y khoa

Các MP4 hiện tại là **DEMO/DRILL**, dựng từ nội dung `DRAFT` trong seed. Chúng
không phải phác đồ và chưa được dùng cho ca thật.

Trước Pilot thật:

1. Chuyên gia y tế phê duyệt kịch bản, hình, lời đọc và transcript theo quy
   trình của đơn vị; tham chiếu bộ hướng dẫn hiện hành như
   [IFRC International First Aid, Resuscitation and Education Guidelines 2025](https://www.ifrc.org/document/international-first-aid-resuscitation-and-education-guidelines).
2. Xác nhận quyền phân phối offline cho toàn bộ hình, nhạc, giọng đọc và video.
3. Thay MP4, tăng `version`, cập nhật transcript và chỉ bỏ `drillOnly` sau khi
   có phê duyệt bằng văn bản.
4. Kiểm thử trên iPhone/Android thật, gồm chế độ máy bay và cài mới PWA.

Không tải lại video YouTube hoặc nội dung bên thứ ba nếu chưa có quyền phân
phối offline.
