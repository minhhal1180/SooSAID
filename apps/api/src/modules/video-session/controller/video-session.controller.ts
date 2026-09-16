import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { IsEnum, IsOptional } from 'class-validator';
import { VideoParticipantRole } from '../../../contracts/generated/api-contract';
import { CurrentActor } from '../../../common/security/auth.decorators';
import type { AuthenticatedActor } from '../../../common/http/request-context';
import { VideoSessionService } from '../service/video-session.service';

export class CreateVideoSessionDto {
  /**
   * Vai trò mong muốn. Server vẫn tự suy ra vai trò thật từ token; trường này
   * chỉ để client tự kiểm tra kỳ vọng của mình (xem `resolveParticipantRole`).
   */
  @IsOptional()
  @IsEnum(VideoParticipantRole)
  role?: VideoParticipantRole;
}

/** Phiên video theo ca (`/v1/emergency-cases/{caseId}/video/session`). */
@Controller('emergency-cases/:caseId/video/session')
export class VideoSessionController {
  constructor(private readonly videoSessionService: VideoSessionService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async join(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() body: CreateVideoSessionDto,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.videoSessionService.joinSession(caseId, actor, body.role);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async end(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<void> {
    await this.videoSessionService.endSession(caseId, actor);
  }
}
