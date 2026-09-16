# ADR-007 – Cache port + driver `redis` (chính thức) / `memory` (demo)

- **Status:** Accepted
- **Date:** 2026-09-16

## Bối cảnh

Rule 3.1 bắt buộc Redis. Redis được dùng cho ba việc:

1. **Rate limit** OTP và tạo ca S.O.S (TC-026, TC-027).
2. **OTP tạm thời** — lưu bản băm, TTL 5 phút.
3. **Phiên refresh token** — để thu hồi được từng phiên (remote logout).

Máy phát triển không có Redis (cùng lý do với PostgreSQL trong
[ADR-004](ADR-004-persistence-driver.md)).

## Quyết định

Đối xứng với ADR-004: một port `CachePort`, hai driver chọn bằng `CACHE_DRIVER`.

| Driver | Khi nào | Trạng thái |
|---|---|---|
| `redis` | DEV/SIT/UAT/Pilot | Driver chính thức |
| `memory` | Local demo + test | Bị **từ chối khởi động** khi `NODE_ENV=production` |

`CachePort` cố ý rất hẹp: `get`/`set`/`delete`/`increment`/`ttl`/`acquireLock`/
`releaseLock`. Không có API nào cho phép lưu cấu trúc dữ liệu phức tạp, vì
TDD §3.1 nói rõ **Redis không phải source of truth** — mọi trạng thái nghiệp vụ
cuối cùng phải nằm trong PostgreSQL.

## Hướng fail có chủ đích

Đây là phần quan trọng nhất của quyết định này. Khi cache chết, hai loại rate
limit hành xử **ngược nhau**:

| Bucket | Cache chết | Lý do |
|---|---|---|
| `otp-request` | **Từ chối** (fail-closed) | Nếu cho qua, cache chết trở thành cách vượt giới hạn và spam nhà cung cấp SMS — đúng thứ TC-026 muốn chặn |
| `sos-create` | **Cho qua** (fail-open) | Chặn một ca cấp cứu thật vì Redis lỗi là thiệt hại lớn hơn nhiều so với vài ca trùng. TC-027 cũng yêu cầu "không chặn luồng hợp lệ" |

Sự bất đối xứng này là cố ý và được cưỡng chế bằng cờ `failClosed` trong
`RateLimitRules`, không phải bằng ghi nhớ của người viết code.

## Hệ quả

- ✅ Chạy và test được toàn bộ luồng rate limit mà không cần Redis.
- ⚠️ Driver `memory` **không chia sẻ giữa các instance**: rate limit và khoá chỉ
  đúng khi chạy một process. Đây là lý do nó bị cấm ở production.
- ⚠️ Mất dữ liệu khi restart: phiên refresh token biến mất, người dùng phải đăng
  nhập lại. Chấp nhận được với môi trường phát triển.
- ⚠️ `GET /v1/health` trả `degraded.cache = true` khi chạy driver `memory`, và
  dashboard hiển thị thành băng cảnh báo — người vận hành luôn biết mình đang ở
  chế độ nào.
