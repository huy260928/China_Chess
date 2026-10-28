// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - CORE XIANGQI ENGINE (100% FULL RULESET)
// ============================================================================

import {
  Coordinates,
  ExecutedMove,
  FenPieceChar,
  GameEndReason,
  GameOutcome,
  GameStateSnapshot,
  MoveIntent,
  Piece,
  PieceType,
  Side,
} from './types';

export const INITIAL_XIANGQI_FEN =
  'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

export const BOARD_ROWS = 10;
export const BOARD_COLS = 9;

const PIECE_INDEX_MAP: Record<FenPieceChar, number> = {
  K: 0,
  A: 1,
  B: 2,
  N: 3,
  R: 4,
  C: 5,
  P: 6,
  k: 7,
  a: 8,
  b: 9,
  n: 10,
  r: 11,
  c: 12,
  p: 13,
};

const VIETNAMESE_PIECE_NAMES: Record<PieceType, string> = {
  k: 'Tướng',
  a: 'Sĩ',
  b: 'Tượng',
  n: 'Mã',
  r: 'Xe',
  c: 'Pháo',
  p: 'Tốt',
};

/**
 * Deterministic 64-bit Zobrist Hash table generated via SplitMix64 PRNG.
 * Ensures identical hashes across Client, Server, and AI Worker Threads.
 */
class ZobristTable {
  public readonly pieceKeys: bigint[][][]; // [row 0..9][col 0..8][pieceIdx 0..13]
  public readonly sideKey: bigint;

  constructor() {
    let seed = 0x9e3779b97f4a7c15n;
    const nextRand64 = (): bigint => {
      seed = (seed + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
      let z = seed;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
      return (z ^ (z >> 31n)) & 0xffffffffffffffffn;
    };

    this.pieceKeys = [];
    for (let r = 0; r < BOARD_ROWS; r++) {
      this.pieceKeys[r] = [];
      for (let c = 0; c < BOARD_COLS; c++) {
        this.pieceKeys[r][c] = [];
        for (let p = 0; p < 14; p++) {
          this.pieceKeys[r][c][p] = nextRand64();
        }
      }
    }
    this.sideKey = nextRand64();
  }
}

export const ZOBRIST = new ZobristTable();

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

export class XiangqiEngine {
  private board: (Piece | null)[][];
  private turn: Side;
  private halfMoveClock: number;
  private fullMoveNumber: number;
  private zobristKey: bigint;
  private positionCounts: Map<string, number>;
  private positionHashes: string[];
  private moveHistory: ExecutedMove[];

  constructor(
    fen: string = INITIAL_XIANGQI_FEN,
    existingPositionHashes?: string[],
    existingMoveHistory?: ExecutedMove[]
  ) {
    this.board = this.createEmptyBoard();
    this.turn = 'w';
    this.halfMoveClock = 0;
    this.fullMoveNumber = 1;
    this.zobristKey = 0n;
    this.positionCounts = new Map<string, number>();
    this.positionHashes = [];
    this.moveHistory = existingMoveHistory ? [...existingMoveHistory] : [];

    this.loadFen(fen);

    if (existingPositionHashes && existingPositionHashes.length > 0) {
      this.positionHashes = [...existingPositionHashes];
      this.positionCounts.clear();
      for (const h of this.positionHashes) {
        this.positionCounts.set(h, (this.positionCounts.get(h) ?? 0) + 1);
      }
    }
  }

  private createEmptyBoard(): (Piece | null)[][] {
    return Array.from({ length: BOARD_ROWS }, () =>
      Array.from({ length: BOARD_COLS }, () => null)
    );
  }

  // ==========================================================================
  // FEN PARSER, VALIDATOR & GENERATOR
  // ==========================================================================

  public static validateFen(fen: string): { valid: boolean; error?: string } {
    if (!fen || typeof fen !== 'string') {
      return { valid: false, error: 'FEN string must be non-empty.' };
    }
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 2) {
      return { valid: false, error: 'FEN must contain at least board layout and active side.' };
    }

    const [boardPart, sidePart] = parts;
    const ranks = boardPart.split('/');
    if (ranks.length !== BOARD_ROWS) {
      return { valid: false, error: `FEN must have exactly 10 ranks, found ${ranks.length}.` };
    }

    let redGenerals = 0;
    let blackGenerals = 0;

    for (let r = 0; r < BOARD_ROWS; r++) {
      let col = 0;
      for (const ch of ranks[r]) {
        if (ch >= '1' && ch <= '9') {
          col += parseInt(ch, 10);
        } else {
          const piece = XiangqiEngine.charToPiece(ch);
          if (!piece) {
            return { valid: false, error: `Invalid FEN piece character '${ch}' at rank ${r + 1}.` };
          }
          if (piece.type === 'k') {
            if (piece.side === 'w') {
              redGenerals++;
              if (!XiangqiEngine.isInsidePalace(r, col, 'w')) {
                return { valid: false, error: 'Red General (K) must be inside Red palace.' };
              }
            } else {
              blackGenerals++;
              if (!XiangqiEngine.isInsidePalace(r, col, 'b')) {
                return { valid: false, error: 'Black General (k) must be inside Black palace.' };
              }
            }
          }
          col++;
        }
      }
      if (col !== BOARD_COLS) {
        return {
          valid: false,
          error: `Rank ${r + 1} in FEN has ${col} columns instead of ${BOARD_COLS}.`,
        };
      }
    }

