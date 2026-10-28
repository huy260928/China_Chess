import { Coordinates, ExecutedMove, GameOutcome, GameStateSnapshot, MoveIntent, Piece, Side } from './types';
export declare const INITIAL_XIANGQI_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
export declare const BOARD_ROWS = 10;
export declare const BOARD_COLS = 9;
/**
 * Deterministic 64-bit Zobrist Hash table generated via SplitMix64 PRNG.
 * Ensures identical hashes across Client, Server, and AI Worker Threads.
 */
declare class ZobristTable {
    readonly pieceKeys: bigint[][][];
    readonly sideKey: bigint;
    constructor();
}
export declare const ZOBRIST: ZobristTable;
export interface FastUndoState {
    from: Coordinates;
    to: Coordinates;
    movedPiece: Piece;
    capturedPiece: Piece | null;
    prevTurn: Side;
    prevHalfMoveClock: number;
    prevFullMoveNumber: number;
    prevZobristKey: bigint;
}
export declare class XiangqiEngine {
    private board;
    private turn;
    private halfMoveClock;
    private fullMoveNumber;
    private zobristKey;
    private positionCounts;
    private positionHashes;
    private moveHistory;
    constructor(fen?: string, existingPositionHashes?: string[], existingMoveHistory?: ExecutedMove[]);
    private createEmptyBoard;
    static validateFen(fen: string): {
        valid: boolean;
        error?: string;
    };
    static charToPiece(ch: string): Piece | null;
    loadFen(fen: string): void;
    generateFen(): string;
    private computeFullZobristKey;
    getZobristKeyBigInt(): bigint;
    getZobristHash(): string;
    isThreefoldRepetition(): boolean;
    getPositionHashes(): string[];
    static isInsideBoard(row: number, col: number): boolean;
    static isInsidePalace(row: number, col: number, side: Side): boolean;
    static isOwnSideOfRiver(row: number, side: Side): boolean;
    static hasCrossedRiver(row: number, side: Side): boolean;
    getBoard(): (Piece | null)[][];
    getRawBoard(): (Piece | null)[][];
    getPieceAt(pos: Coordinates): Piece | null;
    getTurn(): Side;
    getHalfMoveClock(): number;
    getFullMoveNumber(): number;
    getMoveHistory(): ExecutedMove[];
    clone(): XiangqiEngine;
    /**
     * Generates all pseudo-legal moves for a given square without checking whether
     * the move leaves own General in check or causes Flying General.
     */
    getPseudoLegalMovesFrom(row: number, col: number): MoveIntent[];
    /**
     * 1. Tướng (General / King):
     * - Moves 1 step orthogonally (up, down, left, right) within the 3x3 Palace.
     */
    private getGeneralPseudoMoves;
    /**
     * 2. Sĩ (Advisor / Mandarin):
     * - Moves 1 step diagonally within the 3x3 Palace.
     */
    private getAdvisorPseudoMoves;
    /**
     * 3. Tượng (Elephant / Bishop):
     * - Moves exactly 2 points diagonally (hình chữ Điền).
     * - Cannot cross the river (Red stays in rows 5..9, Black stays in rows 0..4).
     * - Cản mắt tượng (Blocking Elephant Eye): Midpoint (row + dr/2, col + dc/2) must be empty.
     */
    private getElephantPseudoMoves;
    /**
     * 4. Mã (Horse / Knight):
     * - Moves 1 step orthogonally then 1 step diagonally outward (hình chữ Nhật).
     * - Cản chân mã (Blocking Horse Leg): Orthogonal adjacent square must be empty.
     */
    private getHorsePseudoMoves;
    /**
     * 5. Xe (Chariot / Rook):
     * - Slides any number of empty squares orthogonally.
     * - Captures the first opponent piece encountered on a ray.
     */
    private getChariotPseudoMoves;
    /**
     * 6. Pháo (Cannon):
     * - Non-capture: Slides orthogonally over empty squares like a Chariot before hitting any piece.
     * - Capture: Must jump over EXACTLY ONE piece (Ngòi pháo / Screen) and capture the first
     *   enemy piece encountered beyond the screen.
     */
    private getCannonPseudoMoves;
    /**
     * 7. Tốt / Binh (Soldier / Pawn):
     * - Before crossing river: Moves 1 step strictly forward.
     * - After crossing river: Moves 1 step forward OR 1 step horizontally (left/right).
     * - Never moves backward.
     */
    private getSoldierPseudoMoves;
    /**
     * Finds the coordinates of the General ('k') for the specified side.
     */
    findGeneral(side: Side): Coordinates | null;
    /**
     * Luật Lộ Mặt Tướng (Flying General Rule):
     * Returns true if Red General and Black General are on the exact same column
     * with zero pieces between them.
     */
    isGeneralsFacing(): boolean;
    /**
     * Determines whether the specified target square is attacked by any piece of `attackerSide`.
     */
    isSquareAttackedBy(targetPos: Coordinates, attackerSide: Side): boolean;
    /**
     * Returns true if the General of `side` is currently in check (bị chiếu tướng)
     * or if the two Generals are illegally facing each other.
     */
    isInCheck(side?: Side): boolean;
    /**
     * Fast in-place move execution with incremental Zobrist hash update.
     * Used by legal move filtering and AI Alpha-Beta search tree.
     */
    makeFastMove(move: MoveIntent): FastUndoState;
    /**
     * Reverts a fast in-place move in O(1) time.
     */
    unmakeFastMove(undo: FastUndoState): void;
    /**
     * Returns all strictly legal moves for a specific square on the board.
     */
    getLegalMovesForSquare(pos: Coordinates, side?: Side): MoveIntent[];
    /**
     * Returns all strictly legal moves for `side` across the entire 9x10 board.
     */
    getLegalMoves(side?: Side): MoveIntent[];
    /**
     * Validates if a MoveIntent from->to is legal for the current active player.
     */
    isValidMove(move: MoveIntent): boolean;
    /**
     * Converts coordinates into ICCS format (e.g. a0..i9 where row 9 is rank 0 for Red).
     */
    static toIccs(from: Coordinates, to: Coordinates): string;
    /**
     * Generates both WXF standard notation (e.g., "C2.5", "N8+7", "+R+2")
     * and Vietnamese Chess Notation (e.g., "Pháo 2 bình 5", "Mã 8 tiến 7", "Tiền Xe tiến 2").
     * Must be called BEFORE the move is committed to the board.
     */
    generateMoveNotations(move: MoveIntent): {
        wxf: string;
        vietnamese: string;
    };
    /**
     * Checks if neither side has any attacking pieces left (only Generals, Advisors, Elephants).
     */
    isInsufficientMaterial(): boolean;
    /**
     * Evaluates complete game outcome for the current board state:
     * - CHECKMATE (Tuyệt sát / Chiếu bí): Active player is in check and has 0 legal moves -> Opponent wins.
     * - STALEMATE (Hết nước đi): Active player is NOT in check and has 0 legal moves -> In Xiangqi, active player LOSES!
     * - DRAW_REPETITION: Same Zobrist hash occurred >= 3 times.
     * - DRAW_FIFTY_MOVE: 120 half-moves (60 full moves) without capture or pawn advance.
     * - DRAW_INSUFFICIENT_MATERIAL: Neither side has any R, N, C, or P remaining.
     */
    getGameOutcome(): GameOutcome;
    /**
     * Validates and executes a move on the engine, recording full WXF/Vietnamese/ICCS notation,
     * Zobrist hash history, check/checkmate/stalemate flags, and returning the ExecutedMove record.
     */
    makeMove(moveIntent: MoveIntent): ExecutedMove;
    /**
     * Undoes the last committed move from `moveHistory`.
     */
    undoLastMove(): ExecutedMove | null;
    /**
     * Returns a complete serializable snapshot of the current game state.
     */
    getStateSnapshot(): GameStateSnapshot;
}
export {};
//# sourceMappingURL=xiangqi-engine.d.ts.map