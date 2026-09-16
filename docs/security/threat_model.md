# S.O.S Aid – Threat Model & Security Checklist

## Tài sản nhạy cảm
- Vị trí thời gian thực và lịch sử vị trí trong ca.
- Video/ảnh/âm thanh hiện trường.
- Hồ sơ sức khỏe khẩn cấp tự nguyện khai báo.
- Số điện thoại/người liên hệ.
- Nhật ký chuyên môn và biên bản bàn giao.
- Danh tính/ca làm của operator, clinician, crew, responder.

## Threats ưu tiên

| Threat | Ví dụ | Kiểm soát bắt buộc |
|---|---|---|
| Account takeover | Lộ OTP/token | OTP rate limit, device binding phù hợp, refresh rotation, MFA cho operator/admin |
| Unauthorized medical data access | Người không liên quan xem case | RBAC + scope theo organization/service area + case assignment, deny-by-default |
| Location leakage | API trả vị trí cho người thân/người hỗ trợ vượt quyền | Field-level authorization, purpose-based views, masking khi không cần chính xác |
| Video interception | Room/token bị lộ | TLS, short-lived room token, room per case, no public room ids, provider ACL |
| Recording misuse | Video bị lưu vô thời hạn | Recording feature flag, consent/policy check, lifecycle retention, encrypted object storage |
| Duplicate/false SOS | Double tap/spam/bot | Idempotency key, anti-abuse rate limit, device/user risk signals, false-alarm flow |
| Data tampering | Sửa status/handover trái phép | Server-side state machine, optimistic locking, audit log, role transition matrix |
| Lost phone | Token vẫn hoạt động | Short access token, remote logout, biometric re-auth for sensitive profile views |
| Insider abuse | Admin export dữ liệu | Least privilege, audited exports, approval for bulk export, alert unusual access |
| Provider outage | Map/video/push unavailable | Adapter + fallback, health monitoring, degraded-mode UX |

## Security baseline
- TLS cho mọi kết nối; mTLS/VPN cho integration nội bộ nếu đối tác yêu cầu.
- Encryption at rest cho DB/object storage; secrets trong secret manager, không commit `.env`.
- Access token ngắn hạn; refresh token rotation/revocation.
- RBAC + ABAC theo service area/case assignment.
- Audit mọi thao tác xem/tải/chia sẻ/sửa dữ liệu nhạy cảm.
- Không log raw access token, OTP, full health profile, video URL có chữ ký.
- Presigned object URL thời hạn ngắn; content-disposition và MIME allow-list.
- API rate limit theo IP/user/device và mạnh hơn cho OTP/SOS creation.
- SAST, dependency scanning, secret scanning, container scanning trong CI.
- Pentest trước pilot có dữ liệu thật.
- Data retention là cấu hình theo data class, không hardcode số năm khi chưa có quyết định pháp lý.

## State-changing endpoint checklist
- Authenticated/authorized?
- Idempotency/concurrency safe?
- Input schema validated?
- Audit event emitted?
- PII/health data minimized?
- Error response không lộ stack trace?
- Metrics/trace correlation id?
