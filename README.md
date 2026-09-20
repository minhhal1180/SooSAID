# S.O.S Aid – Nền tảng hỗ trợ sơ cấp ngoại viện

Nguyên mẫu MVP/Pilot xây theo **Developer Kit v1.0** và bộ **Coding Rules** trong
[`.claude/rules/sos-aid.md`](.claude/rules/sos-aid.md).

> **Phạm vi (Rule 1.2).** Đây là nền tảng **hỗ trợ kết nối**, không thay thế tổng
> đài 115 và không thay thế bác sĩ. Hệ thống không chẩn đoán bệnh, không quyết
> định cấp cứu thay chuyên môn y tế, và **không tích hợp 115 thật**
> (`EMS_INTEGRATION_MODE=mock` — backend từ chối khởi động nếu đặt `live`).

## Trạng thái

| Thành phần | Công nghệ | Trạng thái |
|---|---|---|
| Backend API | NestJS + TypeScript | ✅ Chạy, build và test được |
| Dashboard tổng đài | Next.js 14 + TypeScript | ✅ Chạy và build được |
| Mobile người dân | Flutter | ✅ Đủ M01–M10, phân tích và test xanh |
| Pipeline iOS → TestFlight | GitHub Actions (macOS runner) | ✅ Sẵn sàng, chờ nạp secrets của Apple |
| Crew/Responder PWA | – | ❌ Chưa làm; API `/assignments/*` đã sẵn sàng |
| PostgreSQL + PostGIS | Migration + seed | ⚠️ SQL hoàn chỉnh, **chưa chạy thật trên máy này** (không có Docker); CI đã có job chạy trên Postgres thật |

**Kiểm thử:** 70 unit + 37 acceptance (backend) và 28 test (mobile) — tất cả xanh.
Acceptance test backend chạy trên driver `memory`; CI chạy lại chúng trên
PostgreSQL thật, vì một tính năng chỉ Done khi pass ở đó (Rule 15).

**Đưa app lên iPhone:** xem [`docs/mobile/ios-release.md`](docs/mobile/ios-release.md).

## Chạy thử trong 2 phút (không cần Docker)

```bash
# 1. Backend
cd apps/api
npm install
cp .env.example .env
npm run start:dev          # http://localhost:3000/v1

# 2. Dashboard (tab khác)
cd apps/operator-web
npm install
cp .env.local.example .env.local
npm run dev                # http://localhost:3001
```

Mở http://localhost:3001 → chọn vai trò → **Vào ca trực**.

Mặc định chạy `PERSISTENCE_DRIVER=memory` và `CACHE_DRIVER=memory`
([ADR-004](docs/decision-log/ADR-004-persistence-driver.md)): dữ liệu **không
bền vững**, mất khi restart. Băng cảnh báo trên dashboard và
`degraded.persistence` trong `/v1/health` luôn nói rõ điều này.

## Chạy với PostgreSQL thật

```bash
docker compose -f infra/docker-compose.yml up -d     # Postgres+PostGIS, Redis, MinIO, LiveKit
node scripts/migrate.mjs --seed

# apps/api/.env
PERSISTENCE_DRIVER=postgres
CACHE_DRIVER=redis
DATABASE_URL=postgresql://sos:sos_local_only@localhost:5432/sos_aid
REDIS_URL=redis://localhost:6379
```

## Mobile

```bash
cd apps/mobile

# Sinh thư mục nền tảng + áp cấu hình quyền (chạy một lần)
./tool/bootstrap_platforms.sh          # macOS/Linux/Git Bash
.\tool\bootstrap_platforms.ps1         # Windows

flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/v1
```

Lên iPhone thật: [`docs/mobile/testflight-checklist.md`](docs/mobile/testflight-checklist.md)
(đường ngắn, chỉ TestFlight) hoặc [`docs/mobile/ios-release.md`](docs/mobile/ios-release.md)
(bản đầy đủ, tới App Store).
Biên dịch iOS bắt buộc chạy trên macOS, nên workflow
[`mobile-ios.yml`](.github/workflows/mobile-ios.yml) dùng macOS runner để build
IPA và nộp TestFlight — không cần Mac ở máy phát triển.

## Kiểm thử

```bash
cd apps/api
npm test              # 70 unit test
npm run test:e2e      # 37 acceptance test, map theo TC-xxx trong tests/test_cases.csv

cd ../mobile
flutter test          # 28 test cho model, adapter video, vòng đời cuộc gọi
```

## Cấu trúc

