// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - SERVER-AUTHORITATIVE CLOCK & LAG COMPENSATION
// Enforces Total Match Clock (e.g. 15m) + Per-Turn Clock (e.g. 60s) using
// Date.now() delta with up to 300ms RTT Lag Compensation per move.
// ============================================================================

import { ClockState, Side } from '@xiangqi/shared';

export const MAX_LAG_COMPENSATION_MS = 300;
const CLOCK_CHECK_INTERVAL_MS = 250;

export type TimeoutCallback = (roomId: string, timedOutSide: Side, finalClock: ClockState) => void;
export type ClockBroadcastCallback = (roomId: string, clock: ClockState) => void;

export class ServerClockManager {
  private roomClocks = new Map<string, ClockState>();
  private roomIntervals = new Map<string, NodeJS.Timeout>();
  private tickCounters = new Map<string, number>();
  private onTimeout: TimeoutCallback;
  private onClockBroadcast: ClockBroadcastCallback;

  constructor(
    onTimeout: TimeoutCallback,
    onClockBroadcast: ClockBroadcastCallback
  ) {
    this.onTimeout = onTimeout;
    this.onClockBroadcast = onClockBroadcast;
  }

  /**
   * Initializes a new authoritative clock for a room.
   */
  public initClock(params: {
    roomId: string;
    totalTimeMs: number;
    turnTimeMs: number;
    redTimeLeftMs?: number;
    blackTimeLeftMs?: number;
    activeSide: Side | null;
    isPaused: boolean;
  }): ClockState {
    const redLeft = params.redTimeLeftMs ?? params.totalTimeMs;
    const blackLeft = params.blackTimeLeftMs ?? params.totalTimeMs;
    const activeTotalLeft = params.activeSide === 'b' ? blackLeft : redLeft;

    const clock: ClockState = {
      totalTimeMs: params.totalTimeMs,
      turnTimeMs: params.turnTimeMs,
      redTimeLeftMs: redLeft,
      blackTimeLeftMs: blackLeft,
      currentTurnLeftMs: Math.min(params.turnTimeMs, activeTotalLeft),
      activeSide: params.activeSide,
      lastTickServerTimestamp: Date.now(),
      isPaused: params.isPaused,
    };

    this.roomClocks.set(params.roomId, clock);
    this.tickCounters.set(params.roomId, 0);

    if (!params.isPaused && params.activeSide !== null) {
      this.startInterval(params.roomId);
    } else {
      this.stopInterval(params.roomId);
    }

    return { ...clock };
  }

  public getClock(roomId: string): ClockState | null {
    const clock = this.roomClocks.get(roomId);
    if (!clock) return null;
    this.syncElapsedNow(clock, 0);
    return { ...clock };
  }

  /**
   * Applies elapsed time up to `Date.now()` minus optional Lag Compensation (clamped to <= 300ms).
   */
  private syncElapsedNow(clock: ClockState, lagCompensationMs: number): void {
    const now = Date.now();
    if (clock.isPaused || clock.activeSide === null) {
      clock.lastTickServerTimestamp = now;
      return;
    }

    const rawDelta = Math.max(0, now - clock.lastTickServerTimestamp);
    const clampedLag = Math.min(MAX_LAG_COMPENSATION_MS, Math.max(0, lagCompensationMs));
    const effectiveDelta = Math.max(0, rawDelta - clampedLag);

    if (clock.activeSide === 'w') {
      clock.redTimeLeftMs = Math.max(0, clock.redTimeLeftMs - effectiveDelta);
    } else {
      clock.blackTimeLeftMs = Math.max(0, clock.blackTimeLeftMs - effectiveDelta);
    }

    clock.currentTurnLeftMs = Math.max(0, clock.currentTurnLeftMs - effectiveDelta);
    clock.lastTickServerTimestamp = now;
  }

