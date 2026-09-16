import { DomainEventType, type CaseStatus } from '../../../contracts/generated/api-contract';
import type { DomainEventInput } from '../../outbox/entity/domain-event';

/**
 * Factory cho domain event của aggregate EmergencyCase (ADR-005 §Catalog).
 *
 * Tập trung ở đây để payload luôn tối thiểu và nhất quán. Quy tắc: event chỉ
 * chứa **định danh và trạng thái**, không chứa dữ liệu nhạy cảm — outbox được
 * nhiều handler đọc và dễ lọt vào log (Rule 11).
 *
 * Toạ độ là ngoại lệ có cân nhắc: `case.location_updated` phải mang lat/lng thì
 * dashboard mới cập nhật bản đồ realtime được. Bù lại, `RealtimeGateway` chỉ
 * phát tới các client đã được xác thực và có quyền trên đúng ca đó.
 */

const AGGREGATE_TYPE = 'EmergencyCase' as const;

export function caseCreatedEvent(input: {
  caseId: string;
  code: string;
  serviceAreaId: string | null;
  triggerSource: string;
  /**
   * Người tạo ca. `NotificationModule` cần id này để tra danh bạ liên hệ khẩn
   * cấp mà không phải đọc bảng của `emergency-case` (Rule 2.2). `userId` nằm
   * trong danh sách được phép log của Rule 11.
   */
  callerUserId: string | null;
}): DomainEventInput {
  return {
    aggregateType: AGGREGATE_TYPE,
    aggregateId: input.caseId,
    eventType: DomainEventType.CASE_CREATED,
    payload: {
      caseId: input.caseId,
      code: input.code,
      serviceAreaId: input.serviceAreaId,
      triggerSource: input.triggerSource,
      callerUserId: input.callerUserId,
    },
  };
}

export function caseAcceptedEvent(input: {
  caseId: string;
  operatorId: string;
}): DomainEventInput {
  return {
    aggregateType: AGGREGATE_TYPE,
    aggregateId: input.caseId,
    eventType: DomainEventType.CASE_ACCEPTED,
    payload: { caseId: input.caseId, operatorId: input.operatorId },
  };
}

export function caseStatusChangedEvent(input: {
  caseId: string;
  from: CaseStatus;
  to: CaseStatus;
  actorUserId: string | null;
}): DomainEventInput {
  return {
    aggregateType: AGGREGATE_TYPE,
    aggregateId: input.caseId,
    eventType: DomainEventType.CASE_STATUS_CHANGED,
    payload: {
      caseId: input.caseId,
      from: input.from,
      to: input.to,
      actorUserId: input.actorUserId,
    },
  };
}

export function caseLocationUpdatedEvent(input: {
  caseId: string;
  lat: number;
  lng: number;
  accuracyMeters: number | null;
  capturedAt: string;
}): DomainEventInput {
  return {
    aggregateType: AGGREGATE_TYPE,
    aggregateId: input.caseId,
    eventType: DomainEventType.CASE_LOCATION_UPDATED,
    payload: {
      caseId: input.caseId,
      lat: input.lat,
      lng: input.lng,
      accuracyMeters: input.accuracyMeters,
      capturedAt: input.capturedAt,
    },
  };
}
