# S.O.S Aid – Developer Starter Kit

Bộ tài nguyên này chuyển hóa hồ sơ ý tưởng **S.O.S Aid – Ứng dụng hỗ trợ sơ cấp ngoại viện** thành một blueprint kỹ thuật có thể triển khai.

## Nguyên tắc quan trọng

1. Đây là **thiết kế kỹ thuật đề xuất** cho MVP/Pilot, không phải tài liệu tích hợp chính thức với hệ thống 115.
2. Luồng y tế, nội dung hướng dẫn sơ cấp cứu, quy tắc phân loại và quyền truy cập dữ liệu phải được chuyên gia y tế/pháp chế phê duyệt trước khi chạy ca thật.
3. Giai đoạn đầu nên vận hành **mô phỏng/giả lập** với đầu mối 115/cơ sở y tế; chỉ tích hợp thật khi có thỏa thuận, API/quy chế, SLA và cơ chế bảo mật chính thức.
4. Backend MVP được khuyến nghị dùng **Modular Monolith + event/outbox**, tránh microservice quá sớm nhưng vẫn tách module rõ để mở rộng.

## Stack tham chiếu

- Mobile: Flutter
- Web dashboard: React / Next.js + TypeScript
- Backend: NestJS + TypeScript
- Database: PostgreSQL + PostGIS
- Cache/realtime coordination: Redis
- Realtime UI: WebSocket / Socket.IO
- Video: WebRTC qua LiveKit/Twilio/Agora (adapter pattern)
- Object storage: S3-compatible (MinIO cho local dev)
- Push: FCM/APNs
- Map: Google Maps/Mapbox/nhà cung cấp bản đồ phù hợp (adapter pattern)
- Observability: OpenTelemetry + Prometheus/Grafana + centralized logs + Sentry tương đương

## Cấu trúc bộ kit

- `docs/SOS_Aid_Technical_Design_v1.0.docx`: tài liệu kỹ thuật tổng thể.
- `api/openapi.yaml`: contract REST API tham chiếu.
- `api/SOS_Aid.postman_collection.json`: collection mẫu để kiểm thử API.
- `db/schema.sql`: database schema PostgreSQL/PostGIS tham chiếu.
- `db/sample_seed.sql`: dữ liệu seed mẫu cho local dev.
- `diagrams/*.mmd`: mã Mermaid cho các sơ đồ hệ thống.
- `planning/backlog.csv`: backlog developer-ready theo Epic/User Story/Acceptance Criteria.
- `planning/sprint_plan.csv`: kế hoạch sprint 18 tuần tham chiếu.
- `tests/test_cases.csv`: bộ test case cốt lõi.
- `infra/docker-compose.yml`: môi trường local dev mẫu.
- `infra/.env.example`: biến môi trường mẫu.
- `security/threat_model.md`: threat model và checklist bảo mật.
- `ops/runbook.md`: runbook vận hành/incident cơ bản.

## Luồng bắt đầu cho Developer

1. Đọc tài liệu kỹ thuật và chốt các `Open Decision`.
2. Copy `infra/.env.example` thành `.env`, thay secrets local.
3. Chạy database/cache/object storage bằng Docker Compose.
4. Apply `db/schema.sql` và `db/sample_seed.sql`.
5. Import `api/openapi.yaml` vào Swagger Editor/Stoplight/Postman để thống nhất contract.
6. Implement theo thứ tự Sprint trong `planning/sprint_plan.csv`.
7. Chỉ bật recording/video retention sau khi policy dữ liệu được phê duyệt.

## Các quyết định bắt buộc trước Pilot thật

- Cơ chế kết nối/định tuyến tới 115 và SLA tiếp nhận.
- Ai là người được phép đóng vai trò bác sĩ/nhân viên y tế trực.
- Cơ chế đồng ý chia sẻ vị trí, video, hồ sơ sức khỏe và ghi hình.
- Chính sách retention/xóa dữ liệu cho từng loại dữ liệu.
- Nguồn dữ liệu cơ sở y tế/điểm 115/trạng thái kíp xe.
- Quy trình xác thực người hỗ trợ tại chỗ.
- Quy tắc xử lý báo nhầm, spam, duplicate case và abuse.
- Bộ hướng dẫn sơ cấp cứu đã được kiểm duyệt và version hóa.