  /**
   * Called when a player submits a move intent.
   * Deducts elapsed time with RTT Lag Compensation (max 300ms), verifies the player
   * has not timed out, and switches the clock to the next player's turn.
   */
  public recordMoveAndSwitchTurn(
    roomId: string,
    movingSide: Side,
    nextSide: Side,
    clientSentTimestamp?: number
  ): { timedOut: boolean; clock: ClockState } {
    const clock = this.roomClocks.get(roomId);
    if (!clock) {
      throw new Error(`Clock not found for room ${roomId}`);
    }

    const now = Date.now();
    let lagCompMs = 0;
    if (
      typeof clientSentTimestamp === 'number' &&
      clientSentTimestamp > 0 &&
      clientSentTimestamp <= now
    ) {
      lagCompMs = Math.min(MAX_LAG_COMPENSATION_MS, now - clientSentTimestamp);
    }

    this.syncElapsedNow(clock, lagCompMs);

    const activeTotalLeft =
      movingSide === 'w' ? clock.redTimeLeftMs : clock.blackTimeLeftMs;

    if (activeTotalLeft <= 0 || clock.currentTurnLeftMs <= 0) {
      clock.isPaused = true;
      this.stopInterval(roomId);
      return { timedOut: true, clock: { ...clock } };
    }

    // Switch turn and reset per-move clock
    clock.activeSide = nextSide;
    const nextSideTotalLeft =
      nextSide === 'w' ? clock.redTimeLeftMs : clock.blackTimeLeftMs;
    clock.currentTurnLeftMs = Math.min(clock.turnTimeMs, nextSideTotalLeft);
    clock.lastTickServerTimestamp = Date.now();

    return { timedOut: false, clock: { ...clock } };
  }

  /**
   * Pauses the clock (e.g., when a game is Adjourned or finished).
   */
  public pauseClock(roomId: string): ClockState | null {
    const clock = this.roomClocks.get(roomId);
    if (!clock) return null;

    this.syncElapsedNow(clock, 0);
    clock.isPaused = true;
    this.stopInterval(roomId);
    return { ...clock };
  }

  /**
   * Resumes a paused clock.
   */
  public resumeClock(roomId: string, activeSide?: Side): ClockState | null {
    const clock = this.roomClocks.get(roomId);
    if (!clock) return null;

    if (activeSide) {
      clock.activeSide = activeSide;
    }
    clock.isPaused = false;
    clock.lastTickServerTimestamp = Date.now();
    this.startInterval(roomId);
    return { ...clock };
  }

  public removeClock(roomId: string): void {
    this.stopInterval(roomId);
    this.roomClocks.delete(roomId);
    this.tickCounters.delete(roomId);
  }

  private startInterval(roomId: string): void {
    this.stopInterval(roomId);

    const handle = setInterval(() => {
      const clock = this.roomClocks.get(roomId);
      if (!clock || clock.isPaused || clock.activeSide === null) {
        return;
      }

      this.syncElapsedNow(clock, 0);

      const activeTotalLeft =
        clock.activeSide === 'w' ? clock.redTimeLeftMs : clock.blackTimeLeftMs;

      if (activeTotalLeft <= 0 || clock.currentTurnLeftMs <= 0) {
        const timedOutSide = clock.activeSide;
        clock.isPaused = true;
        this.stopInterval(roomId);
        this.onTimeout(roomId, timedOutSide, { ...clock });
        return;
      }

      const count = (this.tickCounters.get(roomId) ?? 0) + 1;
      this.tickCounters.set(roomId, count);

      // Broadcast authoritative clock sync every 4 ticks (1000ms)
      if (count % 4 === 0) {
        this.onClockBroadcast(roomId, { ...clock });
      }
    }, CLOCK_CHECK_INTERVAL_MS);

    this.roomIntervals.set(roomId, handle);
  }

  private stopInterval(roomId: string): void {
    const existing = this.roomIntervals.get(roomId);
    if (existing) {
      clearInterval(existing);
      this.roomIntervals.delete(roomId);
    }
  }
}
