import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CaseStatus, NoteType } from '../../../contracts/generated/api-contract';

/**
 * Body của `POST /v1/emergency-cases/{caseId}/status`.
 *
 * Client chỉ nói MUỐN chuyển sang trạng thái nào; server quyết định có được
 * phép hay không dựa trên `CASE_TRANSITIONS` và vai trò (FR-012).
 */
export class TransitionStatusDto {
  @IsEnum(CaseStatus)
  toStatus!: CaseStatus;

  /**
   * Bắt buộc với các transition `requiresReason` (huỷ ca, báo nhầm) — được
   * kiểm tra ở state machine chứ không ở đây, vì điều kiện phụ thuộc cặp
   * (from, to) mà DTO không biết.
   */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason?: string;
}

const MAX_NOTE_LENGTH = 4000;

export class AddCaseNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NOTE_LENGTH)
  text!: string;

  @IsOptional()
  @IsEnum(NoteType)
  noteType?: NoteType;
}
