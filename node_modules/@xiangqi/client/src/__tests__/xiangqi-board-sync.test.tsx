// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - BOARD PIECE RENDERING & CLOCK_SYNC TESTS
// Verifies that `<XiangqiBoard />`:
// 1. Unconditionally renders all remaining pieces on the 9x10 grid immediately
//    after an Online PvP move (never hides the destination piece waiting for
//    the opponent's next turn).
// 2. Uses pure SVG user-space `transform="translate(x, y) scale(s)"` rather
//    than CSS `px` transforms on `<g>`, preserving exact coordinates under
//    both normal (`RED_PLAYER`) and 180-degree flipped (`BLACK_PLAYER`) views.
// 3. Preserves the moved piece and `lastMove` trajectory across periodic
//    1000ms `clock_sync` store updates.
// ============================================================================

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  INITIAL_XIANGQI_FEN,
  RoomStateDto,
  XiangqiEngine,
} from '@xiangqi/shared';
import { useGameStore } from '../store/useGameStore';
import { XiangqiBoard } from '../components/XiangqiBoard';
import { VideoCallPanel } from '../components/VideoCallPanel';

function buildMockPvpRoomState(engine: XiangqiEngine): RoomStateDto {
  const history = engine.getMoveHistory();
  const lastMove = history.length > 0 ? history[history.length - 1] : null;
  const outcome = engine.getGameOutcome();

  return {
    roomId: 'room-pvp-board-test',
    roomName: 'Phòng Kiểm Thử Bàn Cờ Online',
    isPrivate: false,
    mode: 'PVP_RANKED',
    status: 'PLAYING',
    redPlayer: {
      userId: 'user-red',
      username: 'KyThuDo',
      avatarUrl: '',
      eloRating: 1400,
      side: 'w',
      isConnected: true,
      disconnectedAt: null,
      reconnectDeadlineTimestamp: null,
      isMutedPlayerChat: false,
    },
    blackPlayer: {
      userId: 'user-black',
      username: 'KyThuDen',
      avatarUrl: '',
      eloRating: 1410,
      side: 'b',
      isConnected: true,
      disconnectedAt: null,
      reconnectDeadlineTimestamp: null,
      isMutedPlayerChat: false,
    },
    spectatorCount: 0,
    spectators: [],
    fen: engine.generateFen(),
    initialFen: INITIAL_XIANGQI_FEN,
    turn: engine.getTurn(),
    inCheck: outcome.inCheck,
    checkedGeneralPos: outcome.checkedGeneralPos,
    lastMove,
    moveHistory: history,
    moveHistoryWxf: history.map((m) => m.wxf).join(' '),
    positionHashes: engine.getPositionHashes(),
    legalMoves: engine.getLegalMoves(),
    clock: {
      totalTimeMs: 1800000,
      turnTimeMs: 60000,
      redTimeLeftMs: 1795000,
      blackTimeLeftMs: 1800000,
      currentTurnLeftMs: 60000,
      activeSide: engine.getTurn(),
      lastTickServerTimestamp: Date.now(),
      isPaused: false,
    },
    drawOfferFrom: null,
    adjournRequestFrom: null,
    outcome,
    eloChanges: null,
  };
}

function syncStoreForSsrRender(patch: Partial<ReturnType<typeof useGameStore.getState>>): void {
  useGameStore.setState(patch);
  Object.assign(useGameStore.getInitialState(), useGameStore.getState());
}

describe('XiangqiBoard Online PvP Rendering & clock_sync Resilience', () => {
  it('Renders all 32 pieces and last-move highlights immediately on both Red and Black views across clock_sync ticks', () => {
    const engine = new XiangqiEngine(INITIAL_XIANGQI_FEN);

    // 1. Initial Online PvP Room State (32 pieces)
    syncStoreForSsrRender({
      roomState: buildMockPvpRoomState(engine),
      assignedRole: 'RED_PLAYER',
      isFlipped: false,
      selectedSquare: null,
      replayStepIndex: null,
    });

    const initialSvg = renderToStaticMarkup(React.createElement(XiangqiBoard));
    const initialPieceCount = (initialSvg.match(/data-piece-fen="/g) ?? []).length;
    expect(initialPieceCount).toBe(32);

    // 2. Red makes Move 1: Pháo 2 bình 5 ((7,7) -> (7,4), screenXY = (48 + 4*64, 48 + 7*64) = (304, 496))
    engine.makeMove({ from: { row: 7, col: 7 }, to: { row: 7, col: 4 } });
    const afterRedMoveRoom = buildMockPvpRoomState(engine);

    syncStoreForSsrRender({
      roomState: afterRedMoveRoom,
      selectedSquare: null,
      replayStepIndex: null,
    });

    const afterRedMoveSvg = renderToStaticMarkup(React.createElement(XiangqiBoard));
    const afterRedMovePieceCount = (afterRedMoveSvg.match(/data-piece-fen="/g) ?? []).length;

    // Must still render all 32 pieces immediately (0 hidden/missing moved piece!)
    expect(afterRedMovePieceCount).toBe(32);
    // Moved Red Cannon at logical (7, 4) -> screen translate(304, 496) scale(1)
    expect(afterRedMoveSvg).toContain(
      'data-piece-square="7-4" data-piece-fen="C" transform="translate(304, 496) scale(1)"'
    );
    expect(afterRedMoveSvg).not.toContain('data-piece-square="7-7"');
    // Must not use broken CSS pixel translate on SVG <g>
    expect(afterRedMoveSvg).not.toContain('translate(304px');
    // Trajectory highlight line from (496, 496) to (304, 496) must be rendered immediately
    expect(afterRedMoveSvg).toContain('x1="496" y1="496" x2="304" y2="496"');

    // 3. Simulate periodic 1000ms `clock_sync` ticks updating `roomState.clock`
    syncStoreForSsrRender({
      roomState: {
        ...afterRedMoveRoom,
        clock: {
          ...afterRedMoveRoom.clock,
          blackTimeLeftMs: 1798000,
          currentTurnLeftMs: 58000,
        },
      },
    });

    const afterClockSyncSvg = renderToStaticMarkup(React.createElement(XiangqiBoard));
    expect((afterClockSyncSvg.match(/data-piece-fen="/g) ?? []).length).toBe(32);
    expect(afterClockSyncSvg).toContain(
      'data-piece-square="7-4" data-piece-fen="C" transform="translate(304, 496) scale(1)"'
    );
    expect(afterClockSyncSvg).toContain('x1="496" y1="496" x2="304" y2="496"');

    // 4. Switch to Black Player's flipped perspective (`isFlipped: true`) and execute Black Move 2:
    // Mã 8 tấn 7 ((0,7) -> (2,6)). Under 180-deg flip: visualCol = 8 - 6 = 2, visualRow = 9 - 2 = 7 -> (176, 496)
    engine.makeMove({ from: { row: 0, col: 7 }, to: { row: 2, col: 6 } });
    const afterBlackMoveRoom = buildMockPvpRoomState(engine);

    syncStoreForSsrRender({
      roomState: afterBlackMoveRoom,
      assignedRole: 'BLACK_PLAYER',
      isFlipped: true,
    });

    const blackViewSvg = renderToStaticMarkup(React.createElement(XiangqiBoard));
    expect((blackViewSvg.match(/data-piece-fen="/g) ?? []).length).toBe(32);
    // Black's newly moved Horse at logical (2, 6) -> flipped (2, 7) -> (48 + 2*64, 48 + 7*64) = (176, 496)
    expect(blackViewSvg).toContain(
      'data-piece-square="2-6" data-piece-fen="n" transform="translate(176, 496) scale(1)"'
    );
    // Red's previously moved Cannon at logical (7, 4) -> flipped (4, 2) -> (48 + 4*64, 48 + 2*64) = (304, 176)
    expect(blackViewSvg).toContain(
      'data-piece-square="7-4" data-piece-fen="C" transform="translate(304, 176) scale(1)"'
    );
  });

  it('Renders VideoCallPanel exclusively for RED_PLAYER and BLACK_PLAYER in Online PvP rooms (hides for Spectators and PvE AI)', () => {
    const engine = new XiangqiEngine(INITIAL_XIANGQI_FEN);
    const pvpRoom = buildMockPvpRoomState(engine);

    // 1. RED_PLAYER in Online PvP sees Gọi Video & Gọi Thoại controls
    syncStoreForSsrRender({
      roomState: pvpRoom,
      assignedRole: 'RED_PLAYER',
    });
    const redPlayerHtml = renderToStaticMarkup(React.createElement(VideoCallPanel));
    expect(redPlayerHtml).toContain('Video Call Đấu Thủ 1v1');
    expect(redPlayerHtml).toContain('Gọi Video');
    expect(redPlayerHtml).toContain('Gọi Thoại');

    // 2. SPECTATOR in the same Online PvP room sees NOTHING
    syncStoreForSsrRender({
      roomState: pvpRoom,
      assignedRole: 'SPECTATOR',
    });
    const spectatorHtml = renderToStaticMarkup(React.createElement(VideoCallPanel));
    expect(spectatorHtml).toBe('');

    // 3. Player in PVE_AI room sees NOTHING
    syncStoreForSsrRender({
      roomState: { ...pvpRoom, mode: 'PVE_AI' },
      assignedRole: 'RED_PLAYER',
    });
    const pveHtml = renderToStaticMarkup(React.createElement(VideoCallPanel));
    expect(pveHtml).toBe('');
  });
});
