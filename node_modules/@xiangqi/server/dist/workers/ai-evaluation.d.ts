import { Piece, PieceType, Side, XiangqiEngine } from '@xiangqi/shared';
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
export declare const PIECE_MATERIAL_VALUE: Record<PieceType, number>;
/**
 * 10x9 Piece-Square Tables (PST) from Red's ('w') perspective:
 * - Row 0 is Black's back rank (top), Row 9 is Red's back rank (bottom).
 * - For Black ('b') pieces at (row, col), we mirror the lookup to (9 - row, 8 - col).
 */
export declare const RED_PST: Record<PieceType, readonly (readonly number[])[]>;
/**
 * Returns the Piece-Square Table (PST) positional bonus for a piece at (row, col).
 */
export declare function getPieceSquareBonus(piece: Piece, row: number, col: number): number;
/**
 * Evaluates the current board from the perspective of `perspectiveSide`.
 * Positive score favors `perspectiveSide`; negative score favors opponent.
 *
 * @param engine Active XiangqiEngine instance
 * @param perspectiveSide Side from whose perspective the score is returned
 * @param includePst True for Level 2 (Medium) & Level 3 (Hard); False for Level 1 (Easy)
 * @param randomJitter Max random noise in centipawns (used in Level 1 Easy)
 */
export declare function evaluateBoard(engine: XiangqiEngine, perspectiveSide: Side, includePst: boolean, randomJitter?: number): number;
//# sourceMappingURL=ai-evaluation.d.ts.map