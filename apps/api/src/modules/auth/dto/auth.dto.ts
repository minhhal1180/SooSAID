import { IsString, Length, Matches } from 'class-validator';

/** Số điện thoại VN hoặc E.164 (khớp `PHONE_PATTERN` của module users). */
const PHONE_PATTERN = /^(\+?\d{8,15})$/;
const OTP_LENGTH = 6;

export class RequestOtpDto {
  @Matches(PHONE_PATTERN, { message: 'Số điện thoại không hợp lệ.' })
  phone!: string;
}

export class VerifyOtpDto {
  @Matches(PHONE_PATTERN, { message: 'Số điện thoại không hợp lệ.' })
  phone!: string;

  @IsString()
  @Length(OTP_LENGTH, OTP_LENGTH)
  otp!: string;
}

export class RefreshTokenDto {
  @IsString()
  @Length(20, 4096)
  refreshToken!: string;
}
