// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - HIGH-PRECISION INTERACTIVE SVG XIANGQI BOARD
// Supports:
// - 180-Degree Flip Board Coordinate Transform: (x, y) -> (8 - x, 9 - y)
// - Timestamp-Driven 1.0s (1000ms) Pure SVG User-Space Piece Glide Animation
//   (Immune to clock_sync ticks, React.StrictMode double-effects, and tab throttling)
// - Last Move Origin/Destination Highlights & Motion Trajectory Line
// - Valid Move Suggestion Dots & Capture Target Rings
// - In-Check General Pulsing Alert
// - Live Mode & Historical Step-by-Step Replay Mode
// - Responsive Desktop Single-Screen Fit (50% Left Column Layout)
// ============================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BOARD_COLS,
  BOARD_ROWS,
  Coordinates,
  FenPieceChar,
  Piece,
  XiangqiEngine,
} from '@xiangqi/shared';
import { RotateCw, Languages, Eye } from 'lucide-react';
import { useGameStore } from '../store/useGameStore';

const CELL_SIZE = 64;
const PADDING = 48;
const BOARD_WIDTH = (BOARD_COLS - 1) * CELL_SIZE + PADDING * 2;
const BOARD_HEIGHT = (BOARD_ROWS - 1) * CELL_SIZE + PADDING * 2;
const MOVE_ANIMATION_MS = 1000; // 1.0s (1000ms) smooth piece movement across the board

const HANZI_LABELS: Record<FenPieceChar, string> = {
  K: '帥',
  A: '仕',
  B: '相',
  N: '傌',
  R: '俥',
  C: '炮',
  P: '兵',
  k: '將',
  a: '士',
  b: '象',
  n: '馬',
  r: '車',
  c: '砲',
  p: '卒',
};

const VIET_LABELS: Record<FenPieceChar, string> = {
  K: 'Tướng',
  A: 'Sĩ',
  B: 'Tượng',
  N: 'Mã',
  R: 'Xe',
  C: 'Pháo',
  P: 'Binh',
  k: 'Tướng',
  a: 'Sĩ',
  b: 'Tịnh',
  n: 'Mã',
  r: 'Xe',
  c: 'Pháo',
  p: 'Tốt',
};

const MARKER_COORDS: Coordinates[] = [
  // Cannon positions
  { row: 2, col: 1 },
  { row: 2, col: 7 },
  { row: 7, col: 1 },
  { row: 7, col: 7 },
  // Soldier positions
  { row: 3, col: 0 },
  { row: 3, col: 2 },
  { row: 3, col: 4 },
  { row: 3, col: 6 },
  { row: 3, col: 8 },
  { row: 6, col: 0 },
  { row: 6, col: 2 },
  { row: 6, col: 4 },
  { row: 6, col: 6 },
  { row: 6, col: 8 },
];

interface ActiveGlideState {
  signature: string;
  from: Coordinates;
  to: Coordinates;
  captured: Piece | null;
  progress: number; // 0.0 -> 1.0
}

interface GlideTimingRecord {
  signature: string;
  startTs: number;
  from: Coordinates;
  to: Coordinates;
  captured: Piece | null;
}

