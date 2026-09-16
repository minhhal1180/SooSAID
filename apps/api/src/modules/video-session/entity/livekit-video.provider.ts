import { createHmac, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type {
  IssueTokenInput,
  RecordingHandle,
  RecordingPolicyContext,
  VideoParticipantToken,
  VideoProviderPort,
  VideoRoom,
} from './video-provider.port';
import { videoRoomIdFor } from './video-provider.port';

/**
 * Driver LiveKit (ADR-006).
 *
 * Token của LiveKit là JWT ký HS256 bằng API secret, với claim `video` mô tả
 * quyền trong phòng — nên phát hành được mà không cần gọi mạng, đúng tinh thần
 * "video chết không làm mất quyền truy cập dữ liệu ca" (FR-007).
 *
 * CHƯA HOÀN THIỆN CHO PRODUCTION: `startRecording`/`stopRecording` cần gọi
 * LiveKit Egress API và `healthCheck` cần gọi endpoint thật. Hai phần đó phụ
 * thuộc quyết định hạ tầng và chính sách lưu trữ chưa được chốt (xem Open
 * Decisions), nên ở đây chúng từ chối thay vì giả vờ thành công.
 */
export class LiveKitVideoProvider implements VideoProviderPort {
  readonly name = 'livekit';

  constructor(
    private readonly serverUrl: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  async createRoom(caseId: string): Promise<VideoRoom> {
    // LiveKit tạo phòng ngầm khi người đầu tiên tham gia bằng token hợp lệ, nên
    // không cần gọi API riêng để tạo.
    return { roomId: videoRoomIdFor(caseId), provider: this.name };
  }

  async issueParticipantToken(input: IssueTokenInput): Promise<VideoParticipantToken> {
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);

    const token = jwt.sign(
      {
        video: {
          room: input.roomId,
          roomJoin: true,
          canPublish: true,
          canSubscribe: true,
          // Không cho client tự tạo phòng: phòng chỉ tồn tại theo ca do server mở.
          roomCreate: false,
        },
        // `metadata` chỉ chứa vai trò, không chứa PII.
        metadata: JSON.stringify({ role: input.role }),
      },
      this.apiSecret,
      {
        issuer: this.apiKey,
        subject: input.userId,
        jwtid: `${input.roomId}:${input.userId}`,
        expiresIn: input.ttlSeconds,
      },
    );

    return { token, expiresAt, serverUrl: this.serverUrl };
  }

  async startRecording(_context: RecordingPolicyContext): Promise<RecordingHandle> {
    throw new Error(
      'Ghi hình qua LiveKit Egress chưa được bật: cần chốt chính sách lưu trữ/retention ' +
        'và cấu hình object storage trước (xem docs/decision-log/README.md).',
    );
  }

  async stopRecording(_handle: RecordingHandle): Promise<void> {
    throw new Error('Ghi hình qua LiveKit Egress chưa được bật.');
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const expected = createHmac('sha256', this.apiSecret).update(rawBody).digest('base64');
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signature);
    if (expectedBuffer.length !== actualBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, actualBuffer);
  }

  async healthCheck(): Promise<boolean> {
    // Cấu hình thiếu = coi như không khả dụng, để service kích hoạt fallback
    // thay vì phát token không dùng được (TC-009).
    return Boolean(this.serverUrl && this.apiKey && this.apiSecret);
  }
}
