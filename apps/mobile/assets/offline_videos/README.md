# Video sơ cứu offline

Các file MP4 trong thư mục này được đóng gói cùng ứng dụng và PWA để mở được
khi không có mạng.

## Trạng thái nội dung hiện tại

Đây là video **DEMO/DRILL**, dựng từ bốn khung nội dung `DRAFT` trong
`db/seeds/0001_dev_seed.sql`. Video chỉ minh hoạ luồng offline; chưa phải phác
đồ y khoa và chưa được dùng cho ca thật.

Trước Pilot thật phải:

1. Có chuyên gia y tế chịu trách nhiệm nội dung phê duyệt kịch bản và bản dựng.
2. Thay MP4 bằng bản đã duyệt, giữ codec H.264/yuv420p để chạy ổn định trên
   iOS, Android và trình duyệt.
3. Cập nhật version, transcript và `drillOnly` trong
   `lib/models/offline_video_guide.dart`.
4. Kiểm tra checksum, thời lượng, phụ đề/transcript và thử trên thiết bị thật.

Không tải lại video từ YouTube hoặc nguồn khác nếu chưa có quyền phân phối
offline bằng văn bản.