export const XiangqiBoard: React.FC = () => {
  const {
    roomState,
    assignedRole,
    isFlipped,
    selectedSquare,
    replayStepIndex,
    toggleFlipBoard,
    selectSquareOrMove,
  } = useGameStore();

  const [useVietnameseChars, setUseVietnameseChars] = useState(false);
  const [activeGlide, setActiveGlide] = useState<ActiveGlideState | null>(null);

  const committedSigRef = useRef<string | null>(null);
  const animTimingRef = useRef<GlideTimingRecord | null>(null);

  // Extract narrow board-only fields so periodic `clock_sync` ticks never
  // invalidate board memoization or interrupt active move animations.
  const roomId = roomState?.roomId ?? null;
  const liveFen = roomState?.fen ?? null;
  const initialFen = roomState?.initialFen ?? null;
  const liveLastMove = roomState?.lastMove ?? null;
  const liveInCheck = roomState?.inCheck ?? false;
  const liveCheckedPos = roomState?.checkedGeneralPos ?? null;
  const moveHistory = roomState?.moveHistory;
  const moveCount = moveHistory?.length ?? 0;

  // Determine active board, lastMove, and primitive stepSignature
  const displayState = useMemo(() => {
    if (!roomId || !liveFen || !initialFen) return null;

    if (replayStepIndex !== null) {
      if (replayStepIndex < 0) {
        const engine = new XiangqiEngine(initialFen);
        return {
          board: engine.getBoard(),
          lastMove: null,
          inCheck: false,
          checkedGeneralPos: null,
          isReplay: true,
          stepSignature: `${roomId}:replay-init`,
        };
      }
      const stepMove = moveHistory?.[replayStepIndex];
      if (stepMove) {
        const engine = new XiangqiEngine(stepMove.fenAfter);
        const inCheck = engine.isInCheck();
        return {
          board: engine.getBoard(),
          lastMove: stepMove,
          inCheck,
          checkedGeneralPos: inCheck ? engine.findGeneral(engine.getTurn()) : null,
          isReplay: true,
          stepSignature: `${roomId}:replay-${replayStepIndex}-${stepMove.from.row},${stepMove.from.col}->${stepMove.to.row},${stepMove.to.col}`,
        };
      }
    }

    const engine = new XiangqiEngine(liveFen);
    return {
      board: engine.getBoard(),
      lastMove: liveLastMove,
      inCheck: liveInCheck,
      checkedGeneralPos: liveCheckedPos,
      isReplay: false,
      stepSignature:
        liveLastMove && moveCount > 0
          ? `${roomId}:live-${moveCount}-${liveLastMove.from.row},${liveLastMove.from.col}->${liveLastMove.to.row},${liveLastMove.to.col}`
          : `${roomId}:live-0`,
    };
  }, [
    roomId,
    liveFen,
    initialFen,
    liveLastMove,
    liveInCheck,
    liveCheckedPos,
    moveHistory,
    moveCount,
    replayStepIndex,
  ]);

  const stepSignature = displayState?.stepSignature ?? null;
  const latestLastMoveRef = useRef(displayState?.lastMove ?? null);
  latestLastMoveRef.current = displayState?.lastMove ?? null;

  // Timestamp-driven 1.0s animation loop keyed strictly on primitive `stepSignature`.
  // Safe under React.StrictMode double-invocation, `clock_sync` updates, and background tabs.
  useEffect(() => {
    if (!stepSignature || !roomId) {
      committedSigRef.current = null;
      animTimingRef.current = null;
      setActiveGlide(null);
      return;
    }

    // First mount into this room: synchronize without replaying historical last move
    if (
      committedSigRef.current === null ||
      !committedSigRef.current.startsWith(`${roomId}:`)
    ) {
      committedSigRef.current = stepSignature;
      animTimingRef.current = null;
      setActiveGlide(null);
      return;
    }

    // New move or replay step occurred in the current room
    if (committedSigRef.current !== stepSignature) {
      committedSigRef.current = stepSignature;
      const lm = latestLastMoveRef.current;
      if (lm) {
        animTimingRef.current = {
          signature: stepSignature,
          startTs: Date.now(),
          from: { ...lm.from },
          to: { ...lm.to },
          captured: lm.captured ? { ...lm.captured } : null,
        };
      } else {
        animTimingRef.current = null;
        setActiveGlide(null);
        return;
      }
    }

    const timing = animTimingRef.current;
    if (!timing || timing.signature !== stepSignature) {
      return;
    }

    let rafId = 0;
    let isCancelled = false;

    const finishAnimation = () => {
      if (isCancelled) return;
      if (animTimingRef.current?.signature === stepSignature) {
        animTimingRef.current = null;
      }
      setActiveGlide(null);
    };

    const tick = () => {
      if (isCancelled) return;
      const elapsed = Math.max(0, Date.now() - timing.startTs);
      const progress = Math.min(1, elapsed / MOVE_ANIMATION_MS);

      if (progress < 1) {
        setActiveGlide({
          signature: timing.signature,
          from: timing.from,
          to: timing.to,
          captured: timing.captured,
          progress,
        });
        rafId = requestAnimationFrame(tick);
      } else {
        finishAnimation();
      }
    };

    // Start frame immediately; also set a wall-clock timeout fallback so background
    // browser tabs (where requestAnimationFrame is paused by Chromium) still complete cleanly.
    tick();
    const fallbackTimer = setTimeout(
      finishAnimation,
      Math.max(0, MOVE_ANIMATION_MS - (Date.now() - timing.startTs)) + 60
    );

    return () => {
      isCancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      clearTimeout(fallbackTimer);
    };
  }, [stepSignature, roomId]);

  // Maps logical board (row, col) -> visual SVG user-space (x, y) with 180° Flip Board support
  const toScreenXY = (row: number, col: number): { x: number; y: number } => {
    const visualCol = isFlipped ? 8 - col : col;
    const visualRow = isFlipped ? 9 - row : row;
    return {
      x: PADDING + visualCol * CELL_SIZE,
      y: PADDING + visualRow * CELL_SIZE,
    };
  };

  // Legal destination squares for the currently selected piece
  const activePieceLegalTargets = useMemo(() => {
    if (!roomState || !selectedSquare || replayStepIndex !== null) {
      return [];
    }
    return roomState.legalMoves
      .filter(
        (m) =>
          m.from.row === selectedSquare.row && m.from.col === selectedSquare.col
      )
      .map((m) => m.to);
  }, [roomState, selectedSquare, replayStepIndex]);

  if (!roomState || !displayState) {
    return null;
  }

  const renderCrossMarker = (row: number, col: number) => {
    const { x, y } = toScreenXY(row, col);
    const visualCol = isFlipped ? 8 - col : col;
    const offset = 5;
    const len = 10;
    const paths: string[] = [];

    if (visualCol > 0) {
      paths.push(
        `M ${x - offset - len} ${y - offset} L ${x - offset} ${y - offset} L ${x - offset} ${y - offset - len}`
      );
      paths.push(
        `M ${x - offset - len} ${y + offset} L ${x - offset} ${y + offset} L ${x - offset} ${y + offset + len}`
      );
    }
    if (visualCol < 8) {
      paths.push(
        `M ${x + offset + len} ${y - offset} L ${x + offset} ${y - offset} L ${x + offset} ${y - offset - len}`
      );
      paths.push(
        `M ${x + offset + len} ${y + offset} L ${x + offset} ${y + offset} L ${x + offset} ${y + offset + len}`
      );
    }

    return (
      <path
        key={`marker-${row}-${col}`}
        d={paths.join(' ')}
        stroke="#5c3a1e"
        strokeWidth="1.6"
        fill="none"
      />
    );
  };

  const renderPieceDisc = (
    piece: Piece,
    isSelected: boolean,
    isGliding: boolean
  ) => {
    const isRed = piece.side === 'w';
    const label = useVietnameseChars
      ? VIET_LABELS[piece.fenChar]
      : HANZI_LABELS[piece.fenChar];

    return (
      <>
        <circle
          r={26}
          fill={isRed ? 'url(#redPieceGrad)' : 'url(#blackPieceGrad)'}
          stroke={
            isSelected || isGliding ? '#f59e0b' : isRed ? '#991b1b' : '#1c1917'
          }
          strokeWidth={isSelected || isGliding ? '3.2' : '2.5'}
        />
        <circle
          r={21.5}
          fill="none"
          stroke={isRed ? '#b91c1c' : '#292524'}
          strokeWidth="1.4"
        />
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fill={isRed ? '#b91c1c' : '#1c1917'}
          fontSize={useVietnameseChars ? '12.5' : '24'}
          fontWeight="900"
          fontFamily={useVietnameseChars ? 'sans-serif' : 'serif'}
        >
          {label}
        </text>
      </>
    );
  };

  // Check if there is an in-progress glide matching the current board state
  const currentGlide =
    activeGlide &&
    activeGlide.signature === displayState.stepSignature &&
    activeGlide.progress < 1
      ? activeGlide
      : null;

  const glideEased = currentGlide
    ? 1 - Math.pow(1 - currentGlide.progress, 3)
    : 1;

  // Build list of all pieces currently on `displayState.board` so NO piece is EVER omitted.
  // The gliding piece (if any) is placed last so it renders on top of stationary pieces.
  const stationaryPieces: Array<{
    row: number;
    col: number;
    piece: Piece;
    x: number;
    y: number;
    scale: number;
    isSelected: boolean;
    isGliding: boolean;
  }> = [];

  let glidingPieceRenderItem: {
    row: number;
    col: number;
    piece: Piece;
    x: number;
    y: number;
    scale: number;
    isSelected: boolean;
    isGliding: boolean;
  } | null = null;

  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const piece = displayState.board[r][c];
      if (!piece) continue;

      const isSelected =
        selectedSquare?.row === r && selectedSquare?.col === c;

      if (
        currentGlide &&
        currentGlide.to.row === r &&
        currentGlide.to.col === c
      ) {
        const fromXY = toScreenXY(currentGlide.from.row, currentGlide.from.col);
        const toXY = toScreenXY(r, c);
        const interpX = fromXY.x + (toXY.x - fromXY.x) * glideEased;
        const interpY = fromXY.y + (toXY.y - fromXY.y) * glideEased;
        const liftScale =
          1 + 0.12 * Math.sin(currentGlide.progress * Math.PI);

        glidingPieceRenderItem = {
          row: r,
          col: c,
          piece,
          x: interpX,
          y: interpY,
          scale: liftScale,
          isSelected,
          isGliding: true,
        };
      } else {
        const { x, y } = toScreenXY(r, c);
        stationaryPieces.push({
          row: r,
          col: c,
          piece,
          x,
          y,
          scale: isSelected ? 1.08 : 1,
          isSelected,
          isGliding: false,
        });
      }
    }
  }

  const allPiecesToRender = glidingPieceRenderItem
    ? [...stationaryPieces, glidingPieceRenderItem]
    : stationaryPieces;

  return (
    <div className="w-full h-full flex flex-col items-center justify-center select-none">
      {/* Board Control Bar (Flip Board 180° + Piece Label Toggle + Role Badge) */}
      <div className="w-full max-w-[580px] flex flex-wrap items-center justify-between gap-2 mb-2 px-3.5 py-2 rounded-xl bg-stone-900/95 border border-stone-800 shadow-md">
        <div className="flex items-center gap-2">
          <span
            className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${
              assignedRole === 'RED_PLAYER'
                ? 'bg-red-950/90 text-red-300 border border-red-700/60'
                : assignedRole === 'BLACK_PLAYER'
                  ? 'bg-stone-800 text-stone-200 border border-stone-600'
                  : 'bg-amber-950/80 text-amber-300 border border-amber-700/60'
            }`}
          >
            {assignedRole === 'RED_PLAYER' && 'Cầm Đỏ (Tiên)'}
            {assignedRole === 'BLACK_PLAYER' && 'Cầm Đen (Hậu)'}
            {assignedRole === 'SPECTATOR' && (
              <>
                <Eye className="w-3.5 h-3.5" /> Khán Giả
              </>
            )}
          </span>

          {displayState.inCheck && (
            <span className="px-2.5 py-1 rounded-md bg-red-600 text-white text-xs font-extrabold uppercase animate-pulse shadow">
              CHIẾU TƯỚNG!
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setUseVietnameseChars((prev) => !prev)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-semibold border border-stone-700 transition"
            title="Chuyển đổi hiển thị quân cờ Chữ Hán / Chữ Việt"
          >
            <Languages className="w-3.5 h-3.5 text-amber-400" />
            {useVietnameseChars ? 'Chữ Việt' : 'Chữ Hán'}
          </button>

          <button
            type="button"
            onClick={toggleFlipBoard}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-stone-950 text-xs font-bold transition shadow"
            title="Xoay bàn cờ 180 độ (không làm thay đổi FEN gốc)"
          >
            <RotateCw className="w-3.5 h-3.5" />
            Xoay 180° ({isFlipped ? 'Đen Dưới' : 'Đỏ Dưới'})
          </button>
        </div>
      </div>

      {/* Interactive SVG Xiangqi Board - Proportioned to fit 100% on a single desktop screen */}
      <div className="relative rounded-2xl p-2.5 bg-gradient-to-br from-[#6e4726] via-[#4a2e16] to-[#2e1b0c] shadow-2xl border-2 border-[#8c5c32] flex items-center justify-center">
        <svg
          viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
          className="h-[calc(100vh-145px)] max-h-[720px] min-h-[460px] w-auto max-w-full rounded-xl shadow-inner"
          style={{
            backgroundColor: '#e6be8a',
            aspectRatio: `${BOARD_WIDTH} / ${BOARD_HEIGHT}`,
          }}
        >
          <defs>
            <radialGradient id="redPieceGrad" cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#fff7ed" />
              <stop offset="65%" stopColor="#fed7aa" />
              <stop offset="100%" stopColor="#ea580c" />
            </radialGradient>
            <radialGradient id="blackPieceGrad" cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#fafaf9" />
              <stop offset="65%" stopColor="#d6d3d1" />
              <stop offset="100%" stopColor="#57534e" />
            </radialGradient>
            <filter id="pieceShadow" x="-25%" y="-25%" width="150%" height="150%">
              <feDropShadow dx="0" dy="3" stdDeviation="2.5" floodOpacity="0.45" />
            </filter>
          </defs>

          {/* Outer Decorative Frame */}
          <rect
            x={PADDING - 8}
            y={PADDING - 8}
            width={(BOARD_COLS - 1) * CELL_SIZE + 16}
            height={(BOARD_ROWS - 1) * CELL_SIZE + 16}
            fill="none"
            stroke="#4a2c11"
            strokeWidth="3"
          />

          {/* 10 Horizontal Rank Lines */}
          {Array.from({ length: BOARD_ROWS }).map((_, r) => {
            const y = PADDING + r * CELL_SIZE;
            return (
              <line
                key={`rank-${r}`}
                x1={PADDING}
                y1={y}
                x2={PADDING + (BOARD_COLS - 1) * CELL_SIZE}
                y2={y}
                stroke="#4a2c11"
                strokeWidth={
                  r === 0 || r === 9 || r === 4 || r === 5 ? '2.2' : '1.4'
                }
              />
            );
          })}

          {/* 9 Vertical File Lines */}
          {Array.from({ length: BOARD_COLS }).map((_, c) => {
            const x = PADDING + c * CELL_SIZE;
            if (c === 0 || c === 8) {
              return (
                <line
                  key={`file-${c}`}
                  x1={x}
                  y1={PADDING}
                  x2={x}
                  y2={PADDING + (BOARD_ROWS - 1) * CELL_SIZE}
                  stroke="#4a2c11"
                  strokeWidth="2.2"
                />
              );
            }
            return (
              <g key={`file-${c}`}>
                <line
                  x1={x}
                  y1={PADDING}
                  x2={x}
                  y2={PADDING + 4 * CELL_SIZE}
                  stroke="#4a2c11"
                  strokeWidth="1.4"
                />
                <line
                  x1={x}
                  y1={PADDING + 5 * CELL_SIZE}
                  x2={x}
                  y2={PADDING + 9 * CELL_SIZE}
                  stroke="#4a2c11"
                  strokeWidth="1.4"
                />
              </g>
            );
          })}

          {/* Top & Bottom 3x3 Palace Diagonal X Lines (Cửu Cung) */}
          <line
            x1={PADDING + 3 * CELL_SIZE}
            y1={PADDING}
            x2={PADDING + 5 * CELL_SIZE}
            y2={PADDING + 2 * CELL_SIZE}
            stroke="#4a2c11"
            strokeWidth="1.6"
          />
          <line
            x1={PADDING + 5 * CELL_SIZE}
            y1={PADDING}
            x2={PADDING + 3 * CELL_SIZE}
            y2={PADDING + 2 * CELL_SIZE}
            stroke="#4a2c11"
            strokeWidth="1.6"
          />
          <line
            x1={PADDING + 3 * CELL_SIZE}
            y1={PADDING + 7 * CELL_SIZE}
            x2={PADDING + 5 * CELL_SIZE}
            y2={PADDING + 9 * CELL_SIZE}
            stroke="#4a2c11"
            strokeWidth="1.6"
          />
          <line
            x1={PADDING + 5 * CELL_SIZE}
            y1={PADDING + 7 * CELL_SIZE}
            x2={PADDING + 3 * CELL_SIZE}
            y2={PADDING + 9 * CELL_SIZE}
            stroke="#4a2c11"
            strokeWidth="1.6"
          />

          {/* Sở Hà - Hán Giới River Inscription */}
          <text
            x={PADDING + 1.8 * CELL_SIZE}
            y={PADDING + 4.62 * CELL_SIZE}
            textAnchor="middle"
            fill="#5c3a1e"
            fontSize="24"
            fontWeight="bold"
            fontFamily="serif"
            letterSpacing="6"
          >
            楚 河
          </text>
          <text
            x={PADDING + 6.2 * CELL_SIZE}
            y={PADDING + 4.62 * CELL_SIZE}
            textAnchor="middle"
            fill="#5c3a1e"
            fontSize="24"
            fontWeight="bold"
            fontFamily="serif"
            letterSpacing="6"
          >
            漢 界
          </text>

          {/* Cannon & Soldier Position Cross Markers */}
          {MARKER_COORDS.map((pos) => renderCrossMarker(pos.row, pos.col))}

          {/* File Numbering Along Top & Bottom Borders */}
          {Array.from({ length: BOARD_COLS }).map((_, visualCol) => {
            const logicalCol = isFlipped ? 8 - visualCol : visualCol;
            const redNum = 9 - logicalCol;
            const blackNum = logicalCol + 1;
            const x = PADDING + visualCol * CELL_SIZE;

            return (
              <g key={`file-label-${visualCol}`}>
                <text
                  x={x}
                  y={20}
                  textAnchor="middle"
                  fill="#5c3a1e"
                  fontSize="12"
                  fontWeight="bold"
                >
                  {isFlipped ? redNum : blackNum}
                </text>
                <text
                  x={x}
                  y={BOARD_HEIGHT - 10}
                  textAnchor="middle"
                  fill="#5c3a1e"
                  fontSize="12"
                  fontWeight="bold"
                >
                  {isFlipped ? blackNum : redNum}
                </text>
              </g>
            );
          })}

          {/* Last Move Origin, Trajectory Line & Destination Highlight */}
          {displayState.lastMove &&
            (() => {
              const fromXY = toScreenXY(
                displayState.lastMove.from.row,
                displayState.lastMove.from.col
              );
              const toXY = toScreenXY(
                displayState.lastMove.to.row,
                displayState.lastMove.to.col
              );
              return (
                <>
                  <line
                    x1={fromXY.x}
                    y1={fromXY.y}
                    x2={toXY.x}
                    y2={toXY.y}
                    stroke="#d97706"
                    strokeWidth="3"
                    strokeDasharray="6,4"
                    strokeOpacity="0.7"
                  />
                  {[fromXY, toXY].map((xy, idx) => (
                    <rect
                      key={`last-move-${idx}`}
                      x={xy.x - 28}
                      y={xy.y - 28}
                      width={56}
                      height={56}
                      rx={8}
                      fill={
                        idx === 0
                          ? 'rgba(217, 119, 6, 0.18)'
                          : 'rgba(217, 119, 6, 0.32)'
                      }
                      stroke="#d97706"
                      strokeWidth="2.5"
                      strokeDasharray={idx === 0 ? '5,4' : undefined}
                    />
                  ))}
                </>
              );
            })()}

          {/* Selected Piece Square Highlight */}
          {selectedSquare &&
            (() => {
              const { x, y } = toScreenXY(
                selectedSquare.row,
                selectedSquare.col
              );
              return (
                <circle
                  cx={x}
                  cy={y}
                  r={30}
                  fill="rgba(16, 185, 129, 0.25)"
                  stroke="#059669"
                  strokeWidth="3"
                />
              );
            })()}

          {/* In-Check General Pulsing Alert Halo */}
          {displayState.inCheck &&
            displayState.checkedGeneralPos &&
            (() => {
              const { x, y } = toScreenXY(
                displayState.checkedGeneralPos.row,
                displayState.checkedGeneralPos.col
              );
              return (
                <circle
                  cx={x}
                  cy={y}
                  r={32}
                  fill="rgba(220, 38, 38, 0.35)"
                  stroke="#dc2626"
                  strokeWidth="3.5"
                />
              );
            })()}

          {/* Captured Piece Fade-Out Effect During 1.0s Glide Animation */}
          {currentGlide &&
            currentGlide.captured &&
            (() => {
              const { x, y } = toScreenXY(
                currentGlide.to.row,
                currentGlide.to.col
              );
              const fadeOpacity = Math.max(0, 1 - glideEased);
              const shrinkScale = 1 - 0.25 * glideEased;
              return (
                <g
                  transform={`translate(${x}, ${y}) scale(${shrinkScale})`}
                  opacity={fadeOpacity}
                  style={{ pointerEvents: 'none' }}
                >
                  {renderPieceDisc(currentGlide.captured, false, false)}
                </g>
              );
            })()}

          {/* Render ALL Pieces on the 9x10 Grid Using Pure SVG User-Space `transform` */}
          {allPiecesToRender.map((item) => (
            <g
              key={`piece-${item.row}-${item.col}`}
              data-piece-square={`${item.row}-${item.col}`}
              data-piece-fen={item.piece.fenChar}
              transform={`translate(${item.x}, ${item.y}) scale(${item.scale})`}
              onClick={() =>
                selectSquareOrMove({ row: item.row, col: item.col })
              }
              className="cursor-pointer"
              filter="url(#pieceShadow)"
            >
              {renderPieceDisc(item.piece, item.isSelected, item.isGliding)}
            </g>
          ))}

          {/* Legal Move Suggestion Dots & Capture Target Rings */}
          {activePieceLegalTargets.map((target) => {
            const { x, y } = toScreenXY(target.row, target.col);
            const hasEnemyPiece =
              displayState.board[target.row][target.col] !== null;

            return (
              <g
                key={`hint-${target.row}-${target.col}`}
                onClick={() => selectSquareOrMove(target)}
                className="cursor-pointer"
              >
                {hasEnemyPiece ? (
                  <circle
                    cx={x}
                    cy={y}
                    r={28}
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth="3.5"
                    strokeDasharray="6,4"
                  />
                ) : (
                  <circle
                    cx={x}
                    cy={y}
                    r={9}
                    fill="#10b981"
                    fillOpacity="0.88"
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                )}
              </g>
            );
          })}

          {/* Invisible Click Targets for Empty Squares */}
          {Array.from({ length: BOARD_ROWS }).map((_, r) =>
            Array.from({ length: BOARD_COLS }).map((__, c) => {
              if (displayState.board[r][c] !== null) return null;
              const { x, y } = toScreenXY(r, c);
              return (
                <rect
                  key={`click-${r}-${c}`}
                  x={x - CELL_SIZE / 2}
                  y={y - CELL_SIZE / 2}
                  width={CELL_SIZE}
                  height={CELL_SIZE}
                  fill="transparent"
                  className="cursor-pointer"
                  onClick={() => selectSquareOrMove({ row: r, col: c })}
                />
              );
            })
          )}
        </svg>
      </div>
    </div>
  );
};
