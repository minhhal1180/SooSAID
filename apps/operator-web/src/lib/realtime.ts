'use client';

import { io, type Socket } from 'socket.io-client';
import type { RealtimeEventEnvelope } from '@/contracts/generated/api-contract';

/**
 * Kết nối realtime tới backend (SOS-016).
 *
 * TDD §10.3 – nguyên tắc bắt buộc: client KHÔNG dựng state chỉ từ event push.
 * Mỗi lần reconnect, hoặc khi phát hiện `sequence` nhảy cóc, phải fetch lại
 * snapshot qua REST (TC-010). `onResync` bên dưới chính là chỗ gọi việc đó.
 */

const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL ?? 'http://localhost:3000';

export interface RealtimeHandlers {
  onQueueEvent?: (event: RealtimeEventEnvelope) => void;
  onCaseEvent?: (event: RealtimeEventEnvelope) => void;
  /** Gọi khi kết nối lại hoặc phát hiện mất event – UI phải tải lại snapshot. */
  onResync?: (reason: 'connected' | 'reconnected' | 'sequence_gap') => void;
  onConnectionChange?: (connected: boolean) => void;
}

export interface RealtimeConnection {
  subscribeToCase(caseId: string): void;
  unsubscribeFromCase(caseId: string): void;
  disconnect(): void;
}

export function connectRealtime(token: string, handlers: RealtimeHandlers): RealtimeConnection {
  const socket: Socket = io(`${REALTIME_URL}/realtime`, {
    // Token đi trong handshake `auth`, KHÔNG trong query string: query string bị
    // ghi vào access log của proxy/CDN.
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });

  let hasConnectedOnce = false;
  const lastSequenceByCase = new Map<string, number>();

  socket.on('connect', () => {
    handlers.onConnectionChange?.(true);
    handlers.onResync?.(hasConnectedOnce ? 'reconnected' : 'connected');
    hasConnectedOnce = true;
  });

  socket.on('disconnect', () => {
    handlers.onConnectionChange?.(false);
  });

  socket.on('queue:event', (event: RealtimeEventEnvelope) => {
    handlers.onQueueEvent?.(event);
  });

  socket.on('case:event', (event: RealtimeEventEnvelope) => {
    if (event.caseId && detectSequenceGap(lastSequenceByCase, event)) {
      handlers.onResync?.('sequence_gap');
    }
    handlers.onCaseEvent?.(event);
  });

  return {
    subscribeToCase(caseId: string) {
      lastSequenceByCase.delete(caseId);
      socket.emit('case:subscribe', { caseId });
    },
    unsubscribeFromCase(caseId: string) {
      socket.emit('case:unsubscribe', { caseId });
      lastSequenceByCase.delete(caseId);
    },
    disconnect() {
      socket.disconnect();
    },
  };
}

/** Phát hiện mất event: số thứ tự nhảy cách quá 1 so với lần trước. */
function detectSequenceGap(
  lastSequenceByCase: Map<string, number>,
  event: RealtimeEventEnvelope,
): boolean {
  const caseId = event.caseId as string;
  const previous = lastSequenceByCase.get(caseId);
  lastSequenceByCase.set(caseId, event.sequence);

  if (previous === undefined) return false;
  return event.sequence > previous + 1;
}
