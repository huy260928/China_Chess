// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - MOVE NOTATION & STEP-BY-STEP REPLAY PANEL
// Displays Vietnamese Traditional Notation ("Pháo 2 bình 5") + WXF ("C2.5")
// and provides full step-by-step interactive Replay controls.
// ============================================================================

import React, { useEffect, useRef } from 'react';
import {
  SkipBack,
  ChevronLeft,
  ChevronRight,
  SkipForward,
  Radio,
  ScrollText,
} from 'lucide-react';
import { ExecutedMove } from '@xiangqi/shared';
import { useGameStore } from '../store/useGameStore';

export const MoveHistoryReplay: React.FC = () => {
  const { roomState, replayStepIndex, setReplayStep } = useGameStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const moves: ExecutedMove[] = roomState?.moveHistory ?? [];
  const totalMoves = moves.length;

  // Group moves into pairs (Red move + Black move per full turn)
  const movePairs: Array<{
    turnNumber: number;
    redMove?: ExecutedMove;
    redIdx?: number;
    blackMove?: ExecutedMove;
    blackIdx?: number;
  }> = [];

  for (let i = 0; i < totalMoves; i += 2) {
    movePairs.push({
      turnNumber: Math.floor(i / 2) + 1,
      redMove: moves[i],
      redIdx: i,
      blackMove: moves[i + 1],
      blackIdx: i + 1 < totalMoves ? i + 1 : undefined,
    });
  }

  useEffect(() => {
    if (replayStepIndex === null && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop =
        scrollContainerRef.current.scrollHeight;
    }
  }, [totalMoves, replayStepIndex]);

  if (!roomState) return null;

  const activeIdx = replayStepIndex === null ? totalMoves - 1 : replayStepIndex;

  const handleStepStart = () => setReplayStep(-1);
  const handleStepPrev = () => {
    if (totalMoves === 0) return;
    const next = Math.max(-1, activeIdx - 1);
    setReplayStep(next);
  };
  const handleStepNext = () => {
    if (totalMoves === 0) return;
    if (activeIdx + 1 >= totalMoves - 1) {
      setReplayStep(null);
    } else {
      setReplayStep(activeIdx + 1);
    }
  };
  const handleStepLive = () => setReplayStep(null);

  return (
    <div className="flex flex-col bg-stone-900/95 border border-stone-800 rounded-xl overflow-hidden shadow-lg flex-1 min-h-[170px] max-h-[240px]">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-stone-950 border-b border-stone-800">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400">
          <ScrollText className="w-4 h-4" />
          Biên Bản Cờ Tướng ({totalMoves} nước)
        </div>

        {replayStepIndex !== null && (
          <button
            type="button"
            onClick={handleStepLive}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold transition"
          >
            <Radio className="w-3 h-3 animate-pulse" />
            Trực Tiếp
          </button>
        )}
      </div>

      {/* Scrollable Move Table */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-2 py-1.5 space-y-1 text-xs"
      >
        {movePairs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-stone-500 italic">
            Chưa có nước đi nào được thực hiện.
          </div>
        ) : (
          movePairs.map((pair) => (
            <div
              key={pair.turnNumber}
              className="grid grid-cols-12 items-center py-1 px-2 rounded hover:bg-stone-800/60 transition"
            >
              <span className="col-span-2 font-mono text-stone-500 font-semibold">
                {pair.turnNumber}.
              </span>

              {/* Red Move */}
              <button
                type="button"
                onClick={() =>
                  pair.redIdx !== undefined && setReplayStep(pair.redIdx)
                }
                className={`col-span-5 text-left px-2 py-1 rounded font-medium transition ${
                  activeIdx === pair.redIdx
                    ? 'bg-red-900/60 text-red-200 border border-red-600/50 font-bold'
                    : 'text-red-300 hover:bg-stone-800'
                }`}
              >
                {pair.redMove && (
                  <div className="flex items-center justify-between">
                    <span>{pair.redMove.vietnameseNotation}</span>
                    <span className="font-mono text-[10px] text-stone-400">
                      {pair.redMove.wxf}
                    </span>
                  </div>
                )}
              </button>

              {/* Black Move */}
              <button
                type="button"
                disabled={!pair.blackMove}
                onClick={() =>
                  pair.blackIdx !== undefined && setReplayStep(pair.blackIdx)
                }
                className={`col-span-5 text-left px-2 py-1 rounded font-medium transition ${
                  !pair.blackMove
                    ? 'cursor-default'
                    : activeIdx === pair.blackIdx
                      ? 'bg-stone-700 text-stone-100 border border-stone-500 font-bold'
                      : 'text-stone-300 hover:bg-stone-800'
                }`}
              >
                {pair.blackMove && (
                  <div className="flex items-center justify-between">
                    <span>{pair.blackMove.vietnameseNotation}</span>
                    <span className="font-mono text-[10px] text-stone-400">
                      {pair.blackMove.wxf}
                    </span>
                  </div>
                )}
              </button>
            </div>
          ))
        )}
      </div>

      {/* Replay Step Transport Controls */}
      <div className="flex items-center justify-between px-3 py-2 bg-stone-950 border-t border-stone-800">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleStepStart}
            disabled={totalMoves === 0}
            className="p-1.5 rounded bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-200 transition"
            title="Về thế cờ ban đầu"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleStepPrev}
            disabled={totalMoves === 0 || activeIdx < 0}
            className="p-1.5 rounded bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-200 transition"
            title="Lùi 1 nước"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleStepNext}
            disabled={totalMoves === 0 || replayStepIndex === null}
            className="p-1.5 rounded bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-200 transition"
            title="Tiến 1 nước"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleStepLive}
            disabled={replayStepIndex === null}
            className="p-1.5 rounded bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-200 transition"
            title="Về nước đi hiện tại"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>
        </div>

        <span className="text-[11px] text-stone-400 font-mono">
          {replayStepIndex === null
            ? 'Đang xem: Trực tiếp'
            : replayStepIndex < 0
              ? 'Đang xem: Khởi cuộc'
              : `Đang xem: Nước #${replayStepIndex + 1}/${totalMoves}`}
        </span>
      </div>
    </div>
  );
};
