# ADR-003 – Áp envelope `{success,data}` của Rule 6.2 lên toàn bộ API

- **Status:** Accepted
- **Date:** 2026-09-16

## Bối cảnh

`api/openapi.yaml` của Developer Kit trả payload trần (ví dụ `POST /v1/emergency-cases`
→ `201` với body là `EmergencyCase`). TDD §10.1 quy định lỗi dùng cấu trúc
`{code, message, details, requestId}` và mọi response có `requestId`.

Rule 6.2 bắt buộc envelope:
```jsonc
{ "success": true,  "data": {} }
{ "success": false, "error": { "code": "", "message": "" } }
```

## Quyết định

Áp envelope của Rule 6.2 cho **mọi** endpoint `/v1/*`, hợp nhất với yêu cầu `requestId`
của TDD:

```jsonc
// Success
{ "success": true, "data": { /* schema cũ, không đổi */ }, "requestId": "01J..." }

// Error
{ "success": false,
  "error": { "code": "CASE_INVALID_TRANSITION", "message": "...", "details": [] },
  "requestId": "01J..." }
```

Cưỡng chế bằng hai lớp global, không phải bằng tay ở controller:
- `ResponseEnvelopeInterceptor` bọc giá trị trả về của controller.
- `DomainExceptionFilter` map `DomainError` → HTTP status + envelope lỗi.

Controller trả **payload trần**; cấm tự bọc `{success:true,...}` (sẽ bị lồng hai lần).

`docs/api/openapi.yaml` được cập nhật tương ứng: mọi response `$ref` tới
`ApiSuccess<T>` / `ApiError`. Đây là bản contract có hiệu lực của repo; bản gốc trong
Developer Kit được giữ nguyên làm tài liệu tham chiếu.

## Hệ quả

- ✅ Client chỉ cần một code path xử lý lỗi; `requestId` luôn có để đối soát log.
- ✅ Không lộ stack trace (threat model – "State-changing endpoint checklist").
- ⚠️ Contract khác bản gốc của kit → Postman collection của kit phải cập nhật assertion.
- ⚠️ Type generate cho client phải unwrap `.data`; `packages/api-contract` cung cấp
  helper `unwrap()`.

## Bảng mã lỗi

| Code | HTTP | Nghĩa |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Input sai schema |
| `UNAUTHENTICATED` | 401 | Thiếu/không hợp lệ token |
| `FORBIDDEN` | 403 | Không đủ quyền theo RBAC/ABAC |
| `NOT_FOUND` | 404 | Resource không tồn tại trong scope người gọi |
| `CASE_INVALID_TRANSITION` | 409 | Transition không có trong ma trận state machine |
| `CASE_ALREADY_ACCEPTED` | 409 | Operator khác đã nhận ca (TC-007) |
| `IDEMPOTENCY_CONFLICT` | 409 | Cùng key, khác request body (TC-002) |
| `RATE_LIMITED` | 429 | Vượt ngưỡng OTP/SOS (TC-026, TC-027) |
| `PROVIDER_UNAVAILABLE` | 503 | Video/map/push provider lỗi — có fallback |
