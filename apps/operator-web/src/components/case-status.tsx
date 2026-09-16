'use client';

import { CaseStatus, casePhaseOf } from '@/contracts/generated/api-contract';

/**
 * Hiển thị trạng thái ca.
 *
 * ADR-001: dashboard hiển thị **12 trạng thái kỹ thuật** (người trực cần mức chi
 * tiết này để điều phối), trong khi mobile của người dân chỉ hiển thị 6 pha.
 * Nhãn tiếng Việt nằm ở đây để không rải chuỗi khắp UI.
 */

export const CASE_STATUS_LABEL: Readonly<Record<CaseStatus, string>> = {
  CREATED: 'Vừa khởi tạo',
  QUEUED: 'Chờ tiếp nhận',
  ACCEPTED: 'Đã tiếp nhận',
  VIDEO_CONNECTED: 'Đang kết nối video',
  DISPATCHED: 'Đã điều phối',
  EN_ROUTE: 'Đang di chuyển',
  ON_SCENE: 'Đã tới hiện trường',
  HANDOVER_PENDING: 'Chuẩn bị bàn giao',
  HANDED_OVER: 'Đã bàn giao',
  CLOSED: 'Đã đóng',
  CANCELLED: 'Đã hủy',
  FALSE_ALARM: 'Báo nhầm',
};

export const CASE_PHASE_LABEL: Readonly<Record<string, string>> = {
  CREATED: 'Khởi tạo',
  ALERTED: 'Đã gửi cảnh báo',
  CONNECTING: 'Đang kết nối hỗ trợ',
  VIDEO_SUPPORT: 'Đang hỗ trợ',
  HANDOVER: 'Bàn giao',
  COMPLETED: 'Hoàn tất',
};

/** Chỉ ca CHƯA có người nhận mới dùng màu đỏ – xem ghi chú trong globals.css. */
function badgeClass(status: CaseStatus): string {
  if (status === CaseStatus.QUEUED || status === CaseStatus.CREATED) return 'badge-queued';
  if (status === CaseStatus.FALSE_ALARM || status === CaseStatus.CANCELLED) return 'badge-warn';
  if (status === CaseStatus.CLOSED || status === CaseStatus.HANDED_OVER) return 'badge-done';
  return 'badge-active';
}

export function CaseStatusBadge({ status }: { status: CaseStatus }) {
  return (
    <span className={`badge ${badgeClass(status)}`} title={`Pha: ${CASE_PHASE_LABEL[casePhaseOf(status)]}`}>
      {CASE_STATUS_LABEL[status]}
    </span>
  );
}

/** Thời gian tương đối – người trực quan tâm "bao lâu rồi" hơn là giờ tuyệt đối. */
export function elapsedLabel(isoTimestamp: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - new Date(isoTimestamp).getTime()) / 1000));

  if (seconds < 60) return `${seconds} giây trước`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}
