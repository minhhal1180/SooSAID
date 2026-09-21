import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Cấu hình ứng dụng – nạp một lần lúc bootstrap và validate ngay.
 *
 * Rule 9.2 (No Hard Code): mọi ngưỡng/TTL/feature flag đều đi qua đây, không có
 * magic number rải rác trong service.
 *
 * Fail-fast: cấu hình sai (secret ngắn, driver không tồn tại, memory driver ở
 * production) làm process dừng ngay lúc khởi động thay vì lỗi mơ hồ lúc chạy.
 */

export const PersistenceDriver = { POSTGRES: 'postgres', MEMORY: 'memory' } as const;
export type PersistenceDriver = (typeof PersistenceDriver)[keyof typeof PersistenceDriver];

export const CacheDriver = { REDIS: 'redis', MEMORY: 'memory' } as const;
export type CacheDriver = (typeof CacheDriver)[keyof typeof CacheDriver];

export const VideoProviderName = { MOCK: 'mock', LIVEKIT: 'livekit' } as const;
export type VideoProviderName = (typeof VideoProviderName)[keyof typeof VideoProviderName];

export const EmsIntegrationMode = { MOCK: 'mock', LIVE: 'live' } as const;
export type EmsIntegrationMode = (typeof EmsIntegrationMode)[keyof typeof EmsIntegrationMode];

/** Độ dài tối thiểu của secret ký JWT – dưới mức này HS256 không đủ entropy. */
const MIN_JWT_SECRET_LENGTH = 32;

export interface AppConfig {
  readonly nodeEnv: string;
  readonly isProduction: boolean;
  readonly port: number;
  readonly globalPrefix: string;
  readonly corsOrigins: string[];

  readonly persistence: {
    readonly driver: PersistenceDriver;
    readonly databaseUrl: string;
  };

  readonly cache: {
    readonly driver: CacheDriver;
    readonly redisUrl: string;
  };

  readonly auth: {
    readonly issuer: string;
    readonly accessSecret: string;
    readonly refreshSecret: string;
    readonly accessTtlSeconds: number;
    readonly refreshTtlSeconds: number;
    readonly otpDevEcho: boolean;
    /**
     * Trả OTP về đúng tài khoản demo để PWA tự điền. Cờ này chỉ phục vụ trình
     * diễn và bị chặn cứng ở production; mọi số khác vẫn nhận phản hồi chung.
     */
    readonly demoOtpAutofill: boolean;
    readonly demoPhone: string;
    /**
     * Cho phép đăng nhập tài khoản nghiệp vụ bằng endpoint dev (không mật khẩu).
     * CHỈ để chạy dashboard trong môi trường phát triển/diễn tập, trong khi cổng
     * OIDC/MFA của SOS-004 chưa được dựng. Bị chặn cứng ở production.
     */
    readonly devOperatorLogin: boolean;
  };

  readonly video: {
    readonly provider: VideoProviderName;
    readonly tokenTtlSeconds: number;
    readonly livekitUrl: string;
    readonly livekitApiKey: string;
    readonly livekitApiSecret: string;
  };

  readonly policy: {
    readonly recordingEnabled: boolean;
    readonly retentionProfile: string;
    readonly guidanceAllowDrillContent: boolean;
    readonly emsIntegrationMode: EmsIntegrationMode;
  };

  readonly rateLimit: {
    readonly otpPerHour: number;
    readonly sosPerHour: number;
  };
}

/** Token DI cho `AppConfig`. */
export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Parser .env tối giản (thay cho dependency dotenv – Rule 14: không thêm
 * dependency không cần thiết). Hỗ trợ `KEY=value`, comment `#`, nháy đơn/kép.
 * Biến đã có trong process.env được ưu tiên (CI/container override file).
 */
export function loadDotEnv(cwd: string = process.cwd()): void {
  const envPath = resolve(cwd, '.env');
  if (!existsSync(envPath)) return;

  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

class ConfigError extends Error {}

function requireString(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined || value === '') {
    throw new ConfigError(`Thiếu biến môi trường bắt buộc: ${key}`);
  }
  return value;
}

function readInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(`${key} phải là số nguyên dương, nhận được "${raw}"`);
  }
  return parsed;
}

function readBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}

function readEnum<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const raw = (process.env[key] ?? fallback) as T;
  if (!allowed.includes(raw)) {
    throw new ConfigError(`${key} phải thuộc [${allowed.join(', ')}], nhận được "${raw}"`);
  }
  return raw;
}

