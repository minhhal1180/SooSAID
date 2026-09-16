# ADR-006 – Video qua `VideoProvider` port; driver `mock` mặc định trong Pilot

- **Status:** Accepted (Rule 8.1, TDD §11.1)
- **Date:** 2026-09-16

## Quyết định

Domain/service **không bao giờ** gọi SDK video trực tiếp. Mọi thao tác đi qua port:

```ts
interface VideoProvider {
  readonly name: VideoProviderName;
  createRoom(caseId: string): Promise<VideoRoom>;
  issueParticipantToken(input: IssueTokenInput): Promise<VideoParticipantToken>;
  startRecording(ctx: RecordingPolicyContext): Promise<RecordingHandle>;
  stopRecording(handle: RecordingHandle): Promise<void>;
  verifyWebhookSignature(raw: string, signature: string): boolean;
}
```

Driver đăng ký qua `VIDEO_PROVIDER` token, chọn bằng env `VIDEO_PROVIDER`:

| Driver | Trạng thái |
|---|---|
| `mock` | **Mặc định trong Pilot.** Sinh room/token ký bằng HMAC nội bộ, không gọi mạng ngoài. |
| `livekit` | Adapter thật, có sẵn khung; bật khi đã cấu hình `LIVEKIT_*` |

## Ràng buộc bắt buộc (threat model)

- Tên room **không chứa PII** — dùng `case-<uuid>`, không dùng số điện thoại/tên.
- Token TTL ngắn (`VIDEO_SESSION_TOKEN_TTL_SECONDS`, mặc định 300s), không reuse giữa
  các ca, phát riêng theo `(caseId, userId, role)`.
- `RECORDING_ENABLED=false` mặc định. Khi bật phải có bản ghi `consent_records` với
  `policy_version` tương ứng, và media asset gắn `retention_class` (TC-016, TC-017).
- Webhook provider phải verify signature + idempotency trước khi xử lý.
- Video provider chết **không** làm mất quyền truy cập dữ liệu ca/dispatch: service trả
  `PROVIDER_UNAVAILABLE` và client bật fallback (FR-007, TC-009), case giữ nguyên trạng thái.

## Hệ quả

- ✅ Đổi LiveKit → Twilio/Agora chỉ cần thêm một class, không sửa domain.
- ✅ Test được luồng video mà không cần hạ tầng WebRTC.
- ⚠️ Token của driver `mock` **không** dùng được với client WebRTC thật — chỉ để demo
  luồng nghiệp vụ và kiểm thử state machine.