    if (redGenerals !== 1 || blackGenerals !== 1) {
      return {
        valid: false,
        error: `FEN must contain exactly 1 Red General and 1 Black General (found K=${redGenerals}, k=${blackGenerals}).`,
      };
    }

    const normalizedSide = sidePart.toLowerCase();
    if (normalizedSide !== 'w' && normalizedSide !== 'r' && normalizedSide !== 'b') {
      return { valid: false, error: `Invalid active side '${sidePart}' in FEN.` };
    }

    return { valid: true };
  }

  public static charToPiece(ch: string): Piece | null {
    const isUpper = ch === ch.toUpperCase();
    const side: Side = isUpper ? 'w' : 'b';
    const lower = ch.toLowerCase();

    let canonicalType: PieceType;
    switch (lower) {
      case 'k':
        canonicalType = 'k';
        break;
      case 'a':
        canonicalType = 'a';
        break;
      case 'b':
      case 'e':
        canonicalType = 'b';
        break;
      case 'n':
      case 'h':
        canonicalType = 'n';
        break;
      case 'r':
        canonicalType = 'r';
        break;
      case 'c':
        canonicalType = 'c';
        break;
      case 'p':
        canonicalType = 'p';
        break;
      default:
        return null;
    }

    const fenChar = (isUpper ? canonicalType.toUpperCase() : canonicalType) as FenPieceChar;
    return {
      type: canonicalType,
      side,
      fenChar,
    };
  }

  public loadFen(fen: string): void {
    const validation = XiangqiEngine.validateFen(fen);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid Xiangqi FEN');
    }

    const parts = fen.trim().split(/\s+/);
    const boardPart = parts[0];
    const sidePart = parts[1].toLowerCase();
    const halfMovePart = parts.length >= 5 ? parseInt(parts[4], 10) : 0;
    const fullMovePart = parts.length >= 6 ? parseInt(parts[5], 10) : 1;

    this.board = this.createEmptyBoard();
    const ranks = boardPart.split('/');

    for (let r = 0; r < BOARD_ROWS; r++) {
      let c = 0;
      for (const ch of ranks[r]) {
        if (ch >= '1' && ch <= '9') {
          c += parseInt(ch, 10);
        } else {
          const piece = XiangqiEngine.charToPiece(ch);
          this.board[r][c] = piece;
          c++;
        }
      }
    }

    this.turn = sidePart === 'b' ? 'b' : 'w';
    this.halfMoveClock = Number.isNaN(halfMovePart) ? 0 : Math.max(0, halfMovePart);
    this.fullMoveNumber = Number.isNaN(fullMovePart) ? 1 : Math.max(1, fullMovePart);

