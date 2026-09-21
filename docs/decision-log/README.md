# Decision Log

Mọi quyết định kiến trúc/nghiệp vụ có ảnh hưởng lâu dài được ghi ở đây (Rule 13).

| ADR | Tiêu đề | Trạng thái | Ngày |
|---|---|---|---|
| [ADR-001](ADR-001-case-status-canonical.md) | Enum `case_status` 12 giá trị là canonical; 6 pha của Rule 7.1 là UI phase | Accepted | 2026-09-16 |
| [ADR-002](ADR-002-rbac-role-mapping.md) | Mapping 4 vai trò Rule 5.2 ↔ 8 role code của Developer Kit | Accepted | 2026-09-16 |
| [ADR-003](ADR-003-response-envelope.md) | Áp envelope `{success,data}` của Rule 6.2 lên toàn bộ API, sửa OpenAPI | Accepted | 2026-09-16 |
| [ADR-004](ADR-004-persistence-driver.md) | Repository port + 2 driver: `postgres` (chính thức) và `memory` (demo/test) | Accepted | 2026-09-16 |
| [ADR-005](ADR-005-modular-monolith.md) | Modular Monolith + Outbox thay vì microservice cho MVP | Accepted | 2026-09-16 |
| [ADR-006](ADR-006-video-provider-adapter.md) | Video qua `VideoProvider` port; driver `mock` mặc định trong Pilot | Accepted | 2026-09-16 |
| [ADR-007](ADR-007-cache-driver.md) | Cache port + driver `redis`/`memory`; hướng fail bất đối xứng của rate limit | Accepted | 2026-09-16 |
| [ADR-008](ADR-008-mobile-platform-templates.md) | Không commit `ios/`, `android/`; sinh lại từ template trong `tool/platform/` | Accepted | 2026-09-16 |
| [ADR-009](ADR-009-bundled-offline-first-aid-video.md) | Đóng gói video sơ cứu trong app và precache trong PWA | Accepted | 2026-09-21 |

## Open Decisions (chưa chốt — chặn Pilot thật)

Nguồn: `README_DEV.md` §"Các quyết định bắt buộc trước Pilot thật" và TDD §22.

- [ ] Cơ chế kết nối/định tuyến tới 115 và SLA tiếp nhận.
- [ ] Ai được phép đóng vai trò bác sĩ/nhân viên y tế trực.
- [ ] Cơ chế đồng ý chia sẻ vị trí, video, hồ sơ sức khỏe và ghi hình.
- [ ] Chính sách retention/xóa dữ liệu theo từng data class.
- [ ] Nguồn dữ liệu cơ sở y tế/điểm 115/trạng thái kíp xe.
- [ ] Quy trình xác thực người hỗ trợ tại chỗ (`LOCAL_RESPONDER`).
- [ ] Quy tắc xử lý báo nhầm, spam, duplicate case và abuse.
- [ ] Bộ hướng dẫn sơ cấp cứu đã được kiểm duyệt và version hóa.

> Cho tới khi các mục trên được chốt, hệ thống chạy ở chế độ **drill/mô phỏng**:
> `EMS_INTEGRATION_MODE=mock`, `RECORDING_ENABLED=false`.
