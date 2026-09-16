# Cơ sở dữ liệu

PostgreSQL 16 + PostGIS 3.4 (Rule 3.1). Schema nằm ở [`db/migrations/`](../../db/migrations/),
chạy bằng `npm run db:migrate` (thêm `-- --seed` để nạp dữ liệu mô phỏng).

## Thứ tự migration

| File | Nội dung |
|---|---|
| `0001_baseline_schema.sql` | Schema gốc từ Developer Kit v1.0, giữ nguyên không sửa |
| `0002_rule41_audit_columns.sql` | Bổ sung `id`/`created_at`/`updated_at`/`created_by`/`updated_by` theo Rule 4.1, trigger `updated_at`, bảo vệ bảng append-only, bất biến hoá handover đã finalize |
| `0003_ambulance_unit_members.sql` | Bảng liên kết người dùng ↔ kíp xe (khoảng trống của schema gốc) |

Baseline được giữ nguyên vẹn để đối chiếu được với bản gốc của kit; mọi thay đổi
đều nằm ở migration riêng, có ghi lý do ngay trong file SQL.

## Quy ước theo Rule 4.1

Mọi bảng có `id`, `created_at`, `updated_at`, `created_by`, `updated_by`.

- `created_by` / `updated_by` trỏ tới `users(id)`.
  **`NULL` nghĩa là "do hệ thống thực hiện"** (outbox worker, migration, seed) —
  không phải "không biết". Dấu vết đầy đủ của con người nằm ở `audit_logs`.
- `updated_at` do **trigger DB** (`sos_set_updated_at`) quản lý, không tin vào
  client: một thiết bị lệch đồng hồ sẽ làm sai thứ tự sự kiện trong hồ sơ bàn giao.

## Bảng append-only

`case_locations`, `case_status_history`, `guidance_events`, `triage_submissions`,
`consent_records`, `audit_logs`.

Trigger `sos_reject_mutation` **chặn UPDATE/DELETE ngay ở tầng DB**. Lý do: hồ sơ
bàn giao chỉ đáng tin nếu timeline không sửa được — kiểm soát ở tầng application
là chưa đủ khi có truy cập DB trực tiếp.

Các bảng này vẫn có `updated_at` để tuân Rule 4.1, giá trị luôn bằng `created_at`.

## Bất biến của hồ sơ bàn giao

`trg_handovers_immutable_after_finalize` chặn mọi UPDATE/DELETE lên bản ghi
`handovers` có `status = 'FINALIZED'`. Sửa nội dung = tạo version mới
(`UNIQUE(case_id, version)`), khớp TC-018 và TC-019.

## Chống hai người cùng giữ một ca

Không dùng khoá ứng dụng. Điều kiện thắng nằm trong chính câu UPDATE:

```sql
UPDATE emergency_cases
   SET status = 'ACCEPTED', active_operator_id = $2, accepted_at = now()
 WHERE id = $1 AND status = 'QUEUED' AND active_operator_id IS NULL
```

Đúng một transaction khớp dòng; người còn lại nhận `null` → 409
`CASE_ALREADY_ACCEPTED` (TC-007). Cách này đúng cả khi chạy nhiều instance API.

## Sinh mã ca không trùng

`pg_advisory_xact_lock(hashtext('sos-case-code:YYYYMMDD'))` serialize việc cấp số
thứ tự trong ngày; khoá tự nhả khi transaction kết thúc. Kết hợp với
`UNIQUE(code)` làm chốt chặn cuối.

## Dữ liệu không gian

| Bảng | Cột | Index |
|---|---|---|
| `service_areas` | `geom geometry(MultiPolygon,4326)` | GIST |
| `medical_facilities` | `location geography(Point,4326)` | GIST |
| `local_resources` | `location geography(Point,4326)` | GIST |
| `ambulance_units` | `current_location geography(Point,4326)` | GIST |
| `responders` | `current_location geography(Point,4326)` | GIST |
| `emergency_cases` | `first_location`, `latest_location` | GIST trên `latest_location` |
| `case_locations` | `location geography(Point,4326)` | GIST |

Dùng `geography` chứ không `geometry` cho các điểm: `ST_DWithin`/`ST_Distance`
trên `geography` tính trên ellipsoid nên trả về **mét thật**, không phải độ.

Driver `memory` (ADR-004) không có PostGIS: nó tính Haversine và khớp service
area bằng hộp bao, đồng thời gắn nhãn `spatialAccuracy: 'approximate'` vào kết
quả để không ai nhầm hai nguồn dữ liệu.

## Không lưu media trong DB (Rule 4.2)

`media_assets` chỉ lưu `storage_key`, `mime_type`, `size_bytes`,
`checksum_sha256`, `encryption_key_ref`, `retention_class`. Nội dung nằm ở object
storage S3-compatible, truy cập bằng presigned URL ngắn hạn.

Trong Pilot, `RECORDING_ENABLED=false` nên bảng này rỗng. Bật ghi hình cần cả
chính sách retention được phê duyệt lẫn bản ghi `consent_records` tương ứng.

## Outbox

`outbox_events` cùng transaction với thay đổi nghiệp vụ (ADR-005). Index riêng
cho hàng chưa phát:

```sql
CREATE INDEX idx_outbox_unpublished ON outbox_events(created_at) WHERE published_at IS NULL;
```

`OutboxDispatcher` đọc bằng `FOR UPDATE SKIP LOCKED` nên nhiều instance cùng poll
mà không phát trùng.
