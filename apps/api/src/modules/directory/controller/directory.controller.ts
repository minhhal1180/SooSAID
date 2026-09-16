import { Controller, Get, Query } from '@nestjs/common';
import { NearbyQueryDto, NearbyResourceQueryDto } from '../dto/nearby-query.dto';
import { DirectoryService } from '../service/directory.service';

/**
 * Danh bạ cơ sở y tế và điểm hỗ trợ tại chỗ (TC-020, TC-021).
 *
 * Yêu cầu đăng nhập (guard toàn cục): đây là dữ liệu cấu hình vận hành, trong đó
 * `access_instruction` mô tả cách vào khuôn viên/mở barrier — không để lộ công khai.
 */
@Controller()
export class DirectoryController {
  constructor(private readonly directoryService: DirectoryService) {}

  @Get('facilities/nearby')
  async nearbyFacilities(@Query() query: NearbyQueryDto) {
    return this.directoryService.findNearbyFacilities(
      { lat: query.lat, lng: query.lng },
      query.radiusMeters,
    );
  }

  @Get('resources/nearby')
  async nearbyResources(@Query() query: NearbyResourceQueryDto) {
    return this.directoryService.findNearbyResources(
      { lat: query.lat, lng: query.lng },
      { radiusMeters: query.radiusMeters, resourceType: query.resourceType },
    );
  }
}
