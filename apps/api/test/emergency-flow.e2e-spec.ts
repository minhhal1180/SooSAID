import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  ApiErrorCode,
  AssignmentStatus,
  CasePhase,
  CaseStatus,
  UserRole,
} from '../src/contracts/generated/api-contract';
import { SEED_IDS } from '../src/persistence/memory/memory-seeder';
import {
  PILOT_LOCATION,
  bearer,
  createTestApp,
  seedTokens,
  type TestContext,
} from './test-app';

/**
 * Acceptance test luồng cấp cứu đầu-cuối.
 *
 * Map trực tiếp sang `tests/test_cases.csv` của Developer Kit — mã TC ghi ngay
 * trong tên test để truy vết được (Rule 10).
 */
describe('Luồng ca cấp cứu (acceptance)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let tokens: ReturnType<typeof seedTokens>;

  const newIdempotencyKey = (): string => randomUUID();

  const createCaseBody = (overrides: Record<string, unknown> = {}) => ({
    deviceId: randomUUID(),
    location: {
      ...PILOT_LOCATION,
      accuracyMeters: 12,
      capturedAt: new Date().toISOString(),
      accessNote: 'Cong chinh, tang 2',
    },
    numberOfPatients: 1,
    mediaConsent: false,
    ...overrides,
  });

  /** Tạo một ca mới và trả về payload đã gỡ envelope. */
  const createCase = async (token = tokens.citizen) => {
    const response = await request(app.getHttpServer())
      .post('/v1/emergency-cases')
      .set('Authorization', bearer(token))
      .set('Idempotency-Key', newIdempotencyKey())
      .send(createCaseBody())
      .expect(201);
    return response.body.data;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    tokens = seedTokens(ctx);
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Envelope và bảo mật cơ bản
  // -------------------------------------------------------------------------

  describe('Envelope response (Rule 6.2 / ADR-003)', () => {
    it('trả đúng cấu trúc { success, data, requestId } khi thành công', async () => {
      const response = await request(app.getHttpServer()).get('/v1/health').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(typeof response.body.requestId).toBe('string');
    });

    it('trả đúng cấu trúc { success, error, requestId } khi lỗi', async () => {
      const response = await request(app.getHttpServer()).get('/v1/me').expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(ApiErrorCode.UNAUTHENTICATED);
      expect(typeof response.body.error.message).toBe('string');
      expect(response.body.error.message).not.toContain('at ');
    });

    it('deny-by-default: endpoint không gắn @Public đều yêu cầu token', async () => {
      await request(app.getHttpServer()).get('/v1/emergency-cases/mine').expect(401);
      await request(app.getHttpServer()).get('/v1/operator/queue').expect(401);
      await request(app.getHttpServer()).get('/v1/first-aid-guides').expect(401);
    });

    it('từ chối field lạ trong body thay vì âm thầm bỏ qua', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/emergency-cases')
        .set('Authorization', bearer(tokens.citizen))
        .set('Idempotency-Key', newIdempotencyKey())
        .send({ ...createCaseBody(), severityLevel: 'critical' })
        .expect(400);

      expect(response.body.error.code).toBe(ApiErrorCode.VALIDATION_FAILED);
    });
  });

  // -------------------------------------------------------------------------
  // TC-001 / TC-002 / TC-003: tạo ca và chống trùng
  // -------------------------------------------------------------------------

  describe('Tạo ca S.O.S', () => {
    it('TC-001: tạo được ca với mã duy nhất, trạng thái QUEUED, vị trí được lưu', async () => {
      const data = await createCase();

      expect(data.id).toBeDefined();
      expect(data.code).toMatch(/^SOS-\d{8}-\d{6}$/);
      // CREATED -> QUEUED do hệ thống tự chuyển ngay sau khi persist (Rule 7.2).
      expect(data.status).toBe(CaseStatus.QUEUED);
      expect(data.phase).toBe(CasePhase.ALERTED);
      expect(data.latestLocation.lat).toBeCloseTo(PILOT_LOCATION.lat, 5);
      expect(data.serviceAreaId).toBe(SEED_IDS.serviceArea);
      expect(data.realtimeChannel).toBe(`case:${data.id}`);
    });

    it('TC-002: retry cùng Idempotency-Key chỉ tạo MỘT ca và trả cùng kết quả', async () => {
      const key = newIdempotencyKey();
      const body = createCaseBody();

      const first = await request(app.getHttpServer())
        .post('/v1/emergency-cases')
        .set('Authorization', bearer(tokens.citizen))
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);

      const second = await request(app.getHttpServer())
        .post('/v1/emergency-cases')
        .set('Authorization', bearer(tokens.citizen))
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);

      expect(second.body.data.id).toBe(first.body.data.id);
      expect(second.body.data.code).toBe(first.body.data.code);
    });

    it('TC-002: cùng key nhưng khác nội dung bị từ chối, không tạo ca thứ hai', async () => {
      const key = newIdempotencyKey();

      await request(app.getHttpServer())
        .post('/v1/emergency-cases')
        .set('Authorization', bearer(tokens.citizen))
        .set('Idempotency-Key', key)
        .send(createCaseBody())
        .expect(201);

      const conflict = await request(app.getHttpServer())
        .post('/v1/emergency-cases')
        .set('Authorization', bearer(tokens.citizen))
        .set('Idempotency-Key', key)
        .send(createCaseBody({ numberOfPatients: 3 }))
        .expect(409);

      expect(conflict.body.error.code).toBe(ApiErrorCode.IDEMPOTENCY_CONFLICT);
    });

    it('TC-003: thiếu Idempotency-Key bị từ chối để không sinh ca trùng khi double tap', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/emergency-cases')
        .set('Authorization', bearer(tokens.citizen))
        .send(createCaseBody())
        .expect(400);

      expect(response.body.error.message).toContain('Idempotency-Key');
    });

    it('mã ca tăng dần và không trùng nhau', async () => {
      const codes = new Set<string>();
      for (let i = 0; i < 5; i += 1) {
        codes.add((await createCase()).code);
      }
      expect(codes.size).toBe(5);
    });

    it('từ chối toạ độ không hợp lệ', async () => {
      await request(app.getHttpServer())
        .post('/v1/emergency-cases')
        .set('Authorization', bearer(tokens.citizen))
        .set('Idempotency-Key', newIdempotencyKey())
        .send(createCaseBody({ location: { lat: 999, lng: 105, capturedAt: new Date().toISOString() } }))
        .expect(400);
    });
  });

  // -------------------------------------------------------------------------
  // TC-007 / TC-025: hàng đợi, nhận ca, phân quyền
  // -------------------------------------------------------------------------

  describe('Hàng đợi tổng đài và nhận ca', () => {
    it('ca mới xuất hiện trong hàng đợi của tổng đài', async () => {
      const created = await createCase();

      const queue = await request(app.getHttpServer())
        .get('/v1/operator/queue')
        .set('Authorization', bearer(tokens.operator))
        .expect(200);

      expect(queue.body.data.map((item: { id: string }) => item.id)).toContain(created.id);
    });

    it('TC-007: hai tổng đài nhận cùng lúc – đúng một người thắng', async () => {
      const created = await createCase();

      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .post(`/v1/operator/cases/${created.id}/accept`)
          .set('Authorization', bearer(tokens.operator)),
        request(app.getHttpServer())
          .post(`/v1/operator/cases/${created.id}/accept`)
          .set('Authorization', bearer(tokens.otherOperator)),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);

      const loser = first.status === 409 ? first : second;
      expect([ApiErrorCode.CASE_ALREADY_ACCEPTED, ApiErrorCode.CASE_INVALID_TRANSITION]).toContain(
        loser.body.error.code,
      );
    });

    it('TC-025: người dân khác không xem được ca, và nhận 404 chứ không phải 403', async () => {
      const created = await createCase();

      const response = await request(app.getHttpServer())
        .get(`/v1/emergency-cases/${created.id}`)
        .set('Authorization', bearer(tokens.stranger))
        .expect(404);

      // 404 thay vì 403: không xác nhận ca có tồn tại hay không.
      expect(response.body.error.code).toBe(ApiErrorCode.NOT_FOUND);
    });

    it('TC-025: mọi truy cập bị từ chối đều để lại dấu vết audit', async () => {
      const created = await createCase();
      const before = ctx.db.auditLogs.findMany((row) => row.result === 'DENIED').length;

      await request(app.getHttpServer())
        .get(`/v1/emergency-cases/${created.id}`)
        .set('Authorization', bearer(tokens.stranger))
        .expect(404);

      const after = ctx.db.auditLogs.findMany((row) => row.result === 'DENIED').length;
      expect(after).toBe(before + 1);
    });

    it('người dân không gọi được API của tổng đài', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/operator/queue')
        .set('Authorization', bearer(tokens.citizen))
        .expect(403);

      expect(response.body.error.code).toBe(ApiErrorCode.FORBIDDEN);
    });
  });

  // -------------------------------------------------------------------------
  // TC-012: state machine qua API
  // -------------------------------------------------------------------------

  describe('Chuyển trạng thái ca (FR-012)', () => {
    it('TC-012: kíp xe không nhảy thẳng ca QUEUED sang HANDED_OVER', async () => {
      const created = await createCase();

      const response = await request(app.getHttpServer())
        .post(`/v1/emergency-cases/${created.id}/status`)
        .set('Authorization', bearer(tokens.crew))
        .send({ toStatus: CaseStatus.HANDED_OVER })
        .expect(404);

      // Kíp xe chưa được phân công nên thậm chí không thấy ca này.
      expect(response.body.error.code).toBe(ApiErrorCode.NOT_FOUND);
    });

    it('TC-029: đánh dấu báo nhầm bắt buộc nêu lý do', async () => {
      const created = await createCase();

      const missingReason = await request(app.getHttpServer())
        .post(`/v1/emergency-cases/${created.id}/status`)
        .set('Authorization', bearer(tokens.operator))
        .send({ toStatus: CaseStatus.FALSE_ALARM })
        .expect(400);
      expect(missingReason.body.error.code).toBe(ApiErrorCode.VALIDATION_FAILED);

      const withReason = await request(app.getHttpServer())
        .post(`/v1/emergency-cases/${created.id}/status`)
        .set('Authorization', bearer(tokens.operator))
        .send({ toStatus: CaseStatus.FALSE_ALARM, reason: 'Nguoi goi xac nhan bam nham' })
        .expect(200);
      expect(withReason.body.data.status).toBe(CaseStatus.FALSE_ALARM);
    });

    it('bác sĩ trực không được đánh dấu báo nhầm (chỉ tổng đài)', async () => {
      const created = await createCase();

      await request(app.getHttpServer())
        .post(`/v1/emergency-cases/${created.id}/status`)
        .set('Authorization', bearer(tokens.clinician))
        .send({ toStatus: CaseStatus.FALSE_ALARM, reason: 'Thu nghiem' })
        .expect(403);
    });

    it('ca đã kết thúc không nhận thêm cập nhật vị trí', async () => {
      const created = await createCase();

      await request(app.getHttpServer())
        .post(`/v1/emergency-cases/${created.id}/status`)
        .set('Authorization', bearer(tokens.operator))
        .send({ toStatus: CaseStatus.FALSE_ALARM, reason: 'Bam nham' })
        .expect(200);

      const response = await request(app.getHttpServer())
        .post(`/v1/emergency-cases/${created.id}/location`)
        .set('Authorization', bearer(tokens.citizen))
        .send({ ...PILOT_LOCATION, capturedAt: new Date().toISOString() })
        .expect(409);

      expect(response.body.error.code).toBe(ApiErrorCode.CONFLICT);
    });
  });

  // -------------------------------------------------------------------------
  // Luồng đầy-đủ: TC-006, TC-008, TC-011, TC-018
  // -------------------------------------------------------------------------

  describe('Luồng hoàn chỉnh: tạo → nhận → triage → video → điều phối → bàn giao', () => {
    it('chạy trọn vẹn và sinh hồ sơ bàn giao bất biến', async () => {
      const server = app.getHttpServer();
      const created = await createCase();
      const caseId = created.id;

      // --- TC-012 (vị trí): gửi thêm mẫu vị trí ---
      await request(server)
        .post(`/v1/emergency-cases/${caseId}/location`)
        .set('Authorization', bearer(tokens.citizen))
        .send({
          lat: PILOT_LOCATION.lat + 0.0002,
          lng: PILOT_LOCATION.lng,
          accuracyMeters: 8,
          capturedAt: new Date().toISOString(),
        })
        .expect(202);

      // --- TC-006: phiếu quan sát ---
      const questionnaire = await request(server)
        .get('/v1/triage/questionnaire')
        .set('Authorization', bearer(tokens.citizen))
        .expect(200);

      await request(server)
        .post(`/v1/emergency-cases/${caseId}/triage`)
        .set('Authorization', bearer(tokens.citizen))
        .send({
          questionnaireVersion: questionnaire.body.data.version,
          answers: [
            { questionCode: 'responsive', value: 'yes' },
            { questionCode: 'breathing_visible', value: 'unknown' },
          ],
        })
        .expect(202);

      // --- Tổng đài nhận ca ---
      const accepted = await request(server)
        .post(`/v1/operator/cases/${caseId}/accept`)
        .set('Authorization', bearer(tokens.operator))
        .expect(200);
      expect(accepted.body.data.status).toBe(CaseStatus.ACCEPTED);
      expect(accepted.body.data.phase).toBe(CasePhase.CONNECTING);

      // --- TC-008: phiên video ---
      const video = await request(server)
        .post(`/v1/emergency-cases/${caseId}/video/session`)
        .set('Authorization', bearer(tokens.citizen))
        .send({})
        .expect(200);

      expect(video.body.data.provider).toBe('mock');
      expect(video.body.data.room).toBe(`case-${caseId}`);
      expect(video.body.data.token).toBeTruthy();
      // TC-016: ghi hình TẮT vì RECORDING_ENABLED=false.
      expect(video.body.data.recordingEnabled).toBe(false);
      // Token có hạn ngắn (threat model).
      expect(new Date(video.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());

      const afterVideo = await request(server)
        .get(`/v1/emergency-cases/${caseId}`)
        .set('Authorization', bearer(tokens.operator))
        .expect(200);
      expect(afterVideo.body.data.status).toBe(CaseStatus.VIDEO_CONNECTED);
      expect(afterVideo.body.data.phase).toBe(CasePhase.VIDEO_SUPPORT);

      // --- Hướng dẫn sơ cấp cứu ---
      const guides = await request(server)
        .get('/v1/first-aid-guides')
        .set('Authorization', bearer(tokens.operator))
        .expect(200);

      const guide = guides.body.data.items[0];
      // Nội dung seed chưa được duyệt -> phải được đánh dấu rõ ràng.
      expect(guide.drillOnly).toBe(true);

      await request(server)
        .post(`/v1/emergency-cases/${caseId}/guidance`)
        .set('Authorization', bearer(tokens.operator))
        .send({ guidanceId: guide.id })
        .expect(200);

      // --- TC-011: điều phối kíp xe ---
      const candidates = await request(server)
        .get(`/v1/emergency-cases/${caseId}/dispatch/candidates`)
        .set('Authorization', bearer(tokens.operator))
        .expect(200);
      expect(candidates.body.data.ambulanceUnits.length).toBeGreaterThan(0);

      const assignment = await request(server)
        .post(`/v1/emergency-cases/${caseId}/dispatch`)
        .set('Authorization', bearer(tokens.operator))
        .send({ targetType: 'ambulance_unit', targetId: SEED_IDS.ambulanceUnit })
        .expect(201);
      expect(assignment.body.data.status).toBe(AssignmentStatus.PENDING);

      const afterDispatch = await request(server)
        .get(`/v1/emergency-cases/${caseId}`)
        .set('Authorization', bearer(tokens.operator))
        .expect(200);
      expect(afterDispatch.body.data.status).toBe(CaseStatus.DISPATCHED);

      // --- Kíp xe di chuyển: PENDING → ACCEPTED → EN_ROUTE → ARRIVED ---
      const assignmentId = assignment.body.data.id;

      for (const status of [
        AssignmentStatus.ACCEPTED,
        AssignmentStatus.EN_ROUTE,
        AssignmentStatus.ARRIVED,
      ]) {
        await request(server)
          .post(`/v1/assignments/${assignmentId}/status`)
          .set('Authorization', bearer(tokens.crew))
          .send({ status })
          .expect(200);
      }

      const onScene = await request(server)
        .get(`/v1/emergency-cases/${caseId}`)
        .set('Authorization', bearer(tokens.operator))
        .expect(200);
      expect(onScene.body.data.status).toBe(CaseStatus.ON_SCENE);

      // --- Chuẩn bị bàn giao ---
      await request(server)
        .post(`/v1/emergency-cases/${caseId}/status`)
        .set('Authorization', bearer(tokens.clinician))
        .send({ toStatus: CaseStatus.HANDOVER_PENDING })
        .expect(200);

      // --- TC-018: chốt hồ sơ bàn giao ---
      const handover = await request(server)
        .post(`/v1/emergency-cases/${caseId}/handover`)
        .set('Authorization', bearer(tokens.clinician))
        .send({})
        .expect(201);

      expect(handover.body.data.version).toBe(1);
      expect(handover.body.data.status).toBe('FINALIZED');

      const stored = await request(server)
        .get(`/v1/emergency-cases/${caseId}/handover/1`)
        .set('Authorization', bearer(tokens.clinician))
        .expect(200);

      const payload = stored.body.data.payload;
      expect(payload.case.code).toBe(created.code);
      expect(payload.triage.length).toBeGreaterThan(0);
      expect(payload.guidancePerformed.length).toBeGreaterThan(0);
      expect(payload.assignments.length).toBeGreaterThan(0);
      expect(payload.locationTrail.length).toBeGreaterThan(0);
      expect(payload.keyTimestamps.acceptedAt).toBeTruthy();
      expect(payload.disclaimer).toContain('KHÔNG chứa chẩn đoán');

      // --- TC-019: chốt lần nữa tạo version mới, version cũ không đổi ---
      const second = await request(server)
        .post(`/v1/emergency-cases/${caseId}/handover`)
        .set('Authorization', bearer(tokens.clinician))
        .send({})
        .expect(201);
      expect(second.body.data.version).toBe(2);

      const v1Again = await request(server)
        .get(`/v1/emergency-cases/${caseId}/handover/1`)
        .set('Authorization', bearer(tokens.clinician))
        .expect(200);
      expect(v1Again.body.data.payload.generatedAt).toBe(payload.generatedAt);

      // --- TC-030: đóng ca ---
      await request(server)
        .post(`/v1/emergency-cases/${caseId}/status`)
        .set('Authorization', bearer(tokens.clinician))
        .send({ toStatus: CaseStatus.HANDED_OVER })
        .expect(200);

      const closed = await request(server)
        .post(`/v1/emergency-cases/${caseId}/status`)
        .set('Authorization', bearer(tokens.operator))
        .send({ toStatus: CaseStatus.CLOSED })
        .expect(200);

      expect(closed.body.data.status).toBe(CaseStatus.CLOSED);
      expect(closed.body.data.phase).toBe(CasePhase.COMPLETED);
      expect(closed.body.data.closedAt).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // TC-013 / TC-015 / TC-020 / TC-021 / TC-024
  // -------------------------------------------------------------------------

  describe('Danh bạ, hồ sơ sức khỏe và audit', () => {
    it('TC-020: tìm cơ sở y tế gần, có ghi rõ độ chính xác không gian', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/facilities/nearby?lat=${PILOT_LOCATION.lat}&lng=${PILOT_LOCATION.lng}`)
        .set('Authorization', bearer(tokens.operator))
        .expect(200);

      expect(response.body.data.items.length).toBeGreaterThan(0);
      // ADR-004: driver memory phải tự khai báo là xấp xỉ.
      expect(response.body.data.spatialAccuracy).toBe('approximate');
      const distances = response.body.data.items.map((item: { distanceMeters: number }) => item.distanceMeters);
      expect(distances).toEqual([...distances].sort((a, b) => a - b));
    });

    it('TC-021: tìm điểm hỗ trợ tại chỗ kèm chỉ dẫn tiếp cận', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/resources/nearby?lat=${PILOT_LOCATION.lat}&lng=${PILOT_LOCATION.lng}&resourceType=AED`)
        .set('Authorization', bearer(tokens.operator))
        .expect(200);

      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.items[0].accessInstruction).toBeTruthy();
    });

    it('TC-015: hồ sơ sức khỏe không được gắn vào ca khi chưa có đồng ý', async () => {
      await request(app.getHttpServer())
        .put('/v1/me/emergency-profile')
        .set('Authorization', bearer(tokens.citizen))
        .send({ bloodType: 'O', allergies: ['penicillin'], consentShareInEmergency: false })
        .expect(200);

      const created = await createCase();
      const row = ctx.db.emergencyCases.findById(created.id);
      expect(row?.emergency_profile_snapshot).toBeNull();
    });

    it('TC-015: có đồng ý thì snapshot được chốt tại thời điểm tạo ca', async () => {
      await request(app.getHttpServer())
        .put('/v1/me/emergency-profile')
        .set('Authorization', bearer(tokens.citizen))
        .send({ bloodType: 'A', allergies: ['bui phan'], consentShareInEmergency: true })
        .expect(200);

      const created = await createCase();
      const row = ctx.db.emergencyCases.findById(created.id);
      expect(row?.emergency_profile_snapshot).toMatchObject({ bloodType: 'A' });
    });

    it('TC-024: xem hồ sơ sức khỏe để lại bản ghi audit đầy đủ', async () => {
      const before = ctx.db.auditLogs.findMany(
        (row) => row.action === 'health_profile.viewed',
      ).length;

      await request(app.getHttpServer())
        .get('/v1/me/emergency-profile')
        .set('Authorization', bearer(tokens.citizen))
        .expect(200);

      const entries = ctx.db.auditLogs.findMany((row) => row.action === 'health_profile.viewed');
      expect(entries.length).toBe(before + 1);

      const latest = entries[entries.length - 1];
      expect(latest.actor_user_id).toBe(SEED_IDS.citizen);
      expect(latest.result).toBe('SUCCESS');
      expect(latest.created_at).toBeInstanceOf(Date);
    });

    it('số điện thoại luôn trả về dạng che, kể cả cho chính chủ (Rule 11)', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/me')
        .set('Authorization', bearer(tokens.citizen))
        .expect(200);

      expect(response.body.data.phoneMasked).toMatch(/^\*\*\*\d{3}$/);
      expect(JSON.stringify(response.body)).not.toContain('+84900000001');
    });

    it('TC-013: không điều phối được người hỗ trợ chưa xác thực', async () => {
      const created = await createCase();
      await request(app.getHttpServer())
        .post(`/v1/operator/cases/${created.id}/accept`)
        .set('Authorization', bearer(tokens.operator))
        .expect(200);

      // Hạ trạng thái xác thực của responder mô phỏng.
      ctx.db.responders.update(SEED_IDS.responderProfile, { certification_status: 'PENDING' });

      const response = await request(app.getHttpServer())
        .post(`/v1/emergency-cases/${created.id}/dispatch`)
        .set('Authorization', bearer(tokens.operator))
        .send({ targetType: 'local_responder', targetId: SEED_IDS.responderProfile })
        .expect(404);

      expect(response.body.error.code).toBe(ApiErrorCode.NOT_FOUND);

      ctx.db.responders.update(SEED_IDS.responderProfile, { certification_status: 'VERIFIED' });
    });

    it('audit trail chỉ dành cho ADMIN/AUDITOR', async () => {
      await request(app.getHttpServer())
        .get('/v1/audit-logs')
        .set('Authorization', bearer(tokens.operator))
        .expect(403);

      await request(app.getHttpServer())
        .get('/v1/audit-logs')
        .set('Authorization', bearer(tokens.admin))
        .expect(200);
    });
  });

  // -------------------------------------------------------------------------
  // TC-026 / TC-033: xác thực
  // -------------------------------------------------------------------------

  describe('Xác thực', () => {
    it('yêu cầu OTP luôn trả 202, không tiết lộ số nào đã đăng ký', async () => {
      const known = await request(app.getHttpServer())
        .post('/v1/auth/otp/request')
        .send({ phone: '+84900000002' })
        .expect(202);

      const unknown = await request(app.getHttpServer())
        .post('/v1/auth/otp/request')
        .send({ phone: '+84988888888' })
        .expect(202);

      expect(known.body.data).toEqual(unknown.body.data);
    });

    it('chỉ trả và chấp nhận OTP tự điền cho đúng số diễn tập', async () => {
      const requested = await request(app.getHttpServer())
        .post('/v1/auth/otp/request')
        .send({ phone: '+84900000001' })
        .expect(202);

      expect(requested.body.data).toMatchObject({
        accepted: true,
        delivery: 'in_app_demo',
      });
      expect(requested.body.data.demoOtp).toMatch(/^\d{6}$/);

      const verified = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ phone: '+84900000001', otp: requested.body.data.demoOtp })
        .expect(200);

      expect(verified.body.data.user.roles).toContain(UserRole.CITIZEN);
    });

    it('TC-026: vượt ngưỡng yêu cầu OTP thì bị chặn', async () => {
      const phone = '+84911111111';
      const limit = Number(process.env.RATE_LIMIT_OTP_PER_HOUR);

      for (let i = 0; i < limit; i += 1) {
        await request(app.getHttpServer())
          .post('/v1/auth/otp/request')
          .send({ phone })
          .expect(202);
      }

      const blocked = await request(app.getHttpServer())
        .post('/v1/auth/otp/request')
        .send({ phone })
        .expect(429);

      expect(blocked.body.error.code).toBe(ApiErrorCode.RATE_LIMITED);
    });

    it('OTP sai bị từ chối mà không nói rõ lý do', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/otp/request')
        .send({ phone: '+84922222222' })
        .expect(202);

      const response = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ phone: '+84922222222', otp: '000000' })
        .expect(401);

      expect(response.body.error.code).toBe(ApiErrorCode.UNAUTHENTICATED);
    });

    it('TC-033: token không hợp lệ bị từ chối 401', async () => {
      await request(app.getHttpServer())
        .get('/v1/me')
        .set('Authorization', bearer('khong-phai-jwt'))
        .expect(401);
    });

    it('đăng nhập dev bị chặn khi AUTH_DEV_OPERATOR_LOGIN không bật', async () => {
      // Môi trường test không bật cờ này, nên cửa dev phải đóng.
      const response = await request(app.getHttpServer())
        .post('/v1/auth/dev/login')
        .send({ role: UserRole.OPERATOR_115 })
        .expect(403);

      expect(response.body.error.code).toBe(ApiErrorCode.FORBIDDEN);
      expect(response.body.error.message).toContain('OIDC/MFA');
    });

    it('SOS-004: tài khoản nghiệp vụ không đăng nhập được bằng OTP người dân', async () => {
      const service = ctx.app.get(
        (await import('../src/modules/auth/service/otp.service')).OtpService,
      );
      const phone = '+84900000002';
      const otp = await service.issue(phone);

      const response = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ phone, otp })
        .expect(403);

      expect(response.body.error.message).toContain('cổng xác thực riêng');
    });
  });

  // -------------------------------------------------------------------------
  // TC-016 / TC-023: chính sách và khả năng phục hồi
  // -------------------------------------------------------------------------

  describe('Chính sách và outbox', () => {
    it('TC-016: không sinh media asset khi RECORDING_ENABLED=false', async () => {
      const created = await createCase();
      await request(app.getHttpServer())
        .post(`/v1/operator/cases/${created.id}/accept`)
        .set('Authorization', bearer(tokens.operator))
        .expect(200);

      await request(app.getHttpServer())
        .post(`/v1/emergency-cases/${created.id}/video/session`)
        .set('Authorization', bearer(tokens.citizen))
        .send({})
        .expect(200);

      const session = ctx.db.videoSessions.findOne((row) => row.case_id === created.id);
      expect(session?.recording_enabled).toBe(false);
    });

    it('TC-023: tạo ca luôn sinh domain event trong outbox cùng transaction', async () => {
      const created = await createCase();

      const events = ctx.db.outboxEvents.findMany(
        (row) => row.aggregate_id === created.id && row.event_type === 'case.created',
      );
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({ caseId: created.id, code: created.code });
      // Payload tối thiểu: không được chứa dữ liệu nhạy cảm (Rule 11).
      expect(Object.keys(events[0].payload).sort()).toEqual(
        ['callerUserId', 'caseId', 'code', 'serviceAreaId', 'triggerSource'].sort(),
      );
    });

    it('health check khai báo trung thực rằng đang chạy driver không bền vững', async () => {
      const response = await request(app.getHttpServer()).get('/v1/health').expect(200);

      expect(response.body.data.degraded.persistence).toBe(true);
      expect(response.body.data.policy.recordingEnabled).toBe(false);
      expect(response.body.data.policy.emsIntegrationMode).toBe('mock');
    });
  });
});
