# S.O.S Aid – Coding Rules for AI Agent

> Agent đọc file này **trước mỗi lần generate code**.
> Nguồn chuẩn nghiệp vụ: `docs/` trong repo + Developer Kit v1.0
> (`api/openapi.yaml`, `db/schema.sql`, TDD v1.0, backlog, test cases, threat model).

## 1. General Development Rules

### Rule 1.1 – Understand before coding
Trước khi tạo/chỉnh sửa code phải đọc: Technical Design Document, API Contract
(`docs/api/openapi.yaml`), Database Schema (`db/migrations/`), User Story /
Acceptance Criteria (`docs/planning/backlog.csv`), Security Requirement
(`docs/security/`).

Không được: tự suy diễn nghiệp vụ; tự thêm chức năng chưa có trong tài liệu;
thay đổi flow nghiệp vụ khi chưa có yêu cầu.

### Rule 1.2 – Respect MVP scope
S.O.S Aid là MVP/Pilot, **không phải hệ thống cấp cứu chính thức**. Ứng dụng hỗ trợ
kết nối người gặp nạn – người hỗ trợ – lực lượng y tế, **không thay thế 115 hoặc bác sĩ**.

Không được implement: tự động chẩn đoán bệnh; quyết định cấp cứu thay bác sĩ;
tự động điều phối xe cấp cứu thật; tích hợp 115 thật khi chưa có API/SLA/phê duyệt.

## 2. Architecture Rules

### Rule 2.1 – Backend Architecture
Modular Monolith + Event Driven + Outbox Pattern. Không tạo microservice riêng
khi chưa được yêu cầu.

```
apps/api/src/modules/
 ├── auth            ├── users            ├── emergency-case
 ├── location        ├── triage           ├── video-session
 ├── first-aid-guide ├── dispatch         ├── directory
 ├── notification    ├── medical-handover ├── audit-log
 ├── outbox          └── realtime
```

### Rule 2.2 – Module Isolation
Mỗi module có: `controller/ service/ repository/ dto/ entity/ event/ tests/`.

Không được: import trực tiếp repository/bảng DB của module khác; gọi service
xuyên module không qua interface (port) hoặc domain event.

## 3. Technology Rules

### Rule 3.1 – Mandatory Stack

| Layer | Technology |
|---|---|
| Mobile | Flutter |
| Web Dashboard | React / Next.js + TypeScript |
| Backend | NestJS + TypeScript |
| Database | PostgreSQL + PostGIS |
| Cache | Redis |
| Realtime | WebSocket / Socket.IO |
| Video | WebRTC adapter |
| Storage | S3 compatible |
| Push | FCM/APNs |

Không đổi: MongoDB/Firebase thay Postgres; socket khác WebSocket; video SDK hard-code.

> Ngoại lệ đã phê duyệt: `ADR-004` – adapter persistence `memory` chỉ dùng cho
> local demo/test khi chưa có Docker. PostgreSQL vẫn là driver chính thức.

## 4. Database Rules

### Rule 4.1 – Database Design
Mọi bảng phải có: `id`, `created_at`, `updated_at`, `created_by`, `updated_by`.

### Rule 4.2 – Emergency Case Data
Mọi dữ liệu liên quan ca cấp cứu phải có `case_id`.
Không lưu video/image/audio trực tiếp trong DB — chỉ lưu `storage_key`
(object storage), `metadata`, `checksum_sha256`.

## 5. Security Rules

### Rule 5.1 – Sensitive Data
Vị trí GPS, video hiện trường, hồ sơ sức khỏe, hình ảnh người bệnh = **Sensitive
Medical Data**. Bắt buộc: validate quyền truy cập; ghi audit log; không expose API
public; không ghi dữ liệu nhạy cảm vào log.

### Rule 5.2 – Permission Model
RBAC. Vai trò nghiệp vụ theo Rule: `USER`, `SUPPORTER`, `MEDICAL_STAFF`, `ADMIN`.
Mapping sang role code của Developer Kit (xem `ADR-002`):

