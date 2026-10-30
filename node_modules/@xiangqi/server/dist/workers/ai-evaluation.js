"use strict";
// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - AI BOARD EVALUATION & PIECE-SQUARE TABLES (PST)
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.RED_PST = exports.PIECE_MATERIAL_VALUE = void 0;
exports.getPieceSquareBonus = getPieceSquareBonus;
exports.evaluateBoard = evaluateBoard;
const shared_1 = require("@xiangqi/shared");
/**
 * Base Material Values (centipawns) for Xiangqi pieces:
 * General (k): 10000
 * Chariot (r): 900
 * Cannon  (c): 450
 * Horse   (n): 400
 * Elephant(b): 200
 * Advisor (a): 200
 * Soldier (p): 100 (increases significantly via PST after crossing the river)
 */
exports.PIECE_MATERIAL_VALUE = {
    k: 10000,
    r: 900,
    c: 450,
    n: 400,
    b: 200,
    a: 200,
    p: 100,
};
/**
 * 10x9 Piece-Square Tables (PST) from Red's ('w') perspective:
 * - Row 0 is Black's back rank (top), Row 9 is Red's back rank (bottom).
 * - For Black ('b') pieces at (row, col), we mirror the lookup to (9 - row, 8 - col).
 */
exports.RED_PST = {
    // Tướng (General / King) - stays inside Palace rows 7..9, cols 3..5
    k: [
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, -12, -15, -12, 0, 0, 0],
        [0, 0, 0, -4, 2, -4, 0, 0, 0],
        [0, 0, 0, 8, 22, 8, 0, 0, 0],
    ],
    // Sĩ (Advisor) - Palace diagonal defense, highest at central palace (row 8, col 4)
    a: [
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 12, 0, 12, 0, 0, 0],
        [0, 0, 0, 0, 28, 0, 0, 0, 0],
        [0, 0, 0, 16, 0, 16, 0, 0, 0],
    ],
    // Tượng (Elephant) - Own side of river (rows 5..9), highest at central throat (row 7, col 4)
    b: [
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 14, 0, 0, 0, 14, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [-6, 0, 0, 0, 28, 0, 0, 0, -6],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 16, 0, 0, 0, 16, 0, 0],
    ],
    // Mã (Horse) - Strong in central files & Ngọa Tào / Quải Giác (rows 1..4, cols 2..6), weak at rim
    n: [
        [10, 22, 30, 25, 15, 25, 30, 22, 10],
        [14, 34, 52, 58, 42, 58, 52, 34, 14],
        [18, 42, 60, 68, 64, 68, 60, 42, 18],
        [16, 36, 52, 62, 56, 62, 52, 36, 16],
        [12, 28, 42, 48, 46, 48, 42, 28, 12],
        [8, 22, 34, 42, 38, 42, 34, 22, 8],
        [4, 16, 26, 32, 30, 32, 26, 16, 4],
        [2, 12, 28, 24, 20, 24, 28, 12, 2],
        [-8, 4, 12, 14, 6, 14, 12, 4, -8],
        [-18, -10, 4, 8, 0, 8, 4, -10, -18],
    ],
    // Xe (Chariot) - Dominant on open files, river rank (rows 4..5), and opponent's pawn/throat ranks (rows 1..3)
    r: [
        [35, 48, 42, 56, 60, 56, 42, 48, 35],
        [40, 56, 54, 68, 72, 68, 54, 56, 40],
        [34, 48, 46, 58, 60, 58, 46, 48, 34],
        [30, 44, 42, 52, 54, 52, 42, 44, 30],
        [28, 42, 40, 50, 52, 50, 40, 42, 28],
        [22, 36, 34, 44, 46, 44, 34, 36, 22],
        [14, 26, 24, 34, 36, 34, 24, 26, 14],
        [12, 24, 22, 32, 34, 32, 22, 24, 12],
        [16, 28, 24, 36, 30, 36, 24, 28, 16],
        [-6, 20, 12, 28, 22, 28, 12, 20, -6],
    ],
    // Pháo (Cannon) - Strong on central file (Pháo đầu col 4), back rank attacks, and river control
    c: [
        [28, 32, 24, 18, 12, 18, 24, 32, 28],
        [24, 28, 22, 20, 24, 20, 22, 28, 24],
        [22, 26, 24, 30, 38, 30, 24, 26, 22],
        [16, 20, 22, 34, 44, 34, 22, 20, 16],
        [12, 18, 24, 36, 46, 36, 24, 18, 12],
        [10, 16, 20, 32, 42, 32, 20, 16, 10],
        [8, 14, 18, 26, 38, 26, 18, 14, 8],
        [18, 24, 16, 34, 52, 34, 16, 24, 18],
        [6, 12, 10, 16, 24, 16, 10, 12, 6],
        [4, 8, 6, 12, 18, 12, 6, 8, 4],
    ],
    // Tốt (Soldier) - Huge bonus after crossing river (rows 0..4), especially approaching palace (rows 1..3, cols 3..5)
    p: [
        [18, 26, 34, 46, 52, 46, 34, 26, 18],
        [54, 72, 92, 125, 140, 125, 92, 72, 54],
        [48, 68, 88, 118, 132, 118, 88, 68, 48],
        [40, 58, 76, 100, 112, 100, 76, 58, 40],
        [28, 42, 58, 74, 84, 74, 58, 42, 28],
        [6, 0, 14, 0, 24, 0, 14, 0, 6],
        [0, 0, 4, 0, 10, 0, 4, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
};
/**
 * Returns the Piece-Square Table (PST) positional bonus for a piece at (row, col).
 */
function getPieceSquareBonus(piece, row, col) {
    const table = exports.RED_PST[piece.type];
    if (piece.side === 'w') {
        return table[row][col];
    }
    else {
        // Mirror vertically (9 - row) and horizontally (8 - col) for Black
        return table[9 - row][8 - col];
    }
}
/**
 * Evaluates the current board from the perspective of `perspectiveSide`.
 * Positive score favors `perspectiveSide`; negative score favors opponent.
 *
 * @param engine Active XiangqiEngine instance
 * @param perspectiveSide Side from whose perspective the score is returned
 * @param includePst True for Level 2 (Medium) & Level 3 (Hard); False for Level 1 (Easy)
 * @param randomJitter Max random noise in centipawns (used in Level 1 Easy)
 */
function evaluateBoard(engine, perspectiveSide, includePst, randomJitter = 0) {
    const rawBoard = engine.getRawBoard();
    let redScore = 0;
    let blackScore = 0;
    let redAdvisors = 0;
    let redElephants = 0;
    let blackAdvisors = 0;
    let blackElephants = 0;
    for (let r = 0; r < shared_1.BOARD_ROWS; r++) {
        for (let c = 0; c < shared_1.BOARD_COLS; c++) {
            const piece = rawBoard[r][c];
            if (!piece)
                continue;
            const material = exports.PIECE_MATERIAL_VALUE[piece.type];
            const positional = includePst ? getPieceSquareBonus(piece, r, c) : 0;
            if (piece.side === 'w') {
                redScore += material + positional;
                if (piece.type === 'a')
                    redAdvisors++;
                if (piece.type === 'b')
                    redElephants++;
            }
            else {
                blackScore += material + positional;
                if (piece.type === 'a')
                    blackAdvisors++;
                if (piece.type === 'b')
                    blackElephants++;
            }
        }
    }
    // Defensive synergy bonus (Song Sĩ / Song Tượng liên kết bảo vệ cung Tướng)
    if (includePst) {
        if (redAdvisors === 2)
            redScore += 35;
        if (redElephants === 2)
            redScore += 30;
        if (blackAdvisors === 2)
            blackScore += 35;
        if (blackElephants === 2)
            blackScore += 30;
    }
    let netScore = perspectiveSide === 'w' ? redScore - blackScore : blackScore - redScore;
    if (randomJitter > 0) {
        const noise = Math.floor((Math.random() * 2 - 1) * randomJitter);
        netScore += noise;
    }
    return netScore;
}
//# sourceMappingURL=ai-evaluation.js.map