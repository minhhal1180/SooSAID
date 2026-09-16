import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { LocationSampleDto } from '../../../common/dto/location-sample.dto';
import { CurrentActor } from '../../../common/security/auth.decorators';
import type { AuthenticatedActor } from '../../../common/http/request-context';
import { LocationService } from '../service/location.service';

/** Cập nhật và tra cứu vị trí của ca (`/v1/emergency-cases/{caseId}/location`). */
@Controller('emergency-cases/:caseId/location')
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  /**
   * 202 Accepted: mẫu vị trí được ghi nhận, nhưng client KHÔNG cần chờ kết quả
   * xử lý downstream (bản đồ, thông báo). Mobile gửi mẫu liên tục nên phản hồi
   * phải nhẹ.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async append(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() body: LocationSampleDto,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    await this.locationService.appendSample(
      {
        caseId,
        lat: body.lat,
        lng: body.lng,
        accuracyMeters: body.accuracyMeters ?? null,
        altitudeMeters: body.altitudeMeters ?? null,
        capturedAt: body.capturedAt,
        addressText: body.addressText ?? null,
        accessNote: body.accessNote ?? null,
      },
      actor,
    );
    return { accepted: true };
  }

  @Get('history')
  async history(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.locationService.listHistory(caseId, actor);
  }
}
