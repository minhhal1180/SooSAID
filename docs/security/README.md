# Bảo mật – trạng thái triển khai

Tài liệu này đối chiếu [`threat_model.md`](threat_model.md) (từ Developer Kit) với
những gì **thực sự đã có trong code**, và nói rõ phần nào chưa có.

> Nguyên tắc của tài liệu này: không ghi "đã xong" cho thứ chưa chạy được.

## Đã triển khai

### Deny-by-default
`JwtAuthGuard` đăng ký toàn cục trong `app.module.ts`. Endpoint không gắn
`@Public()` đều yêu cầu token — **quên gắn decorator nghĩa là endpoint bị khoá,
không phải bị mở**.

### RBAC + ABAC hai tầng
- `RolesGuard` (@Roles) – tầng thô, theo role code (ADR-002).
- `CaseAccessPolicy` – tầng quyết định cuối, ở service, vì quyền trên một ca phụ
  thuộc dữ liệu: quyền sở hữu, service area, assignment.

Field-level authorization: người không được xem toạ độ chính xác vẫn nhận được
ca nhưng `latestLocation = null`. Người ngoài scope nhận **404 chứ không phải
403**, để không xác nhận ca có tồn tại (TC-025).

### Hồ sơ sức khỏe chỉ chia sẻ khi có đồng ý
`UsersService.snapshotForCase` trả `null` nếu `consent_share_in_emergency` là
false. Chốt chặn đặt ở **nguồn dữ liệu**, không ở nơi hiển thị (TC-015).

### Idempotency
`Idempotency-Key` bắt buộc cho `POST /emergency-cases`; đặt chỗ bằng UNIQUE
constraint trong cùng transaction nên đúng cả khi chạy nhiều instance (TC-002,
TC-003).

### Rate limit với hướng fail có chủ đích
| Endpoint | Ngưỡng | Cache chết thì |
|---|---|---|
| OTP request | `RATE_LIMIT_OTP_PER_HOUR` | **Từ chối** (fail-closed) – không để cache chết thành cách spam nhà cung cấp SMS |
| Tạo ca S.O.S | `RATE_LIMIT_SOS_PER_HOUR` | **Cho qua** (fail-open) – chặn một ca cấp cứu thật vì Redis lỗi là đánh đổi sai |

### OTP
Lưu **băm** SHA-256 của `phone:otp`, khoá cache là băm số điện thoại, so sánh
bằng `timingSafeEqual`, giới hạn 5 lần thử, dùng một lần. Tài khoản nghiệp vụ bị
**từ chối** ở luồng OTP tiêu dùng (SOS-004).

### Token
Access token 15 phút, refresh token có `jti` và **rotation** (token cũ bị thu hồi
ngay khi cấp token mới). Hai secret khác nhau cho hai loại token. Config từ chối
khởi động nếu secret ngắn dưới 32 ký tự hoặc hai secret trùng nhau.

### Logging (Rule 11)
`SafeLogger` **lọc chủ động** thay vì tin vào kỷ luật người viết code: mọi khoá
ngoài allow-list bị loại bỏ, số điện thoại/JWT/presigned URL bị che ngay cả khi
lọt vào một khoá hợp lệ. `caseId`, `caseCode`, `userId` được giữ nguyên vì truy
vết sự cố cần chúng.

### Không lộ chi tiết lỗi
`DomainExceptionFilter` không bao giờ trả stack trace hay message gốc của
exception không xác định. Chi tiết kỹ thuật đi vào `internalContext` (chỉ log).

### Video (ADR-006)
Tên phòng `case-<uuid>` không chứa PII; token TTL 300s, phát riêng theo
`(caseId, userId, role)`, không reuse giữa các ca. Ghi hình cần **đồng thời**
`RECORDING_ENABLED=true` và `mediaConsent` của ca.

### Chặn cấu hình nguy hiểm ở production
`AppConfig` **từ chối khởi động** khi `NODE_ENV=production` mà:
`PERSISTENCE_DRIVER=memory`, `CACHE_DRIVER=memory`, `AUTH_OTP_DEV_ECHO=true`,
`AUTH_DEV_OPERATOR_LOGIN=true`, hoặc `EMS_INTEGRATION_MODE=live`.

