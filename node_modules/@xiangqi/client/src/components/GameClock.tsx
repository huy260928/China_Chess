// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - SERVER-SYNCHRONIZED PLAYER CLOCK & STATUS BAR
// Displays Total Time + Turn Time with smooth client interpolation and
// 60-Second Reconnection Grace Period Countdown on network drop / F5.
// ============================================================================

import React, { useEffect, useState } from 'react';
import { Clock, Wifi, WifiOff, ShieldAlert, Bot } from 'lucide-react';
import { RoomPlayerState, Side } from '@xiangqi/shared';
import { useGameStore } from '../store/useGameStore';

function formatTimeMs(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`;
}

export const GameClock: React.FC = () => {
  const { roomState, isFlipped } = useGameStore();
  const [nowTick, setNowTick] = useState<number>(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setNowTick(Date.now());
    }, 100);
    return () => clearInterval(interval);
  }, []);

  if (!roomState) return null;

  const { clock, redPlayer, blackPlayer, status } = roomState;

  const elapsedSinceSync =
    !clock.isPaused && status === 'PLAYING' && clock.activeSide !== null
      ? Math.max(0, nowTick - clock.lastTickServerTimestamp)
      : 0;

  const redTotalMs =
    clock.activeSide === 'w'
      ? Math.max(0, clock.redTimeLeftMs - elapsedSinceSync)
      : clock.redTimeLeftMs;

  const blackTotalMs =
    clock.activeSide === 'b'
      ? Math.max(0, clock.blackTimeLeftMs - elapsedSinceSync)
      : clock.blackTimeLeftMs;

  const currentTurnMs = Math.max(0, clock.currentTurnLeftMs - elapsedSinceSync);

  const renderPlayerCard = (
    player: RoomPlayerState | null,
    side: Side,
    totalLeftMs: number
  ) => {
    const isTurn = status === 'PLAYING' && clock.activeSide === side;
    const isRed = side === 'w';
    const turnSecondsLeft = isTurn ? Math.ceil(currentTurnMs / 1000) : Math.ceil(clock.turnTimeMs / 1000);
    const isLowTurnTime = isTurn && turnSecondsLeft <= 10;

    const reconnectSecondsLeft =
      player && !player.isConnected && player.reconnectDeadlineTimestamp
        ? Math.max(
            0,
            Math.ceil((player.reconnectDeadlineTimestamp - nowTick) / 1000)
          )
        : null;

    return (
      <div
        className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
          isTurn
            ? isRed
              ? 'bg-red-950/50 border-red-500/80 shadow-lg shadow-red-950/30'
              : 'bg-amber-950/40 border-amber-500/80 shadow-lg shadow-amber-950/30'
            : 'bg-stone-900/90 border-stone-800'
        }`}
      >
        {/* Player Identity & Connection Status */}
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center font-extrabold text-sm border-2 ${
              isRed
                ? 'bg-red-900/80 border-red-400 text-red-100'
                : 'bg-stone-800 border-stone-400 text-stone-100'
            }`}
          >
            {player?.isAi ? (
              <Bot className="w-5 h-5 text-amber-400" />
            ) : isRed ? (
              '帥'
            ) : (
              '將'
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-stone-100">
                {player ? player.username : 'Đang chờ kỳ thủ...'}
              </span>
              {player && (
                <span className="text-xs px-2 py-0.5 rounded bg-stone-800 text-amber-400 font-semibold border border-stone-700">
                  ELO {player.eloRating}
                </span>
              )}
              {player && !player.isAi && (
                <span
                  title={player.isConnected ? 'Trực tuyến' : 'Mất kết nối'}
                  className="inline-flex items-center"
                >
                  {player.isConnected ? (
                    <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <WifiOff className="w-3.5 h-3.5 text-red-400 animate-pulse" />
                  )}
                </span>
              )}
            </div>

            {/* 60-Second Graceful Reconnection Countdown */}
            {reconnectSecondsLeft !== null ? (
              <div className="flex items-center gap-1 text-xs text-amber-400 font-semibold mt-0.5">
                <ShieldAlert className="w-3.5 h-3.5" />
                Chờ kết nối lại: {reconnectSecondsLeft}s
              </div>
            ) : (
              <div className="text-xs text-stone-400 mt-0.5">
                {isRed ? 'Quân Đỏ (Đi Tiên)' : 'Quân Đen (Đi Hậu)'}
                {isTurn && ' • Đang suy nghĩ...'}
              </div>
            )}
          </div>
        </div>

        {/* Authoritative Total Clock & Per-Move Clock */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-stone-400">
              Nước đi
            </div>
            <div
              className={`font-mono font-bold text-sm ${
                isLowTurnTime
                  ? 'text-red-400 animate-bounce'
                  : isTurn
                    ? 'text-amber-300'
                    : 'text-stone-500'
              }`}
            >
              {turnSecondsLeft}s
            </div>
          </div>

          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-lg font-extrabold border ${
              isTurn
                ? 'bg-stone-950 text-white border-amber-500/60'
                : 'bg-stone-950/60 text-stone-400 border-stone-800'
            }`}
          >
            <Clock className="w-4 h-4 text-amber-400" />
            {formatTimeMs(totalLeftMs)}
          </div>
        </div>
      </div>
    );
  };

  // Top card corresponds to whichever side is rendered at the top of the board
  const topSide: Side = isFlipped ? 'w' : 'b';
  const bottomSide: Side = isFlipped ? 'b' : 'w';

  return (
    <div className="w-full grid grid-cols-1 xl:grid-cols-2 gap-2.5">
      {renderPlayerCard(
        topSide === 'w' ? redPlayer : blackPlayer,
        topSide,
        topSide === 'w' ? redTotalMs : blackTotalMs
      )}
      {renderPlayerCard(
        bottomSide === 'w' ? redPlayer : blackPlayer,
        bottomSide,
        bottomSide === 'w' ? redTotalMs : blackTotalMs
      )}
    </div>
  );
};
