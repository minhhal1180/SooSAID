import { Inject, Injectable } from '@nestjs/common';
import { CaseStatus, TriggerSource } from '../../../contracts/generated/api-contract';
import { DomainErrors } from '../../../common/errors/domain-error';
import {
  EMERGENCY_CASE_REPOSITORY,
  type EmergencyCaseRepositoryPort,
} from '../../emergency-case/repository/emergency-case.repository.port';

/**
 * Báo cáo pilot (FR-015, SOS-042).
 *
 * Mọi chỉ số được tính từ `case_status_history` — nguồn duy nhất và bất biến.
 * Không có bảng thống kê riêng để không bao giờ lệch với dữ liệu thật.
 *
 * TDD §8.2 (W07): ca DIỄN TẬP phải tách khỏi ca thật, nếu không KPI pilot sẽ vô
 * nghĩa. Vì vậy báo cáo luôn trả hai nhóm riêng.
 */

/** Khoảng thời gian tối đa cho một truy vấn báo cáo, chặn quét toàn bảng. */
const MAX_REPORT_RANGE_DAYS = 366;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ReportSummary {
  from: string;
  to: string;
  totalCases: number;
  byStatus: Record<string, number>;
  /** Trung vị thời gian giữa các mốc, đơn vị giây. Null khi chưa đủ dữ liệu. */
  medianSecondsBetween: {
    createdToAccepted: number | null;
    acceptedToVideoConnected: number | null;
    acceptedToDispatched: number | null;
    dispatchedToOnScene: number | null;
  };
  completionRate: number;
  falseAlarmRate: number;
}

@Injectable()
export class ReportingService {
  constructor(
    @Inject(EMERGENCY_CASE_REPOSITORY) private readonly caseRepository: EmergencyCaseRepositoryPort,
  ) {}

  async summary(from: Date, to: Date, options: { includeDrills: boolean }): Promise<ReportSummary> {
    this.assertValidRange(from, to);

    const cases = await this.caseRepository.listCreatedBetween(from, to);
    const scoped = options.includeDrills
      ? cases
      : cases.filter((row) => row.trigger_source !== TriggerSource.DRILL);

    const byStatus: Record<string, number> = {};
    for (const row of scoped) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    }

    const durations = {
      createdToAccepted: [] as number[],
      acceptedToVideoConnected: [] as number[],
      acceptedToDispatched: [] as number[],
      dispatchedToOnScene: [] as number[],
    };

    for (const row of scoped) {
      const history = await this.caseRepository.listStatusHistory(row.id);
      const at = (status: CaseStatus): number | null => {
        const entry = history.find((item) => item.to_status === status);
        return entry ? entry.changed_at.getTime() : null;
      };

      const createdAt = row.created_at.getTime();
      const acceptedAt = at(CaseStatus.ACCEPTED);
      const videoAt = at(CaseStatus.VIDEO_CONNECTED);
      const dispatchedAt = at(CaseStatus.DISPATCHED);
      const onSceneAt = at(CaseStatus.ON_SCENE);

      pushDelta(durations.createdToAccepted, createdAt, acceptedAt);
      pushDelta(durations.acceptedToVideoConnected, acceptedAt, videoAt);
      pushDelta(durations.acceptedToDispatched, acceptedAt, dispatchedAt);
      pushDelta(durations.dispatchedToOnScene, dispatchedAt, onSceneAt);
    }

    const total = scoped.length;
    const closed = byStatus[CaseStatus.CLOSED] ?? 0;
    const falseAlarm = byStatus[CaseStatus.FALSE_ALARM] ?? 0;

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totalCases: total,
      byStatus,
      // Dùng TRUNG VỊ chứ không phải trung bình: một ca kéo dài bất thường
      // không được che mất hiệu năng thực tế của phần lớn ca còn lại.
      medianSecondsBetween: {
        createdToAccepted: median(durations.createdToAccepted),
        acceptedToVideoConnected: median(durations.acceptedToVideoConnected),
        acceptedToDispatched: median(durations.acceptedToDispatched),
        dispatchedToOnScene: median(durations.dispatchedToOnScene),
      },
      completionRate: total === 0 ? 0 : round4(closed / total),
      falseAlarmRate: total === 0 ? 0 : round4(falseAlarm / total),
    };
  }

  private assertValidRange(from: Date, to: Date): void {
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw DomainErrors.validation('Khoảng thời gian không hợp lệ.');
    }
    if (from >= to) {
      throw DomainErrors.validation('`from` phải nhỏ hơn `to`.');
    }
    if (to.getTime() - from.getTime() > MAX_REPORT_RANGE_DAYS * MS_PER_DAY) {
      throw DomainErrors.validation(
        `Khoảng thời gian tối đa là ${MAX_REPORT_RANGE_DAYS} ngày.`,
      );
    }
  }
}

function pushDelta(target: number[], startMs: number | null, endMs: number | null): void {
  if (startMs === null || endMs === null || endMs < startMs) return;
  target.push(Math.round((endMs - startMs) / 1000));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
