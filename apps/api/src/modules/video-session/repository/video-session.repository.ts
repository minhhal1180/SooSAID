import { randomUUID } from 'node:crypto';
import type { MemoryDb } from '../../../persistence/memory/memory-db';
import type { PgExecutor } from '../../../persistence/postgres/pg-executor';
import type { VideoSessionRow } from '../../../persistence/rows';
import type { TxContext } from '../../../persistence/unit-of-work';

/** Trạng thái phiên video (không phải trạng thái ca – hai thứ khác nhau). */
export const VideoSessionStatus = {
  CREATED: 'CREATED',
  ACTIVE: 'ACTIVE',
  ENDED: 'ENDED',
  FAILED: 'FAILED',
} as const;
export type VideoSessionStatus = (typeof VideoSessionStatus)[keyof typeof VideoSessionStatus];

export interface CreateVideoSessionInput {
  readonly caseId: string;
  readonly provider: string;
  readonly providerRoomId: string;
  readonly recordingEnabled: boolean;
  readonly createdBy: string | null;
}

export interface VideoSessionRepositoryPort {
  /** Phiên đang hoạt động của ca; mỗi ca chỉ có tối đa một phòng (ADR-006). */
  findActiveByCase(caseId: string): Promise<VideoSessionRow | null>;
  create(tx: TxContext, input: CreateVideoSessionInput): Promise<VideoSessionRow>;
  markStarted(tx: TxContext, sessionId: string, actorUserId: string | null): Promise<void>;
  markEnded(tx: TxContext, sessionId: string, actorUserId: string | null): Promise<void>;
}

export const VIDEO_SESSION_REPOSITORY = Symbol('VIDEO_SESSION_REPOSITORY');

const ACTIVE_STATUSES = [VideoSessionStatus.CREATED, VideoSessionStatus.ACTIVE];

export class PgVideoSessionRepository implements VideoSessionRepositoryPort {
  constructor(private readonly executor: PgExecutor) {}

  async findActiveByCase(caseId: string): Promise<VideoSessionRow | null> {
    return this.executor.queryOne<VideoSessionRow>(
      undefined,
      `SELECT * FROM video_sessions
        WHERE case_id = $1 AND status = ANY($2)
        ORDER BY created_at DESC
        LIMIT 1`,
      [caseId, ACTIVE_STATUSES],
    );
  }

  async create(tx: TxContext, input: CreateVideoSessionInput): Promise<VideoSessionRow> {
    const rows = await this.executor.query<VideoSessionRow>(
      tx,
      `INSERT INTO video_sessions
         (case_id, provider, provider_room_id, status, recording_enabled, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING *`,
      [
        input.caseId,
        input.provider,
        input.providerRoomId,
        VideoSessionStatus.CREATED,
        input.recordingEnabled,
        input.createdBy,
      ],
    );
    return rows[0];
  }

  async markStarted(tx: TxContext, sessionId: string, actorUserId: string | null): Promise<void> {
    // `started_at` chỉ ghi lần đầu: đây là mốc "video bắt đầu" trong KPI, người
    // thứ hai tham gia không được làm lệch mốc đó (FR-015).
    await this.executor.query(
      tx,
      `UPDATE video_sessions
          SET status = $2, started_at = COALESCE(started_at, now()), updated_by = $3
        WHERE id = $1`,
      [sessionId, VideoSessionStatus.ACTIVE, actorUserId],
    );
  }

  async markEnded(tx: TxContext, sessionId: string, actorUserId: string | null): Promise<void> {
    await this.executor.query(
      tx,
      `UPDATE video_sessions
          SET status = $2, ended_at = now(), updated_by = $3
        WHERE id = $1`,
      [sessionId, VideoSessionStatus.ENDED, actorUserId],
    );
  }
}

export class MemoryVideoSessionRepository implements VideoSessionRepositoryPort {
  constructor(private readonly db: MemoryDb) {}

  async findActiveByCase(caseId: string): Promise<VideoSessionRow | null> {
    return (
      this.db.videoSessions
        .findMany(
          (row) =>
            row.case_id === caseId &&
            (ACTIVE_STATUSES as readonly string[]).includes(row.status),
        )
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0] ?? null
    );
  }

  async create(_tx: TxContext, input: CreateVideoSessionInput): Promise<VideoSessionRow> {
    const now = new Date();
    return this.db.videoSessions.insert({
      id: randomUUID(),
      case_id: input.caseId,
      provider: input.provider,
      provider_room_id: input.providerRoomId,
      status: VideoSessionStatus.CREATED,
      recording_enabled: input.recordingEnabled,
      started_at: null,
      ended_at: null,
      metadata: {},
      created_at: now,
      updated_at: now,
      created_by: input.createdBy,
      updated_by: input.createdBy,
    } satisfies VideoSessionRow);
  }

  async markStarted(_tx: TxContext, sessionId: string, actorUserId: string | null): Promise<void> {
    const row = this.db.videoSessions.findById(sessionId);
    if (!row) return;
    this.db.videoSessions.update(sessionId, {
      status: VideoSessionStatus.ACTIVE,
      started_at: row.started_at ?? new Date(),
      updated_by: actorUserId,
    });
  }

  async markEnded(_tx: TxContext, sessionId: string, actorUserId: string | null): Promise<void> {
    this.db.videoSessions.update(sessionId, {
      status: VideoSessionStatus.ENDED,
      ended_at: new Date(),
      updated_by: actorUserId,
    });
  }
}
