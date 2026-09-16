import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentActor } from '../../../common/security/auth.decorators';
import type { AuthenticatedActor } from '../../../common/http/request-context';
import {
  CreateEmergencyContactDto,
  EmergencyProfileDto,
  RegisterDeviceDto,
  UpdateMeDto,
} from '../dto/profile.dto';
import { UsersService } from '../service/users.service';

/**
 * API hồ sơ cá nhân (`/v1/me/*`).
 *
 * Mọi endpoint ở đây chỉ thao tác trên dữ liệu của CHÍNH người gọi: `userId`
 * luôn lấy từ token, không bao giờ từ path/body. Nhờ vậy không tồn tại IDOR
 * trên bề mặt này.
 */
@Controller('me')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async me(@CurrentActor() actor: AuthenticatedActor) {
    return this.usersService.getMe(actor.userId);
  }

  @Patch()
  async updateMe(@CurrentActor() actor: AuthenticatedActor, @Body() body: UpdateMeDto) {
    return this.usersService.updateMe(actor.userId, body);
  }

  @Get('emergency-profile')
  async getEmergencyProfile(@CurrentActor() actor: AuthenticatedActor) {
    return this.usersService.getOwnEmergencyProfile(actor.userId);
  }

  /** PUT (không PATCH): hồ sơ sức khỏe được thay toàn bộ, tránh trạng thái nửa vời. */
  @Put('emergency-profile')
  async putEmergencyProfile(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() body: EmergencyProfileDto,
  ) {
    return this.usersService.replaceEmergencyProfile(actor.userId, {
      bloodType: body.bloodType ?? null,
      allergies: body.allergies ?? [],
      chronicConditions: body.chronicConditions ?? [],
      medications: body.medications ?? [],
      preferredFacility: body.preferredFacility ?? null,
      specialNote: body.specialNote ?? null,
      consentShareInEmergency: body.consentShareInEmergency ?? false,
    });
  }

  @Get('emergency-contacts')
  async listContacts(@CurrentActor() actor: AuthenticatedActor) {
    return { items: await this.usersService.listEmergencyContacts(actor.userId) };
  }

  @Post('emergency-contacts')
  @HttpCode(HttpStatus.CREATED)
  async addContact(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() body: CreateEmergencyContactDto,
  ) {
    return this.usersService.addEmergencyContact(actor.userId, body);
  }

  @Delete('emergency-contacts/:contactId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteContact(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('contactId', ParseUUIDPipe) contactId: string,
  ): Promise<void> {
    await this.usersService.deleteEmergencyContact(actor.userId, contactId);
  }

  /** Đăng ký thiết bị để nhận push và để gắn `deviceId` vào ca cấp cứu. */
  @Post('devices')
  @HttpCode(HttpStatus.CREATED)
  async registerDevice(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() body: RegisterDeviceDto,
  ) {
    return this.usersService.registerDevice(actor.userId, body);
  }
}