```
sos-aid/
├── .github/workflows/        CI + pipeline build iOS/TestFlight
├── apps/
│   ├── api/                  NestJS modular monolith (14 module)
│   ├── operator-web/         Next.js dashboard tổng đài/bác sĩ trực
│   └── mobile/               Flutter app cho người dân (M01–M10)
│       └── tool/platform/    Cấu hình iOS/Android (Info.plist, Podfile...)
├── packages/api-contract/    Enum + kiểu dùng chung (nguồn duy nhất)
├── db/
│   ├── migrations/           0001 baseline · 0002 Rule 4.1 · 0003 kíp xe
│   └── seeds/                Dữ liệu mô phỏng cho phát triển
├── docs/
│   ├── api/openapi.yaml      Contract có hiệu lực (Rule 6.1)
│   ├── architecture/         Vòng đời ca, runbook, sơ đồ
│   ├── database/             Quy ước schema và lý do
│   ├── decision-log/         6 ADR + danh sách Open Decisions
│   ├── security/             Đối chiếu threat model ↔ code
│   ├── planning/             Backlog và sprint plan từ kit
│   └── reference/            Bản gốc của Developer Kit, giữ nguyên
├── infra/docker-compose.yml
├── scripts/                  migrate.mjs, sync-contract.mjs
└── tests/test_cases.csv      Bộ test case gốc để đối chiếu
```

## Kiến trúc

**Modular Monolith + Event-Driven + Outbox** (Rule 2.1,
[ADR-005](docs/decision-log/ADR-005-modular-monolith.md)).

14 module: `auth`, `users`, `emergency-case`, `location`, `triage`,
`video-session`, `first-aid-guide`, `dispatch`, `directory`, `notification`,
`medical-handover`, `audit-log`, `outbox`, `realtime`.

Module giao tiếp qua **port được inject** hoặc **domain event qua outbox** —
không import repository của nhau (Rule 2.2). Bản ghi nghiệp vụ và dòng
`outbox_events` commit **cùng một transaction**, nên không thể có chuyện "ca đã
tạo nhưng không ai được báo".

Mọi phụ thuộc bên ngoài nằm sau adapter: `VideoProvider`, `NotificationProvider`,
`CachePort`, repository port. Đổi LiveKit → Twilio chỉ cần thêm một class.

## Luồng S.O.S (Rule 7.2)

```
Người dân bấm S.O.S
  1. Tạo ca (Idempotency-Key, transaction)
  2. Ghi nhận thời điểm (kiểm tra lệch đồng hồ thiết bị)
  3. Lấy GPS best-effort — KHÔNG có GPS vẫn tạo được ca
  4. Sinh mã ca SOS-YYYYMMDD-NNNNNN (advisory lock, không trùng)
  5. Phát cảnh báo qua outbox → notification + realtime
  6. Đẩy vào hàng đợi tổng đài (CREATED → QUEUED, hệ thống thực hiện)
  7. Mở phiên video (ngoài transaction — video lỗi không làm hỏng ca)
  8. Ghi timeline vào case_status_history (append-only)
```

## Quyết định kiến trúc

| ADR | Nội dung |
|---|---|
| [001](docs/decision-log/ADR-001-case-status-canonical.md) | 12 trạng thái của kit là canonical; 6 pha của Rule 7.1 là UI phase |
| [002](docs/decision-log/ADR-002-rbac-role-mapping.md) | 8 role code cưỡng chế; 4 vai trò của Rule 5.2 là nhóm khái niệm |
| [003](docs/decision-log/ADR-003-response-envelope.md) | Envelope `{success,data,requestId}` cho toàn bộ API |
| [004](docs/decision-log/ADR-004-persistence-driver.md) | Repository port + driver `postgres` (chính thức) / `memory` (demo) |
| [005](docs/decision-log/ADR-005-modular-monolith.md) | Modular Monolith + Outbox thay vì microservice |
| [006](docs/decision-log/ADR-006-video-provider-adapter.md) | Video qua port; driver `mock` mặc định trong Pilot |

## Chặn Pilot có dữ liệu thật

Không chạy ca thật cho tới khi các mục sau được chốt — chi tiết ở
[decision-log](docs/decision-log/README.md#open-decisions-chưa-chốt--chặn-pilot-thật)
và [security](docs/security/README.md#chưa-triển-khai--chặn-pilot-có-dữ-liệu-thật):

- **Cổng OIDC/MFA cho tài khoản nghiệp vụ** (SOS-004) — khoảng trống lớn nhất
- Bộ hướng dẫn sơ cấp cứu được chuyên gia y tế phê duyệt (hiện toàn bộ là `DRAFT`)
- Cơ chế kết nối/SLA với đầu mối 115
- Chính sách đồng ý và retention cho vị trí, video, hồ sơ sức khỏe
- Quy trình xác thực người hỗ trợ tại chỗ
- Pentest và pipeline CI có SAST/secret scan

## Quy ước làm việc

- Branch: `feature/SOS-xxx-description` · Commit: `[SOS-123] Mô tả thay đổi`
- Đổi DB → tạo migration mới, không sửa migration cũ
- Thêm tính năng → cập nhật `docs/` tương ứng (Rule 13)
- Sửa `packages/api-contract` → chạy `npm run sync:contract`
