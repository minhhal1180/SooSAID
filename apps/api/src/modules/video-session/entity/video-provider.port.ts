import type { VideoParticipantRole } from '../../../contracts/generated/api-contract';

/**
 * Port nhà cung cấp video (Rule 8.1, ADR-006).
 *
 * Domain/service KHÔNG BAO GIỜ gọi SDK trực tiếp:
 *   Sai:  Agora.startCall()
 *   Đúng: videoProvider.startSession()
 *
 * Nhờ đó đổi LiveKit -> Twilio -> Agora chỉ là thêm một class, không đụng vào
 * nghiệp vụ ca cấp cứu.
 */

export interface VideoRoom {
  /** Tên phòng KHÔNG chứa PII — luôn là `case-<uuid>` (threat model). */
  readonly roomId: string;
  readonly provider: string;
}

export interface IssueTokenInput {
  readonly roomId: string;
  readonly userId: string;
  readonly role: VideoParticipantRole;
  readonly ttlSeconds: number;
}

export interface VideoParticipantToken {
  readonly token: string;
  readonly expiresAt: Date;
  /** URL máy chủ media cho client kết nối. */
  readonly serverUrl: string;
}

/** Bối cảnh chính sách bắt buộc phải có trước khi được ghi hình (TC-017). */
export interface RecordingPolicyContext {
  readonly caseId: string;
  readonly roomId: string;
  /** Người dùng đã đồng ý ghi hình cho ca này. */
  readonly mediaConsentGranted: boolean;
  /** Phiên bản chính sách đã hiển thị khi lấy đồng ý. */
  readonly policyVersion: string;
  readonly retentionClass: string;
}

export interface RecordingHandle {
  readonly recordingId: string;
  readonly provider: string;
  readonly startedAt: Date;
}

export interface VideoProviderPort {
  readonly name: string;

  /** Tạo/lấy phòng cho ca. Idempotent theo `caseId`. */
  createRoom(caseId: string): Promise<VideoRoom>;

  /** Cấp token ngắn hạn cho một người tham gia cụ thể. Không reuse giữa các ca. */
  issueParticipantToken(input: IssueTokenInput): Promise<VideoParticipantToken>;

  startRecording(context: RecordingPolicyContext): Promise<RecordingHandle>;
  stopRecording(handle: RecordingHandle): Promise<void>;

  /** Xác minh chữ ký webhook trước khi tin bất cứ dữ liệu nào từ provider. */
  verifyWebhookSignature(rawBody: string, signature: string): boolean;

  /** Kiểm tra provider còn sống – dùng cho health check và quyết định fallback. */
  healthCheck(): Promise<boolean>;
}

export const VIDEO_PROVIDER = Symbol('VIDEO_PROVIDER');

/** Tiền tố tên phòng. Cố định để mọi provider sinh tên giống nhau. */
export const VIDEO_ROOM_PREFIX = 'case-';

export function videoRoomIdFor(caseId: string): string {
  return `${VIDEO_ROOM_PREFIX}${caseId}`;
}
