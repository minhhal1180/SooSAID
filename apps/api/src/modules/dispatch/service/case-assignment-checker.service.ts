import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { repositoryProvider } from '../../../persistence/persistence.module';
import type { CaseAssignmentCheckerPort } from '../../emergency-case/service/case-collaboration.ports';
import { CASE_ASSIGNMENT_CHECKER_PORT } from '../../emergency-case/service/case-collaboration.ports';
import {
  DISPATCH_REPOSITORY,
  MemoryDispatchRepository,
  PgDispatchRepository,
  type DispatchRepositoryPort,
} from '../repository/dispatch.repository';

/**
 * Cài đặt `CaseAssignmentCheckerPort`, tách riêng khỏi `DispatchService`.
 *
 * Lý do tách: `DispatchService` cần `EmergencyCaseService`, còn `EmergencyCaseService`
 * cần câu trả lời "user có được phân công cho ca không". Nếu để chung một class,
 * hai module sẽ phụ thuộc vòng tròn và Nest phải dùng `forwardRef` — thứ che
 * giấu vấn đề thiết kế thay vì giải quyết nó.
 *
 * Checker này chỉ đọc bảng `dispatch_assignments`, không cần biết gì về ca cấp
 * cứu, nên nó đứng một mình được và vòng phụ thuộc biến mất.
 */
@Injectable()
export class CaseAssignmentChecker implements CaseAssignmentCheckerPort {
  constructor(
    @Inject(DISPATCH_REPOSITORY) private readonly repository: DispatchRepositoryPort,
  ) {}

  async isUserAssignedToCase(caseId: string, userId: string): Promise<boolean> {
    return this.repository.isUserAssignedToCase(caseId, userId);
  }
}

/**
 * @Global để `emergency-case` inject được port mà không import `DispatchModule`.
 *
 * Provider repository ở đây là một instance riêng so với `DispatchModule`, nhưng
 * repository là lớp bọc không trạng thái (chỉ giữ tham chiếu tới executor/MemoryDb
 * dùng chung), nên không có rủi ro lệch dữ liệu.
 */
@Global()
@Module({
  providers: [
    repositoryProvider(DISPATCH_REPOSITORY, PgDispatchRepository, MemoryDispatchRepository),
    CaseAssignmentChecker,
    { provide: CASE_ASSIGNMENT_CHECKER_PORT, useExisting: CaseAssignmentChecker },
  ],
  exports: [CASE_ASSIGNMENT_CHECKER_PORT],
})
export class CaseAssignmentCheckerModule {}
