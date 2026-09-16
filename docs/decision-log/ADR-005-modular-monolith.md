# ADR-005 – Modular Monolith + Outbox thay vì microservice cho MVP

- **Status:** Accepted (kế thừa TDD §3.2 ADR-001, Rule 2.1)
- **Date:** 2026-09-16

## Quyết định

Backend là **một tiến trình NestJS duy nhất**, chia module theo domain boundary.
Giao tiếp giữa module chỉ qua hai kênh:

1. **Port/interface** được inject (đồng bộ, đọc dữ liệu).
2. **Domain event qua Outbox** (bất đồng bộ, khi có side effect).

Cấm: module A import repository/bảng DB của module B (Rule 2.2).

## Outbox Pattern

Mọi command làm đổi trạng thái ghi **cùng một transaction**: bản ghi nghiệp vụ +
dòng `outbox_events`. `OutboxDispatcher` (poll `published_at IS NULL`) phát event cho
các handler đã đăng ký: `NotificationModule`, `RealtimeModule`, `AuditLogModule`.

Điều này cưỡng chế `TC-023`: push provider chết → case vẫn commit, notification được
retry, không sinh duplicate domain state.

## Catalog domain event (TDD §8.3)

| Event | Aggregate | Payload tối thiểu |
|---|---|---|
| `case.created` | EmergencyCase | `caseId, code, serviceAreaId, triggerSource` |
| `case.accepted` | EmergencyCase | `caseId, operatorId` |
| `case.status_changed` | EmergencyCase | `caseId, from, to, actorId` |
| `case.location_updated` | EmergencyCase | `caseId, lat, lng, accuracyMeters, capturedAt` |
| `triage.submitted` | Triage | `caseId, questionnaireVersion, submissionId` |
| `video.session_started` | Video | `caseId, sessionId, provider, recordingEnabled` |
| `guidance.delivered` | Guidance | `caseId, guidanceId, code, version, actorId` |
| `dispatch.created` | Dispatch | `caseId, assignmentId, assignmentType, targetId` |
| `dispatch.status_changed` | Dispatch | `caseId, assignmentId, status` |
| `handover.finalized` | Handover | `caseId, handoverId, version` |
| `notification.requested` | Notification | `caseId, templateCode, channel, recipientRef` |

## Hệ quả

- ✅ Một deployment, một transaction boundary — phù hợp team pilot 18 tuần.
- ✅ Boundary đã rõ nên tách service về sau chỉ là đổi transport của outbox.
- ⚠️ Kỷ luật import phải được cưỡng chế bằng ESLint rule (`no-restricted-imports`
  chặn `modules/*/repository` chéo module), không dựa vào thiện chí.