export function buildAppConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';

  const persistenceDriver = readEnum(
    'PERSISTENCE_DRIVER',
    [PersistenceDriver.POSTGRES, PersistenceDriver.MEMORY],
    PersistenceDriver.MEMORY,
  );
  const cacheDriver = readEnum(
    'CACHE_DRIVER',
    [CacheDriver.REDIS, CacheDriver.MEMORY],
    CacheDriver.MEMORY,
  );

  // ADR-004 / ADR-007: driver in-memory không bền vững và không chia sẻ được
  // giữa các instance. Để nó chạy ở production nghĩa là mất dữ liệu ca cấp cứu.
  if (isProduction && persistenceDriver === PersistenceDriver.MEMORY) {
    throw new ConfigError(
      'PERSISTENCE_DRIVER=memory bị cấm khi NODE_ENV=production (ADR-004). ' +
        'Đặt PERSISTENCE_DRIVER=postgres và cấu hình DATABASE_URL.',
    );
  }
  if (isProduction && cacheDriver === CacheDriver.MEMORY) {
    throw new ConfigError(
      'CACHE_DRIVER=memory bị cấm khi NODE_ENV=production (ADR-007). ' +
        'Đặt CACHE_DRIVER=redis và cấu hình REDIS_URL.',
    );
  }

  const accessSecret = requireString('JWT_ACCESS_SECRET');
  const refreshSecret = requireString('JWT_REFRESH_SECRET');
  for (const [name, secret] of [
    ['JWT_ACCESS_SECRET', accessSecret],
    ['JWT_REFRESH_SECRET', refreshSecret],
  ] as const) {
    if (secret.length < MIN_JWT_SECRET_LENGTH) {
      throw new ConfigError(`${name} phải dài tối thiểu ${MIN_JWT_SECRET_LENGTH} ký tự`);
    }
  }
  if (accessSecret === refreshSecret) {
    throw new ConfigError('JWT_ACCESS_SECRET và JWT_REFRESH_SECRET không được trùng nhau');
  }

  const otpDevEcho = readBool('AUTH_OTP_DEV_ECHO', false);
  if (isProduction && otpDevEcho) {
    throw new ConfigError('AUTH_OTP_DEV_ECHO=true bị cấm ở production (Rule 11 – Logging)');
  }

  const demoOtpAutofill = readBool('AUTH_DEMO_OTP_AUTOFILL', false);
  const demoPhone = (process.env.AUTH_DEMO_PHONE ?? '').trim();
  if (isProduction && demoOtpAutofill) {
    throw new ConfigError(
      'AUTH_DEMO_OTP_AUTOFILL=true bị cấm ở production: OTP không được trả về client.',
    );
  }
  if (demoOtpAutofill && !/^\+\d{8,15}$/.test(demoPhone)) {
    throw new ConfigError(
      'AUTH_DEMO_PHONE phải là số E.164 (ví dụ +84900000001) khi bật tự điền OTP demo.',
    );
  }

  const devOperatorLogin = readBool('AUTH_DEV_OPERATOR_LOGIN', false);
  if (isProduction && devOperatorLogin) {
    throw new ConfigError(
      'AUTH_DEV_OPERATOR_LOGIN=true bị cấm ở production: tài khoản có quyền xem dữ liệu ' +
        'y tế phải qua OIDC/MFA (SOS-004).',
    );
  }

  const emsIntegrationMode = readEnum(
    'EMS_INTEGRATION_MODE',
    [EmsIntegrationMode.MOCK, EmsIntegrationMode.LIVE],
    EmsIntegrationMode.MOCK,
  );
  // Rule 1.2: không tích hợp 115 thật khi chưa có API/SLA/phê duyệt.
  if (emsIntegrationMode === EmsIntegrationMode.LIVE) {
    throw new ConfigError(
      'EMS_INTEGRATION_MODE=live chưa được phép: cần API/quy chế/SLA chính thức với ' +
        'đầu mối 115 (Rule 1.2, Open Decision trong docs/decision-log/README.md).',
    );
  }

  return {
    nodeEnv,
    isProduction,
    port: readInt('PORT', 3000),
    globalPrefix: process.env.API_GLOBAL_PREFIX ?? 'v1',
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3001')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),

    persistence: {
      driver: persistenceDriver,
      databaseUrl:
        persistenceDriver === PersistenceDriver.POSTGRES
          ? requireString('DATABASE_URL')
          : (process.env.DATABASE_URL ?? ''),
    },

    cache: {
      driver: cacheDriver,
      redisUrl: process.env.REDIS_URL ?? '',
    },

    auth: {
      issuer: requireString('JWT_ISSUER', 'sos-aid-local'),
      accessSecret,
      refreshSecret,
      accessTtlSeconds: readInt('JWT_ACCESS_TTL_SECONDS', 900),
      refreshTtlSeconds: readInt('JWT_REFRESH_TTL_SECONDS', 2_592_000),
      otpDevEcho,
      demoOtpAutofill,
      demoPhone,
      devOperatorLogin,
    },

    video: {
      provider: readEnum(
        'VIDEO_PROVIDER',
        [VideoProviderName.MOCK, VideoProviderName.LIVEKIT],
        VideoProviderName.MOCK,
      ),
      tokenTtlSeconds: readInt('VIDEO_SESSION_TOKEN_TTL_SECONDS', 300),
      livekitUrl: process.env.LIVEKIT_URL ?? '',
      livekitApiKey: process.env.LIVEKIT_API_KEY ?? '',
      livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? '',
    },

    policy: {
      recordingEnabled: readBool('RECORDING_ENABLED', false),
      retentionProfile: process.env.RETENTION_PROFILE ?? 'pilot',
      guidanceAllowDrillContent: readBool('GUIDANCE_ALLOW_DRILL_CONTENT', false),
      emsIntegrationMode,
    },

    rateLimit: {
      otpPerHour: readInt('RATE_LIMIT_OTP_PER_HOUR', 5),
      sosPerHour: readInt('RATE_LIMIT_SOS_PER_HOUR', 10),
    },
  };
}
