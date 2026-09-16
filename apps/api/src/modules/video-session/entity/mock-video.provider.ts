import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
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
 * Driver video mặc định trong Pilot (ADR-006).
 *
 * Không gọi ra ngoài mạng: sinh phòng và token ký bằng HMAC nội bộ. Đủ để chạy
 * và kiểm thử toàn bộ luồng nghiệp vụ (cấp token theo vai trò, hết hạn token,
 * cổng chính sách ghi hình) mà không cần hạ tầng WebRTC.
 *
 * GIỚI HẠN: token này KHÔNG dùng được với client WebRTC thật. Bật
 * `VIDEO_PROVIDER=livekit` khi cần media thật.
 */
export class MockVideoProvider implements VideoProviderPort {
  readonly name = 'mock';

  constructor(private readonly signingSecret: string) {}

  async createRoom(caseId: string): Promise<VideoRoom> {
    return { roomId: videoRoomIdFor(caseId), provider: this.name };
  }

  async issueParticipantToken(input: IssueTokenInput): Promise<VideoParticipantToken> {
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);

    // Token ràng buộc đồng thời phòng + người + vai trò + hạn dùng: đổi bất kỳ
    // thành phần nào cũng làm chữ ký sai, nên không thể tái sử dụng chéo ca.
    const claims = {
      room: input.roomId,
      sub: input.userId,
      role: input.role,
      exp: Math.floor(expiresAt.getTime() / 1000),
      nonce: randomUUID(),
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = this.sign(payload);

    return {
      token: `${payload}.${signature}`,
      expiresAt,
      serverUrl: 'mock://local-video',
    };
  }

  async startRecording(context: RecordingPolicyContext): Promise<RecordingHandle> {
    // Cổng chính sách nằm ở service (`VideoSessionService`), nhưng kiểm tra lại
    // ở đây là chốt chặn thứ hai: một driver không bao giờ được ghi hình khi
    // chưa có đồng ý (TC-017).
    if (!context.mediaConsentGranted) {
      throw new Error('Không được ghi hình khi chưa có đồng ý của người dùng.');
    }
    return { recordingId: randomUUID(), provider: this.name, startedAt: new Date() };
  }

  async stopRecording(_handle: RecordingHandle): Promise<void> {
    // Driver mock không tạo file nên không có gì để dừng.
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const expected = this.sign(rawBody);
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signature);
    if (expectedBuffer.length !== actualBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, actualBuffer);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  private sign(value: string): string {
    return createHmac('sha256', this.signingSecret).update(value).digest('base64url');
  }
}
