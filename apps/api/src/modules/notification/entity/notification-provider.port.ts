/**
 * Adapter kênh thông báo (TDD §11.3).
 *
 * Push là kênh chính cho người dùng app; SMS là fallback khi đơn vị triển khai
 * có nhà cung cấp và cơ chế đồng ý phù hợp.
 *
 * RÀNG BUỘC NỘI DUNG (Rule 11 + TDD §11.3): thông báo KHÔNG chứa thông tin sức
 * khỏe chi tiết — nó hiện trên màn hình khoá của thiết bị người khác cũng nhìn
 * thấy. Chỉ gửi mã ca và lời nhắc mở ứng dụng.
 */

export const NotificationChannel = {
  PUSH: 'push',
  SMS: 'sms',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

/** Mã mẫu thông báo – nội dung thật nằm ở adapter/nhà cung cấp, không hard-code. */
export const NotificationTemplate = {
  EMERGENCY_CONTACT_CASE_CREATED: 'emergency_contact.case_created',
  EMERGENCY_CONTACT_CASE_DISPATCHED: 'emergency_contact.case_dispatched',
  RESPONDER_ASSIGNMENT_CREATED: 'responder.assignment_created',
} as const;
export type NotificationTemplate =
  (typeof NotificationTemplate)[keyof typeof NotificationTemplate];

export interface SendNotificationInput {
  readonly channel: NotificationChannel;
  /** Địa chỉ nhận: push token hoặc số điện thoại. Không bao giờ ghi vào log. */
  readonly recipient: string;
  readonly templateCode: NotificationTemplate;
  /** Biến thay thế trong mẫu. Chỉ chứa mã ca và dữ liệu không nhạy cảm. */
  readonly variables: Record<string, string>;
}

export interface SendNotificationResult {
  readonly delivered: boolean;
  readonly providerMessageId: string | null;
  /** Mã lỗi rút gọn để log; không phải message gốc của provider. */
  readonly errorCode: string | null;
}

export interface NotificationProviderPort {
  readonly name: string;
  supports(channel: NotificationChannel): boolean;
  send(input: SendNotificationInput): Promise<SendNotificationResult>;
}

export const NOTIFICATION_PROVIDER = Symbol('NOTIFICATION_PROVIDER');