| Rule role | Role code hệ thống |
|---|---|
| USER | `CITIZEN` |
| SUPPORTER | `LOCAL_RESPONDER` |
| MEDICAL_STAFF | `OPERATOR_115`, `CLINICIAN`, `AMBULANCE_CREW`, `FACILITY_USER` |
| ADMIN | `ADMIN`, `AUDITOR` |

## 6. API Rules

### Rule 6.1 – API First
Không code backend trước contract.
`Requirement → API Contract → DTO → Controller → Service → Repository`.

### Rule 6.2 – API Response Format
```jsonc
// Success
{ "success": true, "data": {}, "requestId": "..." }
// Error
{ "success": false, "error": { "code": "", "message": "", "details": [] }, "requestId": "..." }
```
Envelope được áp dụng tự động bởi `ResponseEnvelopeInterceptor` +
`DomainExceptionFilter`. Controller **trả về payload trần**, không tự bọc envelope.

## 7. Emergency Workflow Rules

### Rule 7.1 – Emergency Case Lifecycle
Trạng thái kỹ thuật canonical = enum `case_status` (12 giá trị, xem `ADR-001`).
Không được tự tạo trạng thái khác ngoài enum này.
6 pha nghiệp vụ trong rule gốc là **UI phase**, được suy ra bằng
`casePhaseOf(status)` — không lưu vào DB.

```
CREATED → QUEUED → ACCEPTED → VIDEO_CONNECTED → DISPATCHED
        → EN_ROUTE → ON_SCENE → HANDOVER_PENDING → HANDED_OVER → CLOSED
        (+ CANCELLED, FALSE_ALARM)
```

### Rule 7.2 – SOS Button Flow
Thứ tự bắt buộc khi user nhấn SOS:
1. Create emergency case → 2. Capture timestamp → 3. Get GPS location →
4. Generate case ID/code → 5. Send alert → 6. Connect support →
7. Start video session → 8. Save timeline.

## 8. Video Call Rules

### Rule 8.1
Không gọi trực tiếp SDK video từ domain/service.
Sai: `Agora.startCall()` · Đúng: `VideoProvider.startSession()`.
Provider (LiveKit/Twilio/Agora/mock) nằm sau `VIDEO_PROVIDER` token, chọn bằng env.

## 9. AI Coding Style Rules

### Rule 9.1
Clean code, type safe, comment **giải thích nghiệp vụ** (không phải `// do something`),
có unit test.

### Rule 9.2 – No Hard Code
Dùng enum/const, không magic string/number.
Sai: `if (status === 'DONE')`, `timeout = 5000`
Đúng: `CaseStatus.CLOSED`, `VIDEO_SESSION_TOKEN_TTL_SECONDS`

## 10. Testing Rules
Mỗi feature có Unit Test (`*.spec.ts`), Integration Test (`tests/e2e`),
Acceptance Test map theo `tests/acceptance/` ↔ `TC-xxx` trong test_cases.csv.

## 11. Logging Rules
Không log: CCCD, số điện thoại đầy đủ, hình ảnh, video URL có chữ ký, medical info,
OTP, raw token. Được log: `caseId`, `userId`, `event`, `timestamp`, `status`,
`requestId`. Dùng `SafeLogger` — không dùng `console.log` trực tiếp.

## 12. Git Rules
Branch: `feature/SOS-xxx-description`, `bugfix/SOS-xxx-description`
Commit: `[SOS-123] Add emergency case creation flow`
Không commit message kiểu: `fix bug`, `update`, `test`.

## 13. Documentation Rules
Mỗi feature mới cập nhật `/docs`: `architecture`, `api`, `database`,
`decision-log`, `security`.

## 14. Agent Behavior Rules
**DO**: hỏi lại khi thiếu requirement; đề xuất phương án trước khi đổi architecture;
tạo migration khi đổi DB; viết test trước khi merge; giải thích trade-off.

**DON'T**: tự refactor toàn bộ project; đổi framework; thêm dependency không cần
thiết; bypass security; fake dữ liệu y tế thật.

## 15. Definition of Done
☑ Requirement verified ☑ API updated ☑ Database migration created
☑ Backend implemented ☑ Frontend/Mobile updated ☑ Unit test passed
☑ Security reviewed ☑ Documentation updated
