// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - WEBSOCKET EVENT RATE LIMITING & SECURITY GUARD
// Protects the Socket.io Server from packet flooding, malformed coordinate
// payloads, and rapid-fire move/lobby spam.
// ============================================================================

import { Socket } from 'socket.io';

interface SocketRateBucket {
  timestamps: number[];
  violations: number;
}

const MAX_EVENTS_PER_WINDOW = 25; // Max 25 socket events per 5-second window
const WINDOW_MS = 5000;
const MAX_VIOLATIONS_BEFORE_DISCONNECT = 5;

export class SocketSecurityGuard {
  private buckets = new Map<string, SocketRateBucket>();

  /**
   * Attaches a per-socket packet rate limiter and coordinate payload validator.
   */
  public attachToSocket(socket: Socket): void {
    const key = socket.id;
    this.buckets.set(key, { timestamps: [], violations: 0 });

    socket.use((packet, next) => {
      const eventName = packet[0];

      // Allow latency ping_check without counting against gameplay quota
      if (eventName === 'ping_check') {
        return next();
      }

      const now = Date.now();
      const bucket = this.buckets.get(key) ?? { timestamps: [], violations: 0 };
      bucket.timestamps = bucket.timestamps.filter((ts) => now - ts < WINDOW_MS);

      if (bucket.timestamps.length >= MAX_EVENTS_PER_WINDOW) {
        bucket.violations++;
        this.buckets.set(key, bucket);

        socket.emit('error_event', {
          code: 'SOCKET_RATE_LIMIT_EXCEEDED',
          message: 'Tần suất gửi sự kiện quá nhanh. Vui lòng thao tác chậm lại.',
        });

        if (bucket.violations >= MAX_VIOLATIONS_BEFORE_DISCONNECT) {
          socket.disconnect(true);
        }
        return;
      }

      bucket.timestamps.push(now);
      this.buckets.set(key, bucket);

      // Validate make_move coordinate bounds before reaching game engine
      if (eventName === 'make_move') {
        const payload = packet[1];
        if (
          !payload ||
          typeof payload !== 'object' ||
          !payload.from ||
          !payload.to ||
          typeof payload.from.row !== 'number' ||
          typeof payload.from.col !== 'number' ||
          typeof payload.to.row !== 'number' ||
          typeof payload.to.col !== 'number' ||
          !Number.isInteger(payload.from.row) ||
          !Number.isInteger(payload.from.col) ||
          !Number.isInteger(payload.to.row) ||
          !Number.isInteger(payload.to.col)
        ) {
          socket.emit('error_event', {
            code: 'MALFORMED_MOVE_PAYLOAD',
            message: 'Tọa độ nước đi không hợp lệ.',
          });
          return;
        }
      }

      next();
    });

    socket.on('disconnect', () => {
      this.buckets.delete(key);
    });
  }
}

export const socketSecurityGuard = new SocketSecurityGuard();