    this.zobristKey = this.computeFullZobristKey();
    const hashHex = this.getZobristHash();
    this.positionHashes = [hashHex];
    this.positionCounts.clear();
    this.positionCounts.set(hashHex, 1);
  }

  public generateFen(): string {
    const rankStrings: string[] = [];
    for (let r = 0; r < BOARD_ROWS; r++) {
      let emptyCount = 0;
      let rankStr = '';
      for (let c = 0; c < BOARD_COLS; c++) {
        const piece = this.board[r][c];
        if (!piece) {
          emptyCount++;
        } else {
          if (emptyCount > 0) {
            rankStr += emptyCount.toString();
            emptyCount = 0;
          }
          rankStr += piece.fenChar;
        }
      }
      if (emptyCount > 0) {
        rankStr += emptyCount.toString();
      }
      rankStrings.push(rankStr);
    }

    return `${rankStrings.join('/')} ${this.turn} - - ${this.halfMoveClock} ${this.fullMoveNumber}`;
  }

  // ==========================================================================
  // ZOBRIST HASHING & REPETITION TRACKING
  // ==========================================================================

  private computeFullZobristKey(): bigint {
    let key = 0n;
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        const piece = this.board[r][c];
        if (piece) {
          const idx = PIECE_INDEX_MAP[piece.fenChar];
          key ^= ZOBRIST.pieceKeys[r][c][idx];
        }
      }
    }
    if (this.turn === 'b') {
      key ^= ZOBRIST.sideKey;
    }
    return key;
  }

  public getZobristKeyBigInt(): bigint {
    return this.zobristKey;
  }

  public getZobristHash(): string {
    return this.zobristKey.toString(16).padStart(16, '0');
  }

  public isThreefoldRepetition(): boolean {
    const currentHash = this.getZobristHash();
    return (this.positionCounts.get(currentHash) ?? 0) >= 3;
  }

  public getPositionHashes(): string[] {
    return [...this.positionHashes];
  }

  // ==========================================================================
  // BOARD GEOMETRY & PALACE / RIVER HELPERS
  // ==========================================================================

  public static isInsideBoard(row: number, col: number): boolean {
    return row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS;
  }

  public static isInsidePalace(row: number, col: number, side: Side): boolean {
    if (col < 3 || col > 5) return false;
    return side === 'w' ? row >= 7 && row <= 9 : row >= 0 && row <= 2;
  }

  public static isOwnSideOfRiver(row: number, side: Side): boolean {
    return side === 'w' ? row >= 5 && row <= 9 : row >= 0 && row <= 4;
  }

  public static hasCrossedRiver(row: number, side: Side): boolean {
    return side === 'w' ? row <= 4 : row >= 5;
  }

  public getBoard(): (Piece | null)[][] {
    return this.board.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
  }

  public getRawBoard(): (Piece | null)[][] {
    return this.board;
  }

  public getPieceAt(pos: Coordinates): Piece | null {
    if (!XiangqiEngine.isInsideBoard(pos.row, pos.col)) return null;
    const p = this.board[pos.row][pos.col];
    return p ? { ...p } : null;
  }

  public getTurn(): Side {
    return this.turn;
  }

  public getHalfMoveClock(): number {
    return this.halfMoveClock;
  }

  public getFullMoveNumber(): number {
    return this.fullMoveNumber;
  }

  public getMoveHistory(): ExecutedMove[] {
    return [...this.moveHistory];
  }

  public clone(): XiangqiEngine {
    return new XiangqiEngine(this.generateFen(), this.positionHashes, this.moveHistory);
  }

  // ==========================================================================
  // PSEUDO-LEGAL MOVE GENERATION FOR ALL 7 XIANGQI PIECE TYPES
  // ==========================================================================

  /**
   * Generates all pseudo-legal moves for a given square without checking whether
   * the move leaves own General in check or causes Flying General.
   */
  public getPseudoLegalMovesFrom(row: number, col: number): MoveIntent[] {
    const piece = this.board[row][col];
    if (!piece) return [];

    switch (piece.type) {
      case 'k':
        return this.getGeneralPseudoMoves(row, col, piece.side);
      case 'a':
        return this.getAdvisorPseudoMoves(row, col, piece.side);
      case 'b':
        return this.getElephantPseudoMoves(row, col, piece.side);
      case 'n':
        return this.getHorsePseudoMoves(row, col, piece.side);
      case 'r':
        return this.getChariotPseudoMoves(row, col, piece.side);
      case 'c':
        return this.getCannonPseudoMoves(row, col, piece.side);
      case 'p':
        return this.getSoldierPseudoMoves(row, col, piece.side);
    }
  }

  /**
   * 1. Tướng (General / King):
   * - Moves 1 step orthogonally (up, down, left, right) within the 3x3 Palace.
   */
  private getGeneralPseudoMoves(row: number, col: number, side: Side): MoveIntent[] {
    const moves: MoveIntent[] = [];
    const dirs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];

    for (const [dr, dc] of dirs) {
      const nr = row + dr;
      const nc = col + dc;
      if (XiangqiEngine.isInsidePalace(nr, nc, side)) {
        const target = this.board[nr][nc];
        if (!target || target.side !== side) {
          moves.push({ from: { row, col }, to: { row: nr, col: nc } });
        }
      }
    }
    return moves;
  }

  /**
   * 2. Sĩ (Advisor / Mandarin):
   * - Moves 1 step diagonally within the 3x3 Palace.
   */
  private getAdvisorPseudoMoves(row: number, col: number, side: Side): MoveIntent[] {
    const moves: MoveIntent[] = [];
    const dirs = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ];

    for (const [dr, dc] of dirs) {
      const nr = row + dr;
      const nc = col + dc;
      if (XiangqiEngine.isInsidePalace(nr, nc, side)) {
        const target = this.board[nr][nc];
        if (!target || target.side !== side) {
          moves.push({ from: { row, col }, to: { row: nr, col: nc } });
        }
      }
    }
    return moves;
  }

  /**
   * 3. Tượng (Elephant / Bishop):
   * - Moves exactly 2 points diagonally (hình chữ Điền).
   * - Cannot cross the river (Red stays in rows 5..9, Black stays in rows 0..4).
   * - Cản mắt tượng (Blocking Elephant Eye): Midpoint (row + dr/2, col + dc/2) must be empty.
   */
  private getElephantPseudoMoves(row: number, col: number, side: Side): MoveIntent[] {
    const moves: MoveIntent[] = [];
    const deltas = [
      [-2, -2],
      [-2, 2],
      [2, -2],
      [2, 2],
    ];

    for (const [dr, dc] of deltas) {
      const nr = row + dr;
      const nc = col + dc;
      if (
        XiangqiEngine.isInsideBoard(nr, nc) &&
        XiangqiEngine.isOwnSideOfRiver(nr, side)
      ) {
        const eyeRow = row + dr / 2;
        const eyeCol = col + dc / 2;
        // Luật Cản mắt tượng: Ô mắt tượng phải trống
        if (this.board[eyeRow][eyeCol] === null) {
          const target = this.board[nr][nc];
          if (!target || target.side !== side) {
            moves.push({ from: { row, col }, to: { row: nr, col: nc } });
          }
        }
      }
    }
    return moves;
  }

  /**
   * 4. Mã (Horse / Knight):
   * - Moves 1 step orthogonally then 1 step diagonally outward (hình chữ Nhật).
   * - Cản chân mã (Blocking Horse Leg): Orthogonal adjacent square must be empty.
   */
  private getHorsePseudoMoves(row: number, col: number, side: Side): MoveIntent[] {
    const moves: MoveIntent[] = [];
    const horseSteps: Array<{ leg: [number, number]; dest: [number, number] }> = [
      { leg: [-1, 0], dest: [-2, -1] },
      { leg: [-1, 0], dest: [-2, 1] },
      { leg: [1, 0], dest: [2, -1] },
      { leg: [1, 0], dest: [2, 1] },
      { leg: [0, -1], dest: [-1, -2] },
      { leg: [0, -1], dest: [1, -2] },
      { leg: [0, 1], dest: [-1, 2] },
      { leg: [0, 1], dest: [1, 2] },
    ];

    for (const step of horseSteps) {
      const legRow = row + step.leg[0];
      const legCol = col + step.leg[1];
      const destRow = row + step.dest[0];
      const destCol = col + step.dest[1];

      if (XiangqiEngine.isInsideBoard(destRow, destCol)) {
        // Luật Cản chân mã: Ô chân mã phải trống
        if (this.board[legRow][legCol] === null) {
          const target = this.board[destRow][destCol];
          if (!target || target.side !== side) {
            moves.push({ from: { row, col }, to: { row: destRow, col: destCol } });
          }
        }
      }
    }
    return moves;
  }

  /**
   * 5. Xe (Chariot / Rook):
   * - Slides any number of empty squares orthogonally.
   * - Captures the first opponent piece encountered on a ray.
   */
  private getChariotPseudoMoves(row: number, col: number, side: Side): MoveIntent[] {
    const moves: MoveIntent[] = [];
    const dirs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];

    for (const [dr, dc] of dirs) {
      let nr = row + dr;
      let nc = col + dc;
      while (XiangqiEngine.isInsideBoard(nr, nc)) {
        const target = this.board[nr][nc];
        if (!target) {
          moves.push({ from: { row, col }, to: { row: nr, col: nc } });
        } else {
          if (target.side !== side) {
            moves.push({ from: { row, col }, to: { row: nr, col: nc } });
          }
          break;
        }
        nr += dr;
        nc += dc;
      }
    }
    return moves;
  }

  /**
   * 6. Pháo (Cannon):
   * - Non-capture: Slides orthogonally over empty squares like a Chariot before hitting any piece.
   * - Capture: Must jump over EXACTLY ONE piece (Ngòi pháo / Screen) and capture the first
   *   enemy piece encountered beyond the screen.
   */
  private getCannonPseudoMoves(row: number, col: number, side: Side): MoveIntent[] {
    const moves: MoveIntent[] = [];
    const dirs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];

    for (const [dr, dc] of dirs) {
      let nr = row + dr;
      let nc = col + dc;
      let screenFound = false;

      while (XiangqiEngine.isInsideBoard(nr, nc)) {
        const target = this.board[nr][nc];
        if (!screenFound) {
          if (!target) {
            // Di chuyển không ăn quân
            moves.push({ from: { row, col }, to: { row: nr, col: nc } });
          } else {
            // Gặp đúng 1 quân cản làm Ngòi pháo
            screenFound = true;
          }
        } else {
          if (target) {
            // Quân đầu tiên sau ngòi pháo: nếu của đối phương thì ăn được, sau đó dừng quét hướng này
            if (target.side !== side) {
              moves.push({ from: { row, col }, to: { row: nr, col: nc } });
            }
            break;
          }
        }
        nr += dr;
        nc += dc;
      }
    }
    return moves;
  }

  /**
   * 7. Tốt / Binh (Soldier / Pawn):
   * - Before crossing river: Moves 1 step strictly forward.
   * - After crossing river: Moves 1 step forward OR 1 step horizontally (left/right).
   * - Never moves backward.
   */
  private getSoldierPseudoMoves(row: number, col: number, side: Side): MoveIntent[] {
    const moves: MoveIntent[] = [];
    const forwardDir = side === 'w' ? -1 : 1;

    // 1 bước tiến thẳng
    const forwardRow = row + forwardDir;
    if (XiangqiEngine.isInsideBoard(forwardRow, col)) {
      const target = this.board[forwardRow][col];
      if (!target || target.side !== side) {
        moves.push({ from: { row, col }, to: { row: forwardRow, col } });
      }
    }

    // Nếu đã qua sông, được đi ngang trái/phải 1 ô
    if (XiangqiEngine.hasCrossedRiver(row, side)) {
      for (const dc of [-1, 1]) {
        const sideCol = col + dc;
        if (XiangqiEngine.isInsideBoard(row, sideCol)) {
          const target = this.board[row][sideCol];
          if (!target || target.side !== side) {
            moves.push({ from: { row, col }, to: { row, col: sideCol } });
          }
        }
      }
    }

    return moves;
  }

  // ==========================================================================
  // FLYING GENERAL (LỘ MẶT TƯỚNG) & IN-CHECK (CHIẾU TƯỚNG) DETECTION
  // ==========================================================================

  /**
   * Finds the coordinates of the General ('k') for the specified side.
   */
  public findGeneral(side: Side): Coordinates | null {
    const minRow = side === 'w' ? 7 : 0;
    const maxRow = side === 'w' ? 9 : 2;

    // Fast lookup inside the 3x3 palace first
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = 3; c <= 5; c++) {
        const p = this.board[r][c];
        if (p && p.type === 'k' && p.side === side) {
          return { row: r, col: c };
        }
      }
    }

    // Fallback full-board scan
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        const p = this.board[r][c];
        if (p && p.type === 'k' && p.side === side) {
          return { row: r, col: c };
        }
      }
    }
    return null;
  }

  /**
   * Luật Lộ Mặt Tướng (Flying General Rule):
   * Returns true if Red General and Black General are on the exact same column
   * with zero pieces between them.
   */
  public isGeneralsFacing(): boolean {
    const redGen = this.findGeneral('w');
    const blackGen = this.findGeneral('b');
    if (!redGen || !blackGen) return false;
    if (redGen.col !== blackGen.col) return false;

    const minR = Math.min(redGen.row, blackGen.row);
    const maxR = Math.max(redGen.row, blackGen.row);

    for (let r = minR + 1; r < maxR; r++) {
      if (this.board[r][redGen.col] !== null) {
        return false;
      }
    }
    return true;
  }

  /**
   * Determines whether the specified target square is attacked by any piece of `attackerSide`.
   */
  public isSquareAttackedBy(targetPos: Coordinates, attackerSide: Side): boolean {
    const { row: tr, col: tc } = targetPos;

    // 1. Kiểm tra Xe (Chariot), Pháo (Cannon) và Lộ mặt Tướng (General) theo 4 hướng ngang dọc
    const orthoDirs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];

    for (const [dr, dc] of orthoDirs) {
      let nr = tr + dr;
      let nc = tc + dc;
      let screenCount = 0;
      let stepDistance = 1;

      while (XiangqiEngine.isInsideBoard(nr, nc)) {
        const p = this.board[nr][nc];
        if (p) {
          if (screenCount === 0) {
            if (p.side === attackerSide) {
              // Xe ăn trực tiếp trên đường thẳng không bị cản
              if (p.type === 'r') return true;
              // Tướng ăn trực tiếp 1 ô trong cung hoặc Lộ mặt tướng trên cùng cột
              if (p.type === 'k') {
                if (stepDistance === 1 && XiangqiEngine.isInsidePalace(tr, tc, attackerSide)) {
                  return true;
                }
                if (dc === 0) {
                  return true;
                }
              }
            }
            screenCount = 1;
          } else if (screenCount === 1) {
            // Đã có đúng 1 ngòi: kiểm tra Pháo đối phương
            if (p.side === attackerSide && p.type === 'c') {
              return true;
            }
            break;
          }
        }
        nr += dr;
        nc += dc;
        stepDistance++;
      }
    }

    // 2. Kiểm tra Mã (Horse) của đối phương tấn công vào ô (tr, tc)
    // Nếu có Mã đối phương ở (tr + hr, tc + hc), chân mã của nó nằm ở (tr + hr - sign(hr), tc + hc - sign(hc))
    const horseAttackOffsets: Array<{ horseOffset: [number, number]; legOffset: [number, number] }> = [
      { horseOffset: [-2, -1], legOffset: [-1, -1] },
      { horseOffset: [-2, 1], legOffset: [-1, 1] },
      { horseOffset: [2, -1], legOffset: [1, -1] },
      { horseOffset: [2, 1], legOffset: [1, 1] },
      { horseOffset: [-1, -2], legOffset: [-1, -1] },
      { horseOffset: [1, -2], legOffset: [1, -1] },
      { horseOffset: [-1, 2], legOffset: [-1, 1] },
      { horseOffset: [1, 2], legOffset: [1, 1] },
    ];

    for (const { horseOffset, legOffset } of horseAttackOffsets) {
      const hr = tr + horseOffset[0];
      const hc = tc + horseOffset[1];
      if (XiangqiEngine.isInsideBoard(hr, hc)) {
        const p = this.board[hr][hc];
        if (p && p.side === attackerSide && p.type === 'n') {
          const legR = tr + legOffset[0];
          const legC = tc + legOffset[1];
          if (this.board[legR][legC] === null) {
            return true;
          }
        }
      }
    }

    // 3. Kiểm tra Tốt (Soldier) của đối phương tấn công vào ô (tr, tc)
    // Nếu attackerSide === 'w' (Đỏ đi từ dưới lên, hướng -1), Tốt Đỏ tấn công (tr, tc) từ (tr + 1, tc),
    // hoặc từ (tr, tc ± 1) nếu Tốt Đỏ đã qua sông (tr <= 4).
    const attackerForward = attackerSide === 'w' ? -1 : 1;
    const pawnBehindRow = tr - attackerForward;
    if (XiangqiEngine.isInsideBoard(pawnBehindRow, tc)) {
      const p = this.board[pawnBehindRow][tc];
      if (p && p.side === attackerSide && p.type === 'p') {
        return true;
      }
    }
    if (XiangqiEngine.hasCrossedRiver(tr, attackerSide)) {
      for (const dc of [-1, 1]) {
        const sc = tc + dc;
        if (XiangqiEngine.isInsideBoard(tr, sc)) {
          const p = this.board[tr][sc];
          if (p && p.side === attackerSide && p.type === 'p') {
            return true;
          }
        }
      }
    }

    // 4. Kiểm tra Sĩ (Advisor) và Tượng (Elephant) phòng trường hợp kiểm tra ô bất kỳ trên bàn cờ
    const diagDirs = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ];
    if (XiangqiEngine.isInsidePalace(tr, tc, attackerSide)) {
      for (const [dr, dc] of diagDirs) {
        const ar = tr + dr;
        const ac = tc + dc;
        if (XiangqiEngine.isInsidePalace(ar, ac, attackerSide)) {
          const p = this.board[ar][ac];
          if (p && p.side === attackerSide && p.type === 'a') {
            return true;
          }
        }
      }
    }
    if (XiangqiEngine.isOwnSideOfRiver(tr, attackerSide)) {
      for (const [dr, dc] of diagDirs) {
        const er = tr + dr * 2;
        const ec = tc + dc * 2;
        const eyeR = tr + dr;
        const eyeC = tc + dc;
        if (
          XiangqiEngine.isInsideBoard(er, ec) &&
          XiangqiEngine.isOwnSideOfRiver(er, attackerSide) &&
          this.board[eyeR][eyeC] === null
        ) {
          const p = this.board[er][ec];
          if (p && p.side === attackerSide && p.type === 'b') {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Returns true if the General of `side` is currently in check (bị chiếu tướng)
   * or if the two Generals are illegally facing each other.
   */
  public isInCheck(side: Side = this.turn): boolean {
    const genPos = this.findGeneral(side);
    if (!genPos) return true;
    const opponent: Side = side === 'w' ? 'b' : 'w';
    return this.isSquareAttackedBy(genPos, opponent);
  }

  // ==========================================================================
  // LEGAL MOVE VALIDATION & FAST MAKE/UNMAKE (FOR AI & ENGINE)
  // ==========================================================================

  /**
   * Fast in-place move execution with incremental Zobrist hash update.
   * Used by legal move filtering and AI Alpha-Beta search tree.
   */
  public makeFastMove(move: MoveIntent): FastUndoState {
    const { from, to } = move;
    const movedPiece = this.board[from.row][from.col]!;
    const capturedPiece = this.board[to.row][to.col];

    const undoState: FastUndoState = {
      from,
      to,
      movedPiece,
      capturedPiece,
      prevTurn: this.turn,
      prevHalfMoveClock: this.halfMoveClock,
      prevFullMoveNumber: this.fullMoveNumber,
      prevZobristKey: this.zobristKey,
    };

    // Incremental Zobrist update: XOR out movedPiece at from
    const movedIdx = PIECE_INDEX_MAP[movedPiece.fenChar];
    this.zobristKey ^= ZOBRIST.pieceKeys[from.row][from.col][movedIdx];

    // XOR out capturedPiece at to (if any)
    if (capturedPiece) {
      const capIdx = PIECE_INDEX_MAP[capturedPiece.fenChar];
      this.zobristKey ^= ZOBRIST.pieceKeys[to.row][to.col][capIdx];
    }

    // XOR in movedPiece at to
    this.zobristKey ^= ZOBRIST.pieceKeys[to.row][to.col][movedIdx];

    // Toggle side key
    this.zobristKey ^= ZOBRIST.sideKey;

    // Update board cells
    this.board[to.row][to.col] = movedPiece;
    this.board[from.row][from.col] = null;

    // Update clocks & turn
    if (capturedPiece || movedPiece.type === 'p') {
      this.halfMoveClock = 0;
    } else {
      this.halfMoveClock++;
    }

    if (this.turn === 'b') {
      this.fullMoveNumber++;
    }
    this.turn = this.turn === 'w' ? 'b' : 'w';

    return undoState;
  }

  /**
   * Reverts a fast in-place move in O(1) time.
   */
  public unmakeFastMove(undo: FastUndoState): void {
    this.board[undo.from.row][undo.from.col] = undo.movedPiece;
    this.board[undo.to.row][undo.to.col] = undo.capturedPiece;
    this.turn = undo.prevTurn;
    this.halfMoveClock = undo.prevHalfMoveClock;
    this.fullMoveNumber = undo.prevFullMoveNumber;
    this.zobristKey = undo.prevZobristKey;
  }

  /**
   * Returns all strictly legal moves for a specific square on the board.
   */
  public getLegalMovesForSquare(pos: Coordinates, side: Side = this.turn): MoveIntent[] {
    if (!XiangqiEngine.isInsideBoard(pos.row, pos.col)) return [];
    const piece = this.board[pos.row][pos.col];
    if (!piece || piece.side !== side) return [];

    const pseudoMoves = this.getPseudoLegalMovesFrom(pos.row, pos.col);
    const legalMoves: MoveIntent[] = [];

    for (const move of pseudoMoves) {
      const undo = this.makeFastMove(move);
      const illegal = this.isGeneralsFacing() || this.isInCheck(side);
      this.unmakeFastMove(undo);

      if (!illegal) {
        legalMoves.push(move);
      }
    }

    return legalMoves;
  }

  /**
   * Returns all strictly legal moves for `side` across the entire 9x10 board.
   */
  public getLegalMoves(side: Side = this.turn): MoveIntent[] {
    const allLegalMoves: MoveIntent[] = [];
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        const p = this.board[r][c];
        if (p && p.side === side) {
          const squareMoves = this.getLegalMovesForSquare({ row: r, col: c }, side);
          for (const m of squareMoves) {
            allLegalMoves.push(m);
          }
        }
      }
    }
    return allLegalMoves;
  }

  /**
   * Validates if a MoveIntent from->to is legal for the current active player.
   */
  public isValidMove(move: MoveIntent): boolean {
    if (
      !XiangqiEngine.isInsideBoard(move.from.row, move.from.col) ||
      !XiangqiEngine.isInsideBoard(move.to.row, move.to.col)
    ) {
      return false;
    }
    const piece = this.board[move.from.row][move.from.col];
    if (!piece || piece.side !== this.turn) {
      return false;
    }
    const legalMoves = this.getLegalMovesForSquare(move.from, this.turn);
    return legalMoves.some(
      (m) => m.to.row === move.to.row && m.to.col === move.to.col
    );
  }

  // ==========================================================================
  // NOTATION GENERATORS (WXF, VIETNAMESE TRADITIONAL, ICCS)
  // ==========================================================================

  /**
   * Converts coordinates into ICCS format (e.g. a0..i9 where row 9 is rank 0 for Red).
   */
  public static toIccs(from: Coordinates, to: Coordinates): string {
    const fileFrom = String.fromCharCode(97 + from.col);
    const rankFrom = (9 - from.row).toString();
    const fileTo = String.fromCharCode(97 + to.col);
    const rankTo = (9 - to.row).toString();
    return `${fileFrom}${rankFrom}${fileTo}${rankTo}`;
  }

  /**
   * Generates both WXF standard notation (e.g., "C2.5", "N8+7", "+R+2")
   * and Vietnamese Chess Notation (e.g., "Pháo 2 bình 5", "Mã 8 tiến 7", "Tiền Xe tiến 2").
   * Must be called BEFORE the move is committed to the board.
   */
  public generateMoveNotations(move: MoveIntent): { wxf: string; vietnamese: string } {
    const { from, to } = move;
    const piece = this.board[from.row][from.col];
    if (!piece) {
      throw new Error('Cannot generate notation for empty origin square.');
    }

    const side = piece.side;
    // File numbering: Red counts 1..9 from right to left (9 - col), Black counts 1..9 from left to right (col + 1)
    const fromFileNum = side === 'w' ? 9 - from.col : from.col + 1;
    const toFileNum = side === 'w' ? 9 - to.col : to.col + 1;

    // Check if there is another identical piece of the same side on the same column for disambiguation
    const sameFileRows: number[] = [];
    for (let r = 0; r < BOARD_ROWS; r++) {
      const p = this.board[r][from.col];
      if (p && p.side === side && p.type === piece.type) {
        sameFileRows.push(r);
      }
    }

    let prefixWxf = `${piece.type.toUpperCase()}${fromFileNum}`;
    let prefixVn = `${VIETNAMESE_PIECE_NAMES[piece.type]} ${fromFileNum}`;

    if (sameFileRows.length >= 2) {
      // For Red ('w'), smaller row index is further forward ("Tiền" / '+').
      // For Black ('b'), larger row index is further forward ("Tiền" / '+').
      const isFrontmost =
        side === 'w'
          ? from.row === Math.min(...sameFileRows)
          : from.row === Math.max(...sameFileRows);

      prefixWxf = `${isFrontmost ? '+' : '-'}${piece.type.toUpperCase()}`;
      prefixVn = `${isFrontmost ? 'Tiền' : 'Hậu'} ${VIETNAMESE_PIECE_NAMES[piece.type]}`;
    }

    let dirWxf: string;
    let dirVn: string;
    if (to.row === from.row) {
      dirWxf = '.';
      dirVn = 'bình';
    } else {
      const isAdvancing = side === 'w' ? to.row < from.row : to.row > from.row;
      dirWxf = isAdvancing ? '+' : '-';
      dirVn = isAdvancing ? 'tiến' : 'thoái';
    }

    const isDiagonalPiece = piece.type === 'a' || piece.type === 'b' || piece.type === 'n';
    const fourthNumber =
      to.row === from.row || isDiagonalPiece ? toFileNum : Math.abs(to.row - from.row);

    const wxf = `${prefixWxf}${dirWxf}${fourthNumber}`;
    const vietnamese = `${prefixVn} ${dirVn} ${fourthNumber}`;

    return { wxf, vietnamese };
  }

  // ==========================================================================
  // ENDGAME DETECTION: CHECKMATE, STALEMATE, REPETITION, INSUFFICIENT MATERIAL
  // ==========================================================================

  /**
   * Checks if neither side has any attacking pieces left (only Generals, Advisors, Elephants).
   */
  public isInsufficientMaterial(): boolean {
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        const p = this.board[r][c];
        if (p && (p.type === 'r' || p.type === 'n' || p.type === 'c' || p.type === 'p')) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Evaluates complete game outcome for the current board state:
   * - CHECKMATE (Tuyệt sát / Chiếu bí): Active player is in check and has 0 legal moves -> Opponent wins.
   * - STALEMATE (Hết nước đi): Active player is NOT in check and has 0 legal moves -> In Xiangqi, active player LOSES!
   * - DRAW_REPETITION: Same Zobrist hash occurred >= 3 times.
   * - DRAW_FIFTY_MOVE: 120 half-moves (60 full moves) without capture or pawn advance.
   * - DRAW_INSUFFICIENT_MATERIAL: Neither side has any R, N, C, or P remaining.
   */
  public getGameOutcome(): GameOutcome {
    const activeSide = this.turn;
    const opponentSide: Side = activeSide === 'w' ? 'b' : 'w';
    const inCheck = this.isInCheck(activeSide);
    const checkedGeneralPos = inCheck ? this.findGeneral(activeSide) : null;
    const legalMoves = this.getLegalMoves(activeSide);

    if (legalMoves.length === 0) {
      const reason: GameEndReason = inCheck ? 'CHECKMATE' : 'STALEMATE';
      return {
        isOver: true,
        winner: opponentSide,
        reason,
        inCheck,
        checkedGeneralPos,
      };
    }

    if (this.isThreefoldRepetition()) {
      return {
        isOver: true,
        winner: 'draw',
        reason: 'DRAW_REPETITION',
        inCheck,
        checkedGeneralPos,
      };
    }

    if (this.halfMoveClock >= 120) {
      return {
        isOver: true,
        winner: 'draw',
        reason: 'DRAW_FIFTY_MOVE',
        inCheck,
        checkedGeneralPos,
      };
    }

    if (this.isInsufficientMaterial()) {
      return {
        isOver: true,
        winner: 'draw',
        reason: 'DRAW_INSUFFICIENT_MATERIAL',
        inCheck,
        checkedGeneralPos,
      };
    }

    return {
      isOver: false,
      winner: null,
      reason: null,
      inCheck,
      checkedGeneralPos,
    };
  }

  // ==========================================================================
  // AUTHORITATIVE MOVE EXECUTION & STATE SNAPSHOT
  // ==========================================================================

  /**
   * Validates and executes a move on the engine, recording full WXF/Vietnamese/ICCS notation,
   * Zobrist hash history, check/checkmate/stalemate flags, and returning the ExecutedMove record.
   */
  public makeMove(moveIntent: MoveIntent): ExecutedMove {
    if (!this.isValidMove(moveIntent)) {
      throw new Error(
        `Illegal move from (${moveIntent.from.row},${moveIntent.from.col}) to (${moveIntent.to.row},${moveIntent.to.col}) for side '${this.turn}'.`
      );
    }

    const fenBefore = this.generateFen();
    const movingPiece = { ...this.board[moveIntent.from.row][moveIntent.from.col]! };
    const capturedPiece = this.board[moveIntent.to.row][moveIntent.to.col]
      ? { ...this.board[moveIntent.to.row][moveIntent.to.col]! }
      : null;

    const { wxf, vietnamese } = this.generateMoveNotations(moveIntent);
    const iccs = XiangqiEngine.toIccs(moveIntent.from, moveIntent.to);

    this.makeFastMove(moveIntent);

    const fenAfter = this.generateFen();
    const zobristHashAfter = this.getZobristHash();

    this.positionHashes.push(zobristHashAfter);
    this.positionCounts.set(
      zobristHashAfter,
      (this.positionCounts.get(zobristHashAfter) ?? 0) + 1
    );

    const outcome = this.getGameOutcome();

    const executed: ExecutedMove = {
      from: { ...moveIntent.from },
      to: { ...moveIntent.to },
      piece: movingPiece,
      captured: capturedPiece,
      iccs,
      wxf,
      vietnameseNotation: vietnamese,
      fenBefore,
      fenAfter,
      zobristHashAfter,
      isCheck: outcome.inCheck,
      isCheckmate: outcome.reason === 'CHECKMATE',
      isStalemate: outcome.reason === 'STALEMATE',
      isThreefoldRepetition: outcome.reason === 'DRAW_REPETITION',
      halfMoveClock: this.halfMoveClock,
      fullMoveNumber: this.fullMoveNumber,
      timestamp: Date.now(),
    };

    this.moveHistory.push(executed);
    return executed;
  }

  /**
   * Undoes the last committed move from `moveHistory`.
   */
  public undoLastMove(): ExecutedMove | null {
    if (this.moveHistory.length === 0) return null;
    const lastMove = this.moveHistory.pop()!;

    // Decrement repetition count for current hash
    const poppedHash = this.positionHashes.pop();
    if (poppedHash) {
      const count = this.positionCounts.get(poppedHash) ?? 0;
      if (count <= 1) {
        this.positionCounts.delete(poppedHash);
      } else {
        this.positionCounts.set(poppedHash, count - 1);
      }
    }

    // Restore FEN state before the move while preserving remaining history
    const savedHashes = [...this.positionHashes];
    const savedMoves = [...this.moveHistory];
    this.loadFen(lastMove.fenBefore);
    this.positionHashes = savedHashes;
    this.positionCounts.clear();
    for (const h of this.positionHashes) {
      this.positionCounts.set(h, (this.positionCounts.get(h) ?? 0) + 1);
    }
    this.moveHistory = savedMoves;

    return lastMove;
  }

  /**
   * Returns a complete serializable snapshot of the current game state.
   */
  public getStateSnapshot(): GameStateSnapshot {
    const outcome = this.getGameOutcome();
    const legalMoves = outcome.isOver ? [] : this.getLegalMoves(this.turn);

    return {
      fen: this.generateFen(),
      board: this.getBoard(),
      turn: this.turn,
      halfMoveClock: this.halfMoveClock,
      fullMoveNumber: this.fullMoveNumber,
      zobristHash: this.getZobristHash(),
      positionHashes: this.getPositionHashes(),
      moveHistory: this.getMoveHistory(),
      outcome,
      legalMoves,
    };
  }
}
