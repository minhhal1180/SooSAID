import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '../src/contracts/generated/api-contract';
import { TokenService } from '../src/common/security/token.service';
import { MemoryDb } from '../src/persistence/memory/memory-db';
import { MemorySeeder, SEED_IDS } from '../src/persistence/memory/memory-seeder';

/**
 * Dựng ứng dụng thật cho acceptance test, chạy trên driver `memory` (ADR-004).
 *
 * Lưu ý về phạm vi: acceptance test ở đây kiểm chứng NGHIỆP VỤ (state machine,
 * phân quyền, idempotency, envelope). Các bảo đảm của tầng DB — transaction,
 * constraint, trigger append-only, PostGIS — CHỈ được kiểm chứng bởi integration
 * test chạy trên PostgreSQL thật (Rule 15).
 */

/** Đặt env trước khi Nest nạp `AppConfig`, vì config validate ngay lúc khởi tạo. */
export function configureTestEnvironment(): void {
  process.env.NODE_ENV = 'test';
  process.env.PERSISTENCE_DRIVER = 'memory';
  process.env.CACHE_DRIVER = 'memory';
  process.env.JWT_ISSUER = 'sos-aid-test';
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters';
  process.env.AUTH_OTP_DEV_ECHO = 'false';
  process.env.VIDEO_PROVIDER = 'mock';
  process.env.RECORDING_ENABLED = 'false';
  process.env.GUIDANCE_ALLOW_DRILL_CONTENT = 'true';
  process.env.EMS_INTEGRATION_MODE = 'mock';
  process.env.RATE_LIMIT_SOS_PER_HOUR = '1000';
  process.env.RATE_LIMIT_OTP_PER_HOUR = '5';
}

export interface TestContext {
  app: INestApplication;
  db: MemoryDb;
  tokenService: TokenService;
  /**
   * Phát token trực tiếp thay vì đi qua OTP.
   *
   * Cần thiết vì luồng OTP CỐ Ý từ chối tài khoản nghiệp vụ (SOS-004: operator
   * không dùng OTP tiêu dùng), nên không có cách nào lấy token operator qua API
   * công khai — đúng như thiết kế.
   */
  tokenFor(userId: string, roles: UserRole[], serviceAreaIds?: string[]): string;
}

export async function createTestApp(): Promise<TestContext> {
  configureTestEnvironment();

  // Import động SAU khi env đã sẵn sàng.
  const { AppModule } = await import('../src/app.module');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false, value: false },
    }),
  );
  await app.init();

  const db = app.get(MemoryDb);
  // `onApplicationBootstrap` không chạy với `app.init()`, nên seed thủ công.
  app.get(MemorySeeder).seed();

  const tokenService = app.get(TokenService);

  return {
    app,
    db,
    tokenService,
    tokenFor: (userId, roles, serviceAreaIds = []) =>
      tokenService.issuePair({ userId, roles, serviceAreaIds }).accessToken,
  };
}

/** Token cho từng vai trò mô phỏng trong seed. */
export function seedTokens(ctx: TestContext) {
  return {
    citizen: ctx.tokenFor(SEED_IDS.citizen, [UserRole.CITIZEN]),
    operator: ctx.tokenFor(SEED_IDS.operator, [UserRole.OPERATOR_115]),
    otherOperator: ctx.tokenFor(randomUUID(), [UserRole.OPERATOR_115]),
    clinician: ctx.tokenFor(SEED_IDS.clinician, [UserRole.CLINICIAN]),
    crew: ctx.tokenFor(SEED_IDS.crew, [UserRole.AMBULANCE_CREW]),
    responder: ctx.tokenFor(SEED_IDS.responder, [UserRole.LOCAL_RESPONDER]),
    admin: ctx.tokenFor(SEED_IDS.admin, [UserRole.ADMIN]),
    stranger: ctx.tokenFor(randomUUID(), [UserRole.CITIZEN]),
  };
}

export const bearer = (token: string): string => `Bearer ${token}`;

/** Toạ độ nằm trong service area mô phỏng của seed. */
export const PILOT_LOCATION = { lat: 21.021, lng: 105.841 };
