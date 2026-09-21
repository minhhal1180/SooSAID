# ADR-009 – Đóng gói video sơ cứu trong app và precache trong PWA

- **Trạng thái:** Accepted
- **Ngày:** 2026-09-21

## Bối cảnh

Cache hướng dẫn từ API chỉ hữu ích sau khi người dùng đã đăng nhập và kết nối
mạng ít nhất một lần. Đây không đáp ứng tình huống mở ứng dụng lần đầu ở vùng
không có sóng. Stream video từ URL cũng thất bại đúng trong tình huống cần nó.

## Quyết định

- Bộ video tối thiểu nằm trong Flutter assets.
- Thư viện offline mở được trước đăng nhập.
- Native đóng gói file vào binary; PWA thêm file vào `CORE` của service worker.
- Mọi video có version, transcript và cờ `drillOnly`.
- Video không tự phát và luôn có bản chữ dự phòng.
- Nội dung chưa phê duyệt phải gắn nhãn diễn tập ở cả danh sách và player.

## Hệ quả

- Ứng dụng tăng dung lượng theo kích thước video; cần giới hạn bitrate/thời
  lượng và đo trên mạng di động trước phát hành.
- Sửa nội dung video cần phát hành app/PWA mới, đổi lại người dùng có bản ổn
  định, không bị nội dung từ xa thay đổi ngoài kiểm soát.
- GitHub Pages chỉ phân phối frontend; lần cài/tải PWA đầu tiên vẫn cần mạng.
- Quyền sử dụng media và phê duyệt y khoa trở thành release gate bắt buộc.
