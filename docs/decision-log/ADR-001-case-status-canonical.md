# ADR-001 – Enum `case_status` 12 giá trị là canonical; 6 pha của Rule 7.1 là UI phase

- **Status:** Accepted
- **Date:** 2026-09-16
- **Deciders:** Product Owner (xác nhận trực tiếp), Tech Lead

## Bối cảnh

Hai nguồn requirement mâu thuẫn trực tiếp về vòng đời ca cấp cứu:

| Nguồn | Trạng thái |
|---|---|
| **Coding Rules §7.1** | `CREATED → ALERTED → CONNECTING → VIDEO_SUPPORT → HANDOVER → COMPLETED` (6), kèm câu "Không được tự tạo trạng thái khác" |
| **Developer Kit v1.0** — `db/schema.sql` (enum `case_status`), `api/openapi.yaml` (`CaseStatus`), `diagrams/case_state.mmd`, TDD §7.1 | `CREATED, QUEUED, ACCEPTED, VIDEO_CONNECTED, DISPATCHED, EN_ROUTE, ON_SCENE, HANDOVER_PENDING, HANDED_OVER, CLOSED, CANCELLED, FALSE_ALARM` (12) |

Không thể thỏa mãn cả hai: nếu lấy 6 trạng thái thì phải sửa enum DB + OpenAPI và
mất khả năng biểu diễn điều phối kíp xe (`DISPATCHED/EN_ROUTE/ON_SCENE`) và báo nhầm
(`CANCELLED/FALSE_ALARM`) — trong khi backlog `SOS-024/025` và test case `TC-011`,
`TC-012`, `TC-029` yêu cầu đúng các trạng thái đó.

## Quyết định

**Enum `case_status` 12 giá trị của Developer Kit là canonical.** Đây là giá trị duy
nhất được lưu vào cột `emergency_cases.status` và `case_status_history`.

6 pha trong Rule §7.1 được giữ lại như một **UI phase** — giá trị dẫn xuất, tính bằng
hàm thuần `casePhaseOf(status)`, **không lưu DB**, chỉ dùng để hiển thị tiến trình
cho người dân trên mobile.

```
CaseStatus (DB, canonical)            CasePhase (UI, derived)
──────────────────────────────────    ───────────────────────
CREATED                          →    CREATED
QUEUED                           →    ALERTED
ACCEPTED                         →    CONNECTING
VIDEO_CONNECTED                  →    VIDEO_SUPPORT
DISPATCHED / EN_ROUTE / ON_SCENE →    VIDEO_SUPPORT
HANDOVER_PENDING / HANDED_OVER   →    HANDOVER
CLOSED                           →    COMPLETED
CANCELLED / FALSE_ALARM          →    COMPLETED
```

Tinh thần "không được tự tạo trạng thái khác" được giữ nguyên và cưỡng chế ở hai lớp:
`CASE_STATE_TRANSITIONS` (ma trận transition server-side) và ràng buộc enum của
PostgreSQL. Client **không bao giờ** được set trạng thái tùy ý (FR-012).

## Hệ quả

- ✅ Không cần migration đổi enum; `db/schema.sql` của kit dùng nguyên vẹn.
- ✅ `openapi.yaml` giữ nguyên `CaseStatus`; bổ sung field dẫn xuất `phase` vào
  `EmergencyCase` response để mobile không phải tự map.
- ✅ Phủ được `TC-011`, `TC-012`, `TC-029`, `TC-030`.
- ⚠️ Mobile hiển thị 6 bước cho người dân nhưng dashboard operator hiển thị 12 trạng
  thái — tài liệu đào tạo phải nói rõ hai mức chi tiết này.
- ⚠️ `casePhaseOf` là ánh xạ một chiều, không suy ngược được; mọi logic nghiệp vụ phải
  dựa trên `CaseStatus`, tuyệt đối không branch theo `CasePhase`.

## Phương án đã cân nhắc và loại bỏ

**Rút gọn về 6 trạng thái.** Loại vì phải sửa enum DB, sửa OpenAPI, và mất khả năng
theo dõi kíp xe + báo nhầm — vi phạm Rule 1.1 ("không tự thay đổi flow nghiệp vụ")
đối với nguồn Developer Kit và làm hỏng 4 test case P0.
