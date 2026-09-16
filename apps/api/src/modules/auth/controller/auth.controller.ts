import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Public } from '../../../common/security/auth.decorators';
import { RefreshTokenDto, RequestOtpDto, VerifyOtpDto } from '../dto/auth.dto';
import { AuthService } from '../service/auth.service';

/**
 * Xác thực người dân (`/v1/auth/*`).
 *
 * `@Public()` vì đây là các endpoint duy nhất gọi được khi chưa có token. Chúng
 * được bảo vệ bằng rate limit thay vì bằng xác thực (TC-026).
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * 202 Accepted, không phải 200: server mới chỉ NHẬN yêu cầu gửi OTP, việc gửi
   * là bất đồng bộ qua nhà cung cấp SMS. Phản hồi giống hệt nhau dù số điện
   * thoại có tồn tại hay không.
   */
  @Post('otp/request')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  async requestOtp(@Body() body: RequestOtpDto) {
    await this.authService.requestOtp(body.phone);
    return { accepted: true };
  }

  @Post('otp/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() body: VerifyOtpDto) {
    return this.authService.verifyOtp(body.phone, body.otp);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: RefreshTokenDto) {
    return this.authService.refresh(body.refreshToken);
  }
}
