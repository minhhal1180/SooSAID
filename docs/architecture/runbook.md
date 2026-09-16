# S.O.S Aid – Operations Runbook (Pilot)

## Severity
- **SEV-1:** Không tạo được ca S.O.S, sai/không gửi được vị trí diện rộng, operator queue unavailable, data breach.
- **SEV-2:** Video provider lỗi diện rộng nhưng fallback thoại/SOS vẫn hoạt động; push delivery degradation; map provider outage.
- **SEV-3:** Một chức năng phụ lỗi, báo cáo/admin lỗi, lỗi một nhóm thiết bị nhỏ.

## Golden signals
- `case_create_success_rate`
- `case_create_p95_ms`
- `operator_queue_event_lag_ms`
- `location_receive_success_rate`
- `video_join_success_rate` / `video_join_p95_ms`
- `notification_delivery_success_rate`
- `dispatch_assignment_ack_rate`
- `handover_generate_success_rate`
- API 5xx rate, DB saturation, Redis latency, object-storage errors.

## SEV-1 response
1. Incident commander xác nhận phạm vi, đóng băng deploy.
2. Bật degraded-mode banner trên mobile/dashboard nếu có.
3. Nếu API create case lỗi: hiển thị fallback gọi 115/thông tin khẩn cấp đã cấu hình; không giả vờ case đã tạo.
4. Nếu video lỗi: chuyển audio/phone fallback; case vẫn tiếp tục bằng data channel.
5. Nếu map lỗi: hiển thị tọa độ/address text và access note; không block case.
6. Tạo incident timeline, correlation ids, lưu log cần thiết.
7. Restore service/rollback; kiểm tra data integrity và outbox backlog.
8. Post-incident review trong 2 ngày làm việc, tạo action items.

## Backup/restore
- PostgreSQL: PITR + daily backup; drill restore theo lịch.
- Object storage: versioning/lifecycle theo policy; recording có retention riêng.
- Redis: không coi Redis là source of truth cho case state.

## Release gate
- Migration backward compatible hoặc có rollback plan.
- Smoke test create case -> operator accept -> status -> handover.
- Video provider health check.
- Push/SMS test account.
- Dashboard realtime event delivery.
- Audit log verification.
