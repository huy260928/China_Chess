import { ClockState, Side } from '@xiangqi/shared';
export declare const MAX_LAG_COMPENSATION_MS = 300;
export type TimeoutCallback = (roomId: string, timedOutSide: Side, finalClock: ClockState) => void;
export type ClockBroadcastCallback = (roomId: string, clock: ClockState) => void;
export declare class ServerClockManager {
    private roomClocks;
    private roomIntervals;
    private tickCounters;
    private onTimeout;
    private onClockBroadcast;
    constructor(onTimeout: TimeoutCallback, onClockBroadcast: ClockBroadcastCallback);
    /**
     * Initializes a new authoritative clock for a room.
     */
    initClock(params: {
        roomId: string;
        totalTimeMs: number;
        turnTimeMs: number;
        redTimeLeftMs?: number;
        blackTimeLeftMs?: number;
        activeSide: Side | null;
        isPaused: boolean;
    }): ClockState;
    getClock(roomId: string): ClockState | null;
    /**
     * Applies elapsed time up to `Date.now()` minus optional Lag Compensation (clamped to <= 300ms).
     */
    private syncElapsedNow;
    /**
     * Called when a player submits a move intent.
     * Deducts elapsed time with RTT Lag Compensation (max 300ms), verifies the player
     * has not timed out, and switches the clock to the next player's turn.
     */
    recordMoveAndSwitchTurn(roomId: string, movingSide: Side, nextSide: Side, clientSentTimestamp?: number): {
        timedOut: boolean;
        clock: ClockState;
    };
    /**
     * Pauses the clock (e.g., when a game is Adjourned or finished).
     */
    pauseClock(roomId: string): ClockState | null;
    /**
     * Resumes a paused clock.
     */
    resumeClock(roomId: string, activeSide?: Side): ClockState | null;
    removeClock(roomId: string): void;
    private startInterval;
    private stopInterval;
}
//# sourceMappingURL=clock-manager.d.ts.map