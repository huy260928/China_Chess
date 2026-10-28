// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - CORE ENGINE UNIT TESTS (VITEST)
// Covers all 7 piece movement rules, Flying General, Tactical Checkmates,
// Stalemate (loss in Xiangqi), Threefold Repetition (Zobrist Hash),
// WXF/Vietnamese Notations, and International ELO Calculator.
// ============================================================================

import { describe, expect, it } from 'vitest';
import {
  calculateMatchElo,
  INITIAL_XIANGQI_FEN,
  XiangqiEngine,
} from '../index';

describe('XiangqiEngine - Core Rules & Tactical Endgame Puzzles', () => {
  it('1. Parses initial FEN accurately and generates all 44 legal opening moves for Red', () => {
    const engine = new XiangqiEngine(INITIAL_XIANGQI_FEN);

    expect(engine.getTurn()).toBe('w');
    expect(engine.generateFen()).toBe(INITIAL_XIANGQI_FEN);
    expect(engine.isInCheck('w')).toBe(false);
    expect(engine.isInCheck('b')).toBe(false);

    const legalMoves = engine.getLegalMoves('w');
    expect(legalMoves.length).toBe(44);
  });

  it('2. Enforces Luật Cản Chân Mã (Blocking the Horse Leg)', () => {
    // Red Horse at (8,4), Black Pawn at (7,4) blocking the upward orthogonal leg
    const fen = '4k4/9/9/9/9/9/9/4p4/4N4/3K5 w - - 0 1';
    const engine = new XiangqiEngine(fen);

    // Upward L-jumps to (6,3) and (6,5) must be blocked by the piece at (7,4)
    expect(
      engine.isValidMove({ from: { row: 8, col: 4 }, to: { row: 6, col: 3 } })
    ).toBe(false);
    expect(
      engine.isValidMove({ from: { row: 8, col: 4 }, to: { row: 6, col: 5 } })
    ).toBe(false);

    // Left/Right L-jumps to (7,2) and (7,6) have unblocked legs at (8,3) and (8,5)
    expect(
      engine.isValidMove({ from: { row: 8, col: 4 }, to: { row: 7, col: 2 } })
    ).toBe(true);
    expect(
      engine.isValidMove({ from: { row: 8, col: 4 }, to: { row: 7, col: 6 } })
    ).toBe(true);
  });

  it('3. Enforces Luật Cản Mắt Tượng & Không Qua Sông (Blocking Elephant Eye & River Boundary)', () => {
    // Red Elephant at (7,4) with eye blocked at (6,3) by Black Pawn; second Red Elephant at river bank (5,2)
    const fen = '3k5/9/9/9/9/2B6/3p5/4B4/9/4K4 w - - 0 1';
    const engine = new XiangqiEngine(fen);

    // Blocked eye at (6,3) prevents (7,4) -> (5,2)
    expect(
      engine.isValidMove({ from: { row: 7, col: 4 }, to: { row: 5, col: 2 } })
    ).toBe(false);

    // Unblocked eye at (6,5) allows (7,4) -> (5,6)
    expect(
      engine.isValidMove({ from: { row: 7, col: 4 }, to: { row: 5, col: 6 } })
    ).toBe(true);

    // Elephant at (5,2) cannot cross the river into row 3
    expect(
      engine.isValidMove({ from: { row: 5, col: 2 }, to: { row: 3, col: 0 } })
    ).toBe(false);
    expect(
      engine.isValidMove({ from: { row: 5, col: 2 }, to: { row: 3, col: 4 } })
    ).toBe(false);
  });

  it('4. Enforces Luật Ngòi Pháo (Cannon Screen / Mount Capture & Non-Capture)', () => {
    // Red Cannon at (7,4), Red Pawn screen at (6,4), Black Pawn at (3,4), Black Horse behind it at (2,4)
    const fen = '4k4/4r4/4n4/4p4/9/9/4P4/4C4/9/3K5 w - - 0 1';
    const engine = new XiangqiEngine(fen);

    // Cannot move to empty square (5,4) beyond screen without capturing
    expect(
      engine.isValidMove({ from: { row: 7, col: 4 }, to: { row: 5, col: 4 } })
    ).toBe(false);

    // Can jump over exactly 1 screen (6,4) to capture the first enemy piece at (3,4)
    expect(
      engine.isValidMove({ from: { row: 7, col: 4 }, to: { row: 3, col: 4 } })
    ).toBe(true);

    // Cannot jump over 2 pieces ((6,4) and (3,4)) to capture (2,4)
    expect(
      engine.isValidMove({ from: { row: 7, col: 4 }, to: { row: 2, col: 4 } })
    ).toBe(false);
  });

  it('5. Enforces Luật Tốt Qua Sông (Soldier Movement Before and After Crossing River)', () => {
    // Red Pawn at (6,0) (own side) and Red Pawn at (4,4) (crossed river)
    const fen = '3k5/9/9/9/4P4/9/P8/9/9/4K4 w - - 0 1';
    const engine = new XiangqiEngine(fen);

    // Uncrossed pawn at (6,0) can only move forward to (5,0), not sideways to (6,1)
    expect(
      engine.isValidMove({ from: { row: 6, col: 0 }, to: { row: 5, col: 0 } })
    ).toBe(true);
    expect(
      engine.isValidMove({ from: { row: 6, col: 0 }, to: { row: 6, col: 1 } })
    ).toBe(false);

    // Crossed pawn at (4,4) can move forward (3,4) and sideways (4,3), (4,5), but NEVER backward (5,4)
    expect(
      engine.isValidMove({ from: { row: 4, col: 4 }, to: { row: 3, col: 4 } })
    ).toBe(true);
    expect(
      engine.isValidMove({ from: { row: 4, col: 4 }, to: { row: 4, col: 3 } })
    ).toBe(true);
    expect(
      engine.isValidMove({ from: { row: 4, col: 4 }, to: { row: 4, col: 5 } })
    ).toBe(true);
    expect(
      engine.isValidMove({ from: { row: 4, col: 4 }, to: { row: 5, col: 4 } })
    ).toBe(false);
  });

  it('6. Enforces Luật Lộ Mặt Tướng (Flying General Pin)', () => {
    // Black General at (0,4), Red Chariot at (8,4), Red General at (9,4)
    const fen = '4k4/9/9/9/9/9/9/9/4R4/4K4 w - - 0 1';
    const engine = new XiangqiEngine(fen);

    // Moving Red Chariot horizontally off col 4 exposes the two Generals directly -> Illegal!
    expect(
      engine.isValidMove({ from: { row: 8, col: 4 }, to: { row: 8, col: 3 } })
    ).toBe(false);
    expect(
      engine.isValidMove({ from: { row: 8, col: 4 }, to: { row: 8, col: 5 } })
    ).toBe(false);

    // Moving Red Chariot vertically along col 4 keeps the file blocked -> Legal!
    expect(
      engine.isValidMove({ from: { row: 8, col: 4 }, to: { row: 5, col: 4 } })
    ).toBe(true);
  });

  it('7. Detects Thế Cờ Hiểm #1: Tuyệt Sát Trọng Pháo (Double Cannon Checkmate)', () => {
    // Black General at (0,4) flanked by Advisors at (0,3) & (0,5); Red Cannons at (2,4) & (8,4)
    const fen = '3aka3/9/4C4/9/9/9/9/9/4C4/3K5 b - - 0 1';
    const engine = new XiangqiEngine(fen);

    expect(engine.isInCheck('b')).toBe(true);
    expect(engine.getLegalMoves('b').length).toBe(0);

    const outcome = engine.getGameOutcome();
    expect(outcome.isOver).toBe(true);
    expect(outcome.reason).toBe('CHECKMATE');
    expect(outcome.winner).toBe('w');
  });

  it('8. Detects Thế Cờ Hiểm #2: Hết Nước Đi Không Bị Chiếu (Stalemate = Loss in Xiangqi)', () => {
    // Black General at (0,3) is NOT in check, but (1,3) is controlled by Red Chariot at (1,5)
    // and (0,4) is forbidden due to Flying General with Red General at (9,4).
    const fen = '3k5/5R3/9/9/9/9/9/9/9/4K4 b - - 0 1';
    const engine = new XiangqiEngine(fen);

    expect(engine.isInCheck('b')).toBe(false);
    expect(engine.getLegalMoves('b').length).toBe(0);

    const outcome = engine.getGameOutcome();
    expect(outcome.isOver).toBe(true);
    expect(outcome.reason).toBe('STALEMATE');
    expect(outcome.winner).toBe('w'); // In Xiangqi, Stalemate is a loss for the stalemated player
  });

  it('9. Detects Threefold Repetition via Deterministic 64-bit Zobrist Hash', () => {
    const engine = new XiangqiEngine(INITIAL_XIANGQI_FEN);
    const initialHash = engine.getZobristHash();

    // Repeat reversible Chariot moves back and forth twice (reaching the initial position 3 times)
    for (let cycle = 0; cycle < 2; cycle++) {
      // Red R (9,0) -> (8,0)
      engine.makeMove({ from: { row: 9, col: 0 }, to: { row: 8, col: 0 } });
      // Black r (0,0) -> (1,0)
      engine.makeMove({ from: { row: 0, col: 0 }, to: { row: 1, col: 0 } });
      // Red R (8,0) -> (9,0)
      engine.makeMove({ from: { row: 8, col: 0 }, to: { row: 9, col: 0 } });
      // Black r (1,0) -> (0,0)
      engine.makeMove({ from: { row: 1, col: 0 }, to: { row: 0, col: 0 } });
    }

    expect(engine.getZobristHash()).toBe(initialHash);
    expect(engine.isThreefoldRepetition()).toBe(true);

    const outcome = engine.getGameOutcome();
    expect(outcome.isOver).toBe(true);
    expect(outcome.reason).toBe('DRAW_REPETITION');
    expect(outcome.winner).toBe('draw');
  });

  it('10. Generates accurate WXF & Vietnamese Move Notations and calculates ELO K=32 / K=16', () => {
    const engine = new XiangqiEngine(INITIAL_XIANGQI_FEN);

    // 1. Pháo 2 bình 5 (C2.5)
    const move1 = engine.makeMove({
      from: { row: 7, col: 7 },
      to: { row: 7, col: 4 },
    });
    expect(move1.wxf).toBe('C2.5');
    expect(move1.vietnameseNotation).toBe('Pháo 2 bình 5');

    // 2. Mã 8 tiến 7 (N8+7 for Black)
    const move2 = engine.makeMove({
      from: { row: 0, col: 7 },
      to: { row: 2, col: 6 },
    });
    expect(move2.wxf).toBe('N8+7');
    expect(move2.vietnameseNotation).toBe('Mã 8 tiến 7');

    // ELO Calculation: Two 1200 ELO players (K=32), Red wins -> +16 / -16
    const eloEqual = calculateMatchElo(1200, 1200, 'w');
    expect(eloEqual.redDelta).toBe(16);
    expect(eloEqual.blackDelta).toBe(-16);

    // ELO Calculation: Master players at 2100 ELO (K=16), Red wins -> +8 / -8
    const eloMaster = calculateMatchElo(2100, 2100, 'w');
    expect(eloMaster.redDelta).toBe(8);
    expect(eloMaster.blackDelta).toBe(-8);
  });
});
