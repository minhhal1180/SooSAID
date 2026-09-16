# ADR-004 – Repository port + 2 driver: `postgres` (chính thức) và `memory` (demo/test)

- **Status:** Accepted
- **Date:** 2026-09-16

## Bối cảnh

Rule 3.1 bắt buộc PostgreSQL + PostGIS. Máy phát triển hiện tại không có Docker,
không có PostgreSQL server, nên nguyên mẫu không thể khởi động để demo/kiểm thử nếu
chỉ có driver Postgres.

Yêu cầu mâu thuẫn: (a) không được đổi DB mandated; (b) nguyên mẫu phải chạy được ngay.

## Quyết định

Mỗi module khai báo repository dưới dạng **interface (port)** + injection token.
Có hai adapter cho mỗi port:

| Driver | Khi nào dùng | Trạng thái |
|---|---|---|
| `postgres` | DEV/SIT/UAT/Pilot — **driver chính thức duy nhất** | Mặc định khi có `DATABASE_URL` |
| `memory` | Local demo + unit/acceptance test khi chưa có Docker | Chỉ bật bằng `PERSISTENCE_DRIVER=memory` |

`PersistenceModule` chọn adapter theo env một lần lúc bootstrap. Domain service
**không biết** đang chạy driver nào.

Chốt an toàn (`apps/api/src/persistence/persistence.module.ts`):
- `PERSISTENCE_DRIVER=memory` **bị từ chối khi `NODE_ENV=production`** — bootstrap fail
  ngay, không im lặng chạy tiếp.
- Khi chạy driver `memory`, log cảnh báo `PERSISTENCE_DRIVER=memory (NON-DURABLE)` mỗi
  lần khởi động và trả field `degraded.persistence = true` ở `GET /v1/health`.

Truy vấn không gian (`ST_DWithin`, `ST_Distance`) chỉ có ở driver Postgres. Driver
`memory` tính khoảng cách bằng Haversine và **đánh dấu `spatialAccuracy: 'approximate'`**
trong kết quả, để không ai nhầm nó tương đương PostGIS.

## Hệ quả

- ✅ `npm run start:dev` chạy được ngay, demo được toàn bộ luồng SOS không cần Docker.
- ✅ Unit test và acceptance test chạy nhanh, không cần container.
- ✅ Không thêm dependency nào (driver `memory` chỉ dùng `Map` của JS) — tuân Rule 14.
- ⚠️ Driver `memory` mất dữ liệu khi restart; **không** phải bản sao ngữ nghĩa của
  Postgres (không transaction thật, không constraint, không PostGIS).
- ⚠️ Integration test bắt buộc chạy trên driver `postgres` trong CI. Một tính năng chỉ
  được coi là Done khi đã pass trên `postgres` (Rule 15).

## Phương án đã cân nhắc và loại bỏ

- **SQLite (better-sqlite3):** thêm native dependency, vẫn mất PostGIS, và tạo ảo giác
  "gần giống Postgres" nguy hiểm hơn là một in-memory store thẳng thắn.
- **Chỉ Postgres:** sạch nhất về kiến trúc nhưng nguyên mẫu không chạy được cho tới khi
  cài Docker Desktop.
