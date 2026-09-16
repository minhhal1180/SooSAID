# ADR-002 – Mapping 4 vai trò Rule 5.2 ↔ 8 role code của Developer Kit

- **Status:** Accepted
- **Date:** 2026-09-16

## Bối cảnh

Rule 5.2 định nghĩa RBAC gồm 4 vai trò: `USER`, `SUPPORTER`, `MEDICAL_STAFF`, `ADMIN`.
`db/schema.sql` định nghĩa enum `user_role` gồm 8 giá trị: `CITIZEN`, `OPERATOR_115`,
`CLINICIAN`, `AMBULANCE_CREW`, `FACILITY_USER`, `LOCAL_RESPONDER`, `ADMIN`, `AUDITOR`;
TDD §4.1 kèm ma trận quyền chi tiết theo 8 role đó.

4 vai trò của Rule là **lớp khái niệm**; 8 role code là **lớp cưỡng chế**. Gộp 8 về 4
sẽ mất khả năng phân biệt quyền mà TDD §4.1 yêu cầu — ví dụ `AMBULANCE_CREW` được
cập nhật `EN_ROUTE/ON_SCENE` nhưng `FACILITY_USER` chỉ read-only handover, cả hai đều
thuộc nhóm `MEDICAL_STAFF`.

## Quyết định

Giữ **8 role code** làm giá trị lưu trong `user_roles.role` và trong JWT claim `roles`.
4 vai trò của Rule 5.2 trở thành **role group** dẫn xuất (`RoleGroup`), dùng để đọc
tài liệu và để khai báo quyền ở mức thô.

| Rule 5.2 (`RoleGroup`) | Role code (`UserRole`) |
|---|---|
| `USER` | `CITIZEN` |
| `SUPPORTER` | `LOCAL_RESPONDER` |
| `MEDICAL_STAFF` | `OPERATOR_115`, `CLINICIAN`, `AMBULANCE_CREW`, `FACILITY_USER` |
| `ADMIN` | `ADMIN`, `AUDITOR` |

Guard `@Roles(...)` nhận role code. Deny-by-default: mọi endpoint không khai báo
`@Public()` đều yêu cầu JWT hợp lệ; mọi truy cập dữ liệu ca cấp cứu còn phải qua
`CaseAccessPolicy` (ABAC theo `service_area` + case assignment + quyền sở hữu).

## Hệ quả

- ✅ Ma trận quyền TDD §4.1 và `TC-013`, `TC-025` cưỡng chế được đúng mức chi tiết.
- ✅ Không cần migration enum `user_role`.
- ⚠️ Tài liệu phải luôn nói rõ đang dùng lớp nào; không được dùng chuỗi `"MEDICAL_STAFF"`
  trong code như một role code.