### Audit trail
`audit_logs` append-only (trigger DB). Ghi cả thao tác **bị từ chối**
(`result = 'DENIED'`, TC-025). Việc tra cứu audit cũng được audit.

### Mobile – lưu trữ và quyền

**Token trong secure storage.** `SecureStore` dùng Keychain (iOS,
`first_unlock`) và EncryptedSharedPreferences (Android). Tách hẳn khỏi
`OfflineCache` (`shared_preferences`, không mã hoá) — chỉ nội dung hướng dẫn đã
duyệt và `deviceId` nằm ở đó. Hồ sơ sức khỏe, lịch sử vị trí và media **không
bao giờ** được cache trên máy.

**Chỉ xin 3 quyền:** camera, micro, vị trí-khi-dùng. Không xin danh bạ (người
liên hệ do người dùng tự nhập), không xin vị trí nền, không xin ảnh. Podfile tắt
tường minh mọi quyền khác của `permission_handler`, để một dependency mới không
vô tình kéo chúng vào và làm Apple từ chối bản nộp (xem
[ADR-008](../decision-log/ADR-008-mobile-platform-templates.md)).

**Không tự quay số.** App dùng `tel:` để **mở** trình quay số cho người dùng tự
bấm; Android không khai `CALL_PHONE`. Ứng dụng không bao giờ được tự gọi thay
người dùng.

**Số điện thoại chỉ ở dạng che.** Server trả `phoneMasked` (3 số cuối) kể cả cho
chính chủ; model `EmergencyContact` cố ý **không có** trường số đầy đủ.

## Chưa triển khai – chặn Pilot có dữ liệu thật

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| **OIDC/MFA cho operator/admin** (SOS-004) | ❌ | Đang dùng `POST /auth/dev/login`, chặn cứng ở production. **Đây là khoảng trống lớn nhất.** |
| **Xoá tài khoản trong app** | ❌ | App Store điều 5.1.1(v) **bắt buộc** với app có đăng nhập. Chưa có endpoint backend |
| **Chính sách bảo mật công khai** | ❌ | Bắt buộc để nộp App Store; cần một URL công khai |
| **TLS / secure headers ở ingress** | ❌ | Chưa có cấu hình ingress; dashboard đã đặt `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` |
| **Secret manager** | ❌ | Đang đọc từ `.env`; `.env` đã nằm trong `.gitignore` |
| **Encryption at rest** | ❌ | Phụ thuộc hạ tầng triển khai |
| **Presigned URL cho media** | ❌ | Chưa bật vì `RECORDING_ENABLED=false` |
| **Remote logout / thu hồi toàn bộ phiên** | ⚠️ Một phần | `revokeSession` đã có; chưa có API cho người dùng tự gọi |
| **Bulk export audit có phê duyệt** | ❌ | Cố ý chưa mở — threat model yêu cầu quy trình phê duyệt, là Open Decision |
| **SAST / dependency scan / secret scan trong CI** | ❌ | Chưa có pipeline CI |
| **Pentest trước pilot** | ❌ | Bắt buộc trước khi có dữ liệu thật |

## Checklist cho endpoint đổi trạng thái

Mỗi endpoint mới phải trả lời được (threat model):

- [ ] Đã xác thực và phân quyền chưa? (guard toàn cục + `CaseAccessPolicy`)
- [ ] Idempotent / an toàn với truy cập đồng thời chưa? (optimistic lock)
- [ ] Input đã validate theo schema chưa? (`ValidationPipe` + `whitelist`)
- [ ] Có phát audit event không? (`AuditLogService`)
- [ ] Dữ liệu PII/y tế đã tối thiểu hoá chưa? (payload outbox, response)
- [ ] Response lỗi có lộ stack trace không? (`DomainExceptionFilter`)
- [ ] Có `requestId` để đối chiếu log không? (envelope ADR-003)
