# Vòng đời ca cấp cứu

Nguồn: TDD §7.1, `diagrams/case_state.mmd`, [ADR-001](../decision-log/ADR-001-case-status-canonical.md).
Cài đặt: [`case-state-machine.ts`](../../apps/api/src/modules/emergency-case/entity/case-state-machine.ts).

## Hai mức chi tiết

| | Giá trị | Lưu DB? | Ai nhìn thấy |
|---|---|---|---|
| **`CaseStatus`** | 12 trạng thái kỹ thuật | ✅ `emergency_cases.status` | Dashboard tổng đài |
| **`CasePhase`** | 6 pha nghiệp vụ | ❌ dẫn xuất | Mobile của người dân |

Mọi logic nghiệp vụ branch theo `CaseStatus`. `CasePhase` chỉ để hiển thị —
ánh xạ một chiều, không suy ngược được.

## Ma trận transition

| Từ | Đến | Ai được phép | Bắt buộc lý do | Điều kiện |
|---|---|---|---|---|
| `CREATED` | `QUEUED` | Hệ thống | – | Đã persist và xác định xong service area |
| `QUEUED` | `ACCEPTED` | `OPERATOR_115`, `CLINICIAN` | – | Atomic; chỉ một người thắng |
| `ACCEPTED` | `VIDEO_CONNECTED` | Hệ thống | – | Có người tham gia phòng video |
| `ACCEPTED` | `DISPATCHED` | `OPERATOR_115`, `CLINICIAN` | – | Có assignment hợp lệ |
| `VIDEO_CONNECTED` | `DISPATCHED` | `OPERATOR_115`, `CLINICIAN` | – | Có assignment hợp lệ |
| `DISPATCHED` | `EN_ROUTE` | `AMBULANCE_CREW`, `LOCAL_RESPONDER` | – | Assignment đã accepted và bắt đầu di chuyển |
| `EN_ROUTE` | `ON_SCENE` | `AMBULANCE_CREW`, `LOCAL_RESPONDER` | – | Đã tới hiện trường |
| `ON_SCENE` | `HANDOVER_PENDING` | `OPERATOR_115`, `CLINICIAN`, `AMBULANCE_CREW` | – | Bắt đầu chuẩn bị bàn giao |
| `HANDOVER_PENDING` | `HANDED_OVER` | `CLINICIAN`, `AMBULANCE_CREW` | – | Hồ sơ đã finalize/ack |
| `HANDED_OVER` | `CLOSED` | `OPERATOR_115`, `CLINICIAN` | – | Hoàn tất về mặt vận hành |
| `CREATED` | `CANCELLED` | `CITIZEN` | ✅ | Chỉ trước khi có người nhận |
| `QUEUED` | `FALSE_ALARM` | `OPERATOR_115` | ✅ | Tổng đài xác nhận báo nhầm |
| `ACCEPTED` | `FALSE_ALARM` | `OPERATOR_115` | ✅ | Tổng đài xác nhận báo nhầm |

Không có cạnh nào ngoài bảng này. `CLOSED`, `CANCELLED`, `FALSE_ALARM` là trạng
thái kết thúc, không có đường đi tiếp.

## Ánh xạ sang pha hiển thị

```
CREATED                           → CREATED         "Đang khởi tạo yêu cầu"
QUEUED                            → ALERTED         "Đã gửi cảnh báo"
ACCEPTED                          → CONNECTING      "Đang kết nối người hỗ trợ"
VIDEO_CONNECTED
DISPATCHED / EN_ROUTE / ON_SCENE  → VIDEO_SUPPORT   "Đang được hỗ trợ"
HANDOVER_PENDING / HANDED_OVER    → HANDOVER        "Đang bàn giao"
CLOSED / CANCELLED / FALSE_ALARM  → COMPLETED       "Đã hoàn tất"
```

## Cưỡng chế ở đâu

1. **`assertTransitionAllowed`** – kiểm tra cạnh tồn tại → vai trò → lý do.
2. **`updateStatusIfCurrent`** – `WHERE status = expected`, là optimistic lock:
   ai đó đổi trạng thái giữa lúc đọc và ghi thì câu UPDATE không khớp dòng nào
   và thao tác bị từ chối thay vì ghi đè.
3. **Enum PostgreSQL `case_status`** – chốt chặn cuối ở tầng DB.
4. **Trigger append-only trên `case_status_history`** – timeline không sửa được.

## Câu hỏi còn bỏ ngỏ

**`QUEUED → CANCELLED` có nên được phép không?**

Tài liệu chỉ cho phép `CREATED → CANCELLED` với chú thích "cancel hợp lệ trước
accept". Nhưng hệ thống chuyển `CREATED → QUEUED` gần như tức thì sau khi
persist, nên trên thực tế người dân **hầu như không kịp** hủy: khi họ nhận ra
mình bấm nhầm thì ca đã ở `QUEUED`.

Hiện tại cài đặt **đúng theo tài liệu** (chỉ `CREATED → CANCELLED`) vì Rule 1.1
cấm tự suy diễn nghiệp vụ. Hệ quả thực tế: người dân bấm nhầm phải chờ tổng đài
đánh dấu `FALSE_ALARM`.

Cần chủ đầu tư/chuyên gia nghiệp vụ quyết định trước Pilot. Nếu đồng ý mở, thêm
một dòng vào `CASE_TRANSITIONS` với `requiresReason: true` và bổ sung test.
