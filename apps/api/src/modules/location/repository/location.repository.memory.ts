import { randomUUID } from 'node:crypto';
import type { MemoryDb } from '../../../persistence/memory/memory-db';
import type { CaseLocationRow } from '../../../persistence/rows';
import type { TxContext } from '../../../persistence/unit-of-work';
import type { AppendLocationInput, LocationRepositoryPort } from './location.repository.port';

export class MemoryLocationRepository implements LocationRepositoryPort {
  constructor(private readonly db: MemoryDb) {}

  async append(_tx: TxContext, input: AppendLocationInput): Promise<CaseLocationRow> {
    const now = new Date();
    return this.db.caseLocations.insert({
      id: randomUUID(),
      case_id: input.caseId,
      location: input.location,
      accuracy_meters: input.accuracyMeters,
      altitude_meters: input.altitudeMeters,
      address_text: input.addressText,
      access_note: input.accessNote,
      source: input.source,
      captured_at: input.capturedAt,
      received_at: now,
      created_at: now,
      updated_at: now,
      created_by: input.createdBy,
      updated_by: null,
    } satisfies CaseLocationRow);
  }

  async listByCase(caseId: string, limit: number): Promise<CaseLocationRow[]> {
    return this.db.caseLocations
      .findMany((row) => row.case_id === caseId)
      .sort((a, b) => b.captured_at.getTime() - a.captured_at.getTime())
      .slice(0, limit);
  }

  async latestByCase(caseId: string): Promise<CaseLocationRow | null> {
    return (await this.listByCase(caseId, 1))[0] ?? null;
  }
}
