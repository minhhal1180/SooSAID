# Kiến trúc

Modular Monolith + Event-Driven + Outbox (Rule 2.1,
[ADR-005](../decision-log/ADR-005-modular-monolith.md)).

## Module và trách nhiệm

| Module | Trách nhiệm | Bảng sở hữu |
|---|---|---|
| `auth` | OTP, phát/thu hồi token, chặn tài khoản nghiệp vụ khỏi OTP tiêu dùng | – (dùng cache) |
| `users` | Hồ sơ, hồ sơ sức khỏe khẩn cấp, danh bạ liên hệ, thiết bị | `users`, `user_roles`, `emergency_profiles`, `emergency_contacts`, `devices` |
| `emergency-case` | Vòng đời ca, state machine, hàng đợi, ghi chú | `emergency_cases`, `case_status_history`, `case_notes` |
| `location` | Chuỗi mẫu vị trí | `case_locations` |
| `triage` | Bộ câu hỏi quan sát và phiếu đã gửi | `triage_submissions` |
| `video-session` | Phiên video qua `VideoProvider` port | `video_sessions` |
| `first-aid-guide` | Danh mục hướng dẫn có version + nhật ký đã gửi | `guidance_catalog`, `guidance_events` |
| `dispatch` | Phân công kíp xe/người hỗ trợ | `dispatch_assignments` |
| `directory` | Service area, cơ sở y tế, điểm hỗ trợ, lực lượng | `service_areas`, `medical_facilities`, `local_resources`, `ambulance_units`, `responders` |
| `notification` | Consumer outbox → thông báo người thân | `notification_deliveries` |
| `medical-handover` | Hồ sơ bàn giao bất biến + báo cáo pilot | `handovers` |
| `audit-log` | Audit trail | `audit_logs` |
| `outbox` | Ghi/phát domain event | `outbox_events` |
| `realtime` | WebSocket gateway | – |

## Giao tiếp xuyên module (Rule 2.2)

Ba kênh hợp lệ, không có kênh thứ tư:

**1. Service công khai** — `medical-handover` gọi `TriageService.listByCase()`
để dựng hồ sơ. Đọc dữ liệu đồng bộ, đã qua kiểm tra quyền của module chủ.

**2. Port được inject** — khi phụ thuộc có nguy cơ thành vòng tròn:

| Port | Ai định nghĩa | Ai cài đặt |
|---|---|---|
| `EMERGENCY_PROFILE_SNAPSHOT_PORT` | `emergency-case` | `users` |
| `CASE_ASSIGNMENT_CHECKER_PORT` | `emergency-case` | `dispatch` (module `CaseAssignmentChecker` riêng) |

`CaseAssignmentChecker` được tách khỏi `DispatchService` có chủ đích:
`DispatchService` cần `EmergencyCaseService`, còn `EmergencyCaseService` cần câu
trả lời "user có được phân công không". Để chung một class sẽ tạo vòng phụ thuộc
và buộc phải dùng `forwardRef` — thứ che giấu vấn đề thiết kế thay vì giải quyết.

**3. Domain event qua outbox** — khi có side effect:

```
EmergencyCaseService.createCase()
  └─ transaction {
       INSERT emergency_cases
       INSERT case_status_history
       INSERT outbox_events (case.created)     ← cùng commit
     }
        ↓ OutboxDispatcher poll mỗi 1s
     DomainEventBus.publish()
        ├─ NotificationService  → thông báo người thân
        └─ RealtimeGateway      → đẩy tới dashboard
```

Bảo đảm **at-least-once**: event có thể phát lại nếu process chết giữa chừng, nên
mọi handler phải idempotent. `NotificationService` khoá theo
`(case_id, template_code, recipient_hash)` để người thân không nhận hai lần.

## Adapter ra bên ngoài

| Port | Driver hiện có | Chọn bằng |
|---|---|---|
| Repository (mỗi module) | `postgres`, `memory` | `PERSISTENCE_DRIVER` |
| `CachePort` | `redis`, `memory` | `CACHE_DRIVER` |
| `VideoProviderPort` | `mock`, `livekit` | `VIDEO_PROVIDER` |
| `NotificationProviderPort` | `mock` | `PUSH_PROVIDER` |

Domain không bao giờ gọi SDK trực tiếp (Rule 8.1).

## Lớp cắt ngang toàn cục

Đăng ký một lần ở `app.module.ts` thay vì rải trên từng controller — bảo mật và
định dạng response phải là **mặc định**, không phải thứ ai đó nhớ thì thêm:

| Thành phần | Vai trò |
|---|---|
| `RequestContextMiddleware` | Sinh/nhận `requestId`, mở AsyncLocalStorage cho audit |
| `JwtAuthGuard` | Xác thực — deny-by-default |
| `RolesGuard` | RBAC thô theo `@Roles` |
| `ResponseEnvelopeInterceptor` | Bọc envelope Rule 6.2 |
| `DomainExceptionFilter` | Map lỗi → envelope, chặn stack trace lọt ra ngoài |
| `ValidationPipe` | `whitelist` + `forbidNonWhitelisted`; không trả giá trị đã gửi trong thông báo lỗi |

## Realtime

Socket.IO namespace `/realtime`. Token đi trong handshake `auth`, **không** trong
query string (query string bị ghi vào access log của proxy). Đăng ký nhận event
của một ca phải qua đúng `CaseAccessPolicy` như REST.

Envelope có `sequence` theo ca. Client **không được** dựng state chỉ từ event
push: thấy khoảng trống hoặc vừa reconnect thì phải fetch snapshot REST (TDD
§10.3, TC-010). Dashboard hiện tại đi xa hơn — mọi event chỉ là **tín hiệu để
tải lại snapshot**, loại bỏ hẳn lớp lỗi "màn hình khác dữ liệu thật".

## Degraded mode

| Hỏng | Hệ quả | Xử lý |
|---|---|---|
| Video provider | Không join được phòng | 503 `PROVIDER_UNAVAILABLE`, trạng thái ca giữ nguyên, client chuyển thoại |
| Redis | Rate limit và realtime degrade | Rate limit SOS fail-open, dashboard chuyển sang polling 10s |
| Push provider | Thông báo không tới | Outbox retry, đánh dấu `FAILED` sau ngưỡng; ca không bị ảnh hưởng |
| Map provider | Không có bản đồ | Hiển thị toạ độ + địa chỉ + chỉ dẫn tiếp cận |
| Object storage | Không upload được media | Không chặn tạo ca/điều phối |
| PostgreSQL | Core outage | **Không claim ca đã tạo**; mobile hiển thị hành động khẩn cấp trực tiếp; SEV-1 |

Trạng thái degraded lộ ra qua `GET /v1/health` và hiển thị thành băng cảnh báo
trên dashboard.

## Sơ đồ

Mã Mermaid gốc từ Developer Kit nằm trong [`diagrams/`](diagrams/):
`system_context`, `container_architecture`, `case_state`, `emergency_sequence`,
`er_overview`, `deployment`.
