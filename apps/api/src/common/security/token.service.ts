import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { UserRole } from '../../contracts/generated/api-contract';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { DomainErrors } from '../errors/domain-error';

/**
 * Phát hành và kiểm tra JWT.
 *
 * Threat model – "Lost phone": access token ngắn hạn (mặc định 15 phút),
 * refresh token có `jti` để thu hồi được từng phiên (refresh rotation).
 * Access token và refresh token ký bằng HAI secret khác nhau để token loại này
 * không dùng thay token loại kia được.
 */

export const TokenType = { ACCESS: 'access', REFRESH: 'refresh' } as const;
export type TokenType = (typeof TokenType)[keyof typeof TokenType];

export interface AccessTokenClaims {
  sub: string;
  roles: UserRole[];
  serviceAreaIds: string[];
  typ: typeof TokenType.ACCESS;
}

export interface RefreshTokenClaims {
  sub: string;
  /** Định danh phiên, dùng để thu hồi (remote logout). */
  jti: string;
  typ: typeof TokenType.REFRESH;
}

export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  refreshTokenId: string;
  expiresInSeconds: number;
}

@Injectable()
export class TokenService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  issuePair(input: {
    userId: string;
    roles: UserRole[];
    serviceAreaIds: string[];
  }): IssuedTokenPair {
    const { auth } = this.config;
    const refreshTokenId = randomUUID();

    const accessToken = jwt.sign(
      {
        roles: input.roles,
        serviceAreaIds: input.serviceAreaIds,
        typ: TokenType.ACCESS,
      },
      auth.accessSecret,
      {
        subject: input.userId,
        issuer: auth.issuer,
        expiresIn: auth.accessTtlSeconds,
      },
    );

    const refreshToken = jwt.sign({ typ: TokenType.REFRESH }, auth.refreshSecret, {
      subject: input.userId,
      issuer: auth.issuer,
      expiresIn: auth.refreshTtlSeconds,
      jwtid: refreshTokenId,
    });

    return {
      accessToken,
      refreshToken,
      refreshTokenId,
      expiresInSeconds: auth.accessTtlSeconds,
    };
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    const payload = this.verify(token, this.config.auth.accessSecret);
    if (payload.typ !== TokenType.ACCESS) {
      throw DomainErrors.unauthenticated('Sai loại token.');
    }
    return {
      sub: String(payload.sub),
      roles: Array.isArray(payload.roles) ? (payload.roles as UserRole[]) : [],
      serviceAreaIds: Array.isArray(payload.serviceAreaIds)
        ? (payload.serviceAreaIds as string[])
        : [],
      typ: TokenType.ACCESS,
    };
  }

  verifyRefreshToken(token: string): RefreshTokenClaims {
    const payload = this.verify(token, this.config.auth.refreshSecret);
    if (payload.typ !== TokenType.REFRESH || typeof payload.jti !== 'string') {
      throw DomainErrors.unauthenticated('Sai loại token.');
    }
    return { sub: String(payload.sub), jti: payload.jti, typ: TokenType.REFRESH };
  }

  private verify(token: string, secret: string): JwtPayload & { typ?: string } {
    try {
      const payload = jwt.verify(token, secret, {
        issuer: this.config.auth.issuer,
        algorithms: ['HS256'],
      });
      if (typeof payload === 'string') {
        throw DomainErrors.unauthenticated('Token không hợp lệ.');
      }
      return payload as JwtPayload & { typ?: string };
    } catch (error) {
      // Không trả chi tiết lý do (hết hạn/sai chữ ký/sai issuer) cho client:
      // đó là thông tin hữu ích cho kẻ dò token. Chi tiết chỉ đi vào log.
      throw DomainErrors.unauthenticated(
        error instanceof jwt.TokenExpiredError
          ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
          : 'Token không hợp lệ.',
      );
    }
  }
}
