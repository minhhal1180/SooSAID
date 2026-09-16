import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** Số câu tối đa trong một phiếu – chặn payload rác. */
const MAX_ANSWERS = 50;

export class TriageAnswerDto {
  @IsString()
  @MaxLength(64)
  questionCode!: string;

  @IsString()
  @MaxLength(64)
  value!: string;
}

export class SubmitTriageDto {
  @IsString()
  @MaxLength(64)
  questionnaireVersion!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ANSWERS)
  @ValidateNested({ each: true })
  @Type(() => TriageAnswerDto)
  answers!: TriageAnswerDto[];
}
