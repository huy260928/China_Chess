// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - 3-LEVEL AI SEARCH ENGINE
// Level 1 (EASY):   Minimax (depth = 2) + Material Balance + Random Noise
// Level 2 (MEDIUM): Alpha-Beta Pruning (depth = 4) + Piece-Square Tables (PST)
// Level 3 (HARD):   Iterative Deepening Alpha-Beta (depth = 5-6) + Quiescence
//                   Search + Zobrist Transposition Table + Opening Book
// ============================================================================

import {
  AiMoveRequest,
  AiMoveResponse,
  BOARD_COLS,
  BOARD_ROWS,
  MoveIntent,
  Side,
  XiangqiEngine,
} from '@xiangqi/shared';
import {
  evaluateBoard,
   getPieceSquareBonus,
  PIECE_MATERIAL_VALUE,
} from './ai-evaluation';
import { lookupOpeningBookMove } from './opening-book';

const MATE_SCORE = 90000;
const INFINITY_SCORE = 1000000;
const MAX_PLY = 32;
const MAX_QUIESCENCE_PLY = 6;
const MAX_TT_ENTRIES = 250000;

type TTFlag = 'EXACT' | 'LOWER_BOUND' | 'UPPER_BOUND';

interface TranspositionEntry {
  zobristKey: bigint;
  depth: number;
  score: number;
  flag: TTFlag;
  bestMove: MoveIntent | null;
}

export class XiangqiAiSearchEngine {
  private transpositionTable: Map<bigint, TranspositionEntry>;
  private killerMoves: (MoveIntent | null)[][];
  private nodesEvaluated: number;
  private startTimeMs: number;
  private timeLimitMs: number;
  private abortSearch: boolean;
  private gameHistoryHashes: Set<string>;

  constructor() {
    this.transpositionTable = new Map<bigint, TranspositionEntry>();
    this.killerMoves = Array.from({ length: MAX_PLY }, () => [null, null]);
    this.nodesEvaluated = 0;
    this.startTimeMs = 0;
    this.timeLimitMs = 3000;
    this.abortSearch = false;
    this.gameHistoryHashes = new Set<string>();
  }

  /**
   * Main entry point to compute the best move for EASY, MEDIUM, or HARD difficulty.
   */
  public computeBestMove(request: AiMoveRequest): AiMoveResponse {
    const start = Date.now();
    this.startTimeMs = start;
    this.nodesEvaluated = 0;
    this.abortSearch = false;
    this.killerMoves = Array.from({ length: MAX_PLY }, () => [null, null]);
    this.gameHistoryHashes = new Set<string>(request.positionHashes ?? []);

    const engine = new XiangqiEngine(request.fen, request.positionHashes);
    const legalMoves = engine.getLegalMoves();

    if (legalMoves.length === 0) {
      return {
        requestId: request.requestId,
        bestMove: null,
        score: -MATE_SCORE,
        depthReached: 0,
        nodesEvaluated: 0,
        elapsedMs: Date.now() - start,
        fromBook: false,
      };
    }

    if (legalMoves.length === 1) {
      return {
        requestId: request.requestId,
        bestMove: legalMoves[0],
        score: 0,
        depthReached: 1,
        nodesEvaluated: 1,
        elapsedMs: Date.now() - start,
        fromBook: false,
      };
    }

    switch (request.difficulty) {
      case 'EASY':
        return this.searchEasyLevel(request, engine);
      case 'MEDIUM':
        return this.searchMediumLevel(request, engine);
      case 'HARD':
        return this.searchHardLevel(request, engine);
    }
  }

  // ==========================================================================
  // LEVEL 1 (EASY): MINIMAX (DEPTH = 2) + MATERIAL BALANCE + RANDOM NOISE
  // ==========================================================================

  private searchEasyLevel(
    request: AiMoveRequest,
    engine: XiangqiEngine
  ): AiMoveResponse {
    const rootSide = engine.getTurn();
    const depth = 2;
    const legalMoves = engine.getLegalMoves(rootSide);

    // Shuffle root moves slightly for natural variety
    const shuffledMoves = [...legalMoves].sort(() => Math.random() - 0.5);

    let bestMove: MoveIntent = shuffledMoves[0];
    let bestScore = -INFINITY_SCORE;

    for (const move of shuffledMoves) {
      const undo = engine.makeFastMove(move);
      const score = this.minimaxEasy(engine, depth - 1, false, rootSide);
      engine.unmakeFastMove(undo);

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return {
      requestId: request.requestId,
      bestMove,
      score: bestScore,
      depthReached: depth,
      nodesEvaluated: this.nodesEvaluated,
      elapsedMs: Date.now() - this.startTimeMs,
      fromBook: false,
    };
  }

  private minimaxEasy(
    engine: XiangqiEngine,
    depth: number,
    isMaximizing: boolean,
    rootSide: Side
  ): number {
    this.nodesEvaluated++;

    if (depth === 0) {
      // Material balance only (includePst = false) + random jitter [-25..+25]
      return evaluateBoard(engine, rootSide, false, 25);
    }

    const activeSide = engine.getTurn();
    const pseudoMoves = this.generateAllPseudoMoves(engine, activeSide);
    let legalCount = 0;

    if (isMaximizing) {
      let maxEval = -INFINITY_SCORE;
      for (const move of pseudoMoves) {
        const undo = engine.makeFastMove(move);
        if (engine.isGeneralsFacing() || engine.isInCheck(activeSide)) {
          engine.unmakeFastMove(undo);
          continue;
        }
        legalCount++;
        const evaluation = this.minimaxEasy(engine, depth - 1, false, rootSide);
        engine.unmakeFastMove(undo);
        if (evaluation > maxEval) {
          maxEval = evaluation;
        }
      }
      if (legalCount === 0) {
        return -MATE_SCORE;
      }
      return maxEval;
    } else {
      let minEval = INFINITY_SCORE;
      for (const move of pseudoMoves) {
        const undo = engine.makeFastMove(move);
        if (engine.isGeneralsFacing() || engine.isInCheck(activeSide)) {
          engine.unmakeFastMove(undo);
          continue;
        }
        legalCount++;
        const evaluation = this.minimaxEasy(engine, depth - 1, true, rootSide);
        engine.unmakeFastMove(undo);
        if (evaluation < minEval) {
          minEval = evaluation;
        }
      }
      if (legalCount === 0) {
        return MATE_SCORE;
      }
      return minEval;
    }
  }

  // ==========================================================================
  // LEVEL 2 (MEDIUM): ALPHA-BETA PRUNING (DEPTH = 4) + PIECE-SQUARE TABLES
  // ==========================================================================

  private searchMediumLevel(
    request: AiMoveRequest,
    engine: XiangqiEngine
  ): AiMoveResponse {
    const depth = 4;
    this.timeLimitMs = request.maxTimeMs ?? 4000;

    const rootResult = this.searchRootAlphaBeta(engine, depth, false);

    return {
      requestId: request.requestId,
      bestMove: rootResult.bestMove,
      score: rootResult.bestScore,
      depthReached: depth,
      nodesEvaluated: this.nodesEvaluated,
      elapsedMs: Date.now() - this.startTimeMs,
      fromBook: false,
    };
  }

  // ==========================================================================
  // LEVEL 3 (HARD): ITERATIVE DEEPENING ALPHA-BETA (DEPTH 5-6) + QUIESCENCE
  //                 + TRANSPOSITION TABLE + OPENING BOOK
  // ==========================================================================

  private searchHardLevel(
    request: AiMoveRequest,
    engine: XiangqiEngine
  ): AiMoveResponse {
    // 1. Check Master Opening Book first
    const bookMove = lookupOpeningBookMove(engine);
    if (bookMove) {
      return {
        requestId: request.requestId,
        bestMove: bookMove,
        score: 35,
        depthReached: 0,
        nodesEvaluated: 1,
        elapsedMs: Date.now() - this.startTimeMs,
        fromBook: true,
      };
    }

    // 2. Prune Transposition Table if it exceeded max entries
    if (this.transpositionTable.size > MAX_TT_ENTRIES) {
      this.transpositionTable.clear();
    }

    // Time budget for Iterative Deepening (default 2800ms, completes depth 5 and reaches depth 6)
    this.timeLimitMs = request.maxTimeMs ?? 2800;
    const maxTargetDepth = 6;

    let bestMove: MoveIntent | null = null;
    let bestScore = 0;
    let completedDepth = 1;

    // 3. Iterative Deepening loop from depth = 1 to maxTargetDepth (5..6)
    for (let currentDepth = 1; currentDepth <= maxTargetDepth; currentDepth++) {
      const result = this.searchRootAlphaBeta(
        engine,
        currentDepth,
        true,
        bestMove
      );

      // Always commit the result of depth 1, or any deeper iteration that completed before timeout
      if (currentDepth === 1 || !this.abortSearch) {
        if (result.bestMove) {
          bestMove = result.bestMove;
          bestScore = result.bestScore;
          completedDepth = currentDepth;
        }
      } else if (result.bestMove && result.bestScore > bestScore) {
        // Even on partial completion, if we found a strictly better move at root, retain it
        bestMove = result.bestMove;
        bestScore = result.bestScore;
      }

      // Stop deepening if we found a forced mate or ran out of time after reaching at least depth 5
      if (Math.abs(bestScore) >= MATE_SCORE - 100) {
        break;
      }
      if (this.abortSearch && completedDepth >= 5) {
        break;
      }
      const elapsed = Date.now() - this.startTimeMs;
      if (currentDepth >= 5 && elapsed >= this.timeLimitMs * 0.65) {
        break;
      }
    }

    return {
      requestId: request.requestId,
      bestMove,
      score: bestScore,
      depthReached: completedDepth,
      nodesEvaluated: this.nodesEvaluated,
      elapsedMs: Date.now() - this.startTimeMs,
      fromBook: false,
    };
  }

  // ==========================================================================
  // CORE NEGAMAX ALPHA-BETA + QUIESCENCE + TRANSPOSITION TABLE
  // ==========================================================================

  private searchRootAlphaBeta(
    engine: XiangqiEngine,
    depth: number,
    useHardEnhancements: boolean,
    pvHintMove: MoveIntent | null = null
  ): { bestMove: MoveIntent | null; bestScore: number } {
    const activeSide = engine.getTurn();
    const rawPseudoMoves = this.generateAllPseudoMoves(engine, activeSide);
    const orderedMoves = this.orderMoves(
      engine,
      rawPseudoMoves,
      pvHintMove,
      0
    );

    let alpha = -INFINITY_SCORE;
    const beta = INFINITY_SCORE;
    let bestMove: MoveIntent | null = null;
    let bestScore = -INFINITY_SCORE;

    for (const move of orderedMoves) {
      const undo = engine.makeFastMove(move);
      if (engine.isGeneralsFacing() || engine.isInCheck(activeSide)) {
        engine.unmakeFastMove(undo);
        continue;
      }

      // Penalize moves that repeat an existing board hash when ahead
      const nextHash = engine.getZobristHash();
      const isRepetition = this.gameHistoryHashes.has(nextHash);

      let score: number;
      if (isRepetition) {
        score = -25;
      } else {
        score = -this.alphaBeta(
          engine,
          depth - 1,
          -beta,
          -alpha,
          1,
          useHardEnhancements
        );
      }

      engine.unmakeFastMove(undo);

      if (this.abortSearch && bestMove !== null && depth > 5) {
        break;
      }

      if (score > bestScore || bestMove === null) {
        bestScore = score;
        bestMove = move;
      }
      if (score > alpha) {
        alpha = score;
      }
    }

    if (useHardEnhancements && bestMove && !this.abortSearch) {
      this.transpositionTable.set(engine.getZobristKeyBigInt(), {
        zobristKey: engine.getZobristKeyBigInt(),
        depth,
        score: bestScore,
        flag: 'EXACT',
        bestMove,
      });
    }

    return { bestMove, bestScore };
  }

  private alphaBeta(
    engine: XiangqiEngine,
    depth: number,
    alpha: number,
    beta: number,
    ply: number,
    useHardEnhancements: boolean
  ): number {
    this.nodesEvaluated++;

    // Periodic time check every 2048 nodes (only abort if we already searched deeply)
    if (useHardEnhancements && (this.nodesEvaluated & 2047) === 0) {
      if (Date.now() - this.startTimeMs >= this.timeLimitMs) {
        this.abortSearch = true;
      }
    }
    if (this.abortSearch && ply > 1) {
      return evaluateBoard(engine, engine.getTurn(), true, 0);
    }

    const alphaOrig = alpha;
    const zobristKey = engine.getZobristKeyBigInt();
    let ttMove: MoveIntent | null = null;

    // 1. Transposition Table Lookup (Level 3 Hard)
    if (useHardEnhancements) {
      const ttEntry = this.transpositionTable.get(zobristKey);
      if (ttEntry && ttEntry.zobristKey === zobristKey) {
        ttMove = ttEntry.bestMove;
        if (ttEntry.depth >= depth) {
          if (ttEntry.flag === 'EXACT') {
            return ttEntry.score;
          } else if (ttEntry.flag === 'LOWER_BOUND' && ttEntry.score > alpha) {
            alpha = ttEntry.score;
          } else if (ttEntry.flag === 'UPPER_BOUND' && ttEntry.score < beta) {
            beta = ttEntry.score;
          }
          if (alpha >= beta) {
            return ttEntry.score;
          }
        }
      }
    }

    // 2. Leaf Node Evaluation
    if (depth <= 0) {
      if (useHardEnhancements) {
        return this.quiescenceSearch(engine, alpha, beta, 0);
      } else {
        return evaluateBoard(engine, engine.getTurn(), true, 0);
      }
    }

    const activeSide = engine.getTurn();
    const rawPseudoMoves = this.generateAllPseudoMoves(engine, activeSide);
    const orderedMoves = this.orderMoves(engine, rawPseudoMoves, ttMove, ply);

    let legalMovesCount = 0;
    let bestScore = -INFINITY_SCORE;
    let bestMove: MoveIntent | null = null;

    for (const move of orderedMoves) {
      const targetBefore = engine.getRawBoard()[move.to.row][move.to.col];
      const undo = engine.makeFastMove(move);

      if (engine.isGeneralsFacing() || engine.isInCheck(activeSide)) {
        engine.unmakeFastMove(undo);
        continue;
      }

      legalMovesCount++;
      const score = -this.alphaBeta(
        engine,
        depth - 1,
        -beta,
        -alpha,
        ply + 1,
        useHardEnhancements
      );
      engine.unmakeFastMove(undo);

      if (this.abortSearch && ply > 1) {
        return bestScore > -INFINITY_SCORE
          ? bestScore
          : evaluateBoard(engine, activeSide, true, 0);
      }

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }

      if (score > alpha) {
        alpha = score;
      }

      // Beta Cutoff (Pruning)
      if (alpha >= beta) {
        // Store quiet move in Killer Table
        if (!targetBefore && ply < MAX_PLY) {
          this.storeKillerMove(ply, move);
        }
        break;
      }
    }

    // 3. Checkmate or Stalemate detection (In Xiangqi, both 0-legal-move states lose!)
    if (legalMovesCount === 0) {
      return -MATE_SCORE + ply;
    }

    // 4. Store in Transposition Table (Level 3 Hard)
    if (useHardEnhancements && !this.abortSearch) {
      let flag: TTFlag = 'EXACT';
      if (bestScore <= alphaOrig) {
        flag = 'UPPER_BOUND';
      } else if (bestScore >= beta) {
        flag = 'LOWER_BOUND';
      }
      this.transpositionTable.set(zobristKey, {
        zobristKey,
        depth,
        score: bestScore,
        flag,
        bestMove,
      });
    }

    return bestScore;
  }

  // ==========================================================================
  // QUIESCENCE SEARCH (TÌM KIẾM TĨNH CHỐNG HIỆU ỨNG ĐƯỜNG CHÂN TRỜI)
  // ==========================================================================

  private quiescenceSearch(
    engine: XiangqiEngine,
    alpha: number,
    beta: number,
    qPly: number
  ): number {
    this.nodesEvaluated++;

    const activeSide = engine.getTurn();
    const inCheck = engine.isInCheck(activeSide);

    // Stand-pat evaluation (only allowed when NOT in check)
    if (!inCheck) {
      const standPat = evaluateBoard(engine, activeSide, true, 0);
      if (standPat >= beta) {
        return beta;
      }
      if (standPat > alpha) {
        alpha = standPat;
      }
      if (qPly >= MAX_QUIESCENCE_PLY) {
        return standPat;
      }
    } else if (qPly >= MAX_QUIESCENCE_PLY + 2) {
      return evaluateBoard(engine, activeSide, true, 0);
    }

    // When in check, consider all evasions; when not in check, consider only tactical captures
    const candidateMoves = inCheck
      ? this.generateAllPseudoMoves(engine, activeSide)
      : this.generateCapturePseudoMoves(engine, activeSide);

    const orderedMoves = this.orderMoves(engine, candidateMoves, null, MAX_PLY - 1);
    let legalEvasions = 0;

    for (const move of orderedMoves) {
      const undo = engine.makeFastMove(move);
      if (engine.isGeneralsFacing() || engine.isInCheck(activeSide)) {
        engine.unmakeFastMove(undo);
        continue;
      }
      legalEvasions++;

      const score = -this.quiescenceSearch(engine, -beta, -alpha, qPly + 1);
      engine.unmakeFastMove(undo);

      if (score >= beta) {
        return beta;
      }
      if (score > alpha) {
        alpha = score;
      }
    }

    if (inCheck && legalEvasions === 0) {
      return -MATE_SCORE + 10 + qPly;
    }

    return alpha;
  }

  // ==========================================================================
  // PSEUDO-LEGAL GENERATORS & MVV-LVA / KILLER / TT MOVE ORDERING
  // ==========================================================================

  private generateAllPseudoMoves(engine: XiangqiEngine, side: Side): MoveIntent[] {
    const rawBoard = engine.getRawBoard();
    const moves: MoveIntent[] = [];

    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        const p = rawBoard[r][c];
        if (p && p.side === side) {
          const pieceMoves = engine.getPseudoLegalMovesFrom(r, c);
          for (const m of pieceMoves) {
            moves.push(m);
          }
        }
      }
    }
    return moves;
  }

  private generateCapturePseudoMoves(engine: XiangqiEngine, side: Side): MoveIntent[] {
    const rawBoard = engine.getRawBoard();
    const captures: MoveIntent[] = [];

    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        const p = rawBoard[r][c];
        if (p && p.side === side) {
          const pieceMoves = engine.getPseudoLegalMovesFrom(r, c);
          for (const m of pieceMoves) {
            const target = rawBoard[m.to.row][m.to.col];
            if (target && target.side !== side) {
              captures.push(m);
            }
          }
        }
      }
    }
    return captures;
  }

  private storeKillerMove(ply: number, move: MoveIntent): void {
    const first = this.killerMoves[ply][0];
    if (first && XiangqiAiSearchEngine.isSameMove(first, move)) {
      return;
    }
    this.killerMoves[ply][1] = first;
    this.killerMoves[ply][0] = move;
  }

  private static isSameMove(a: MoveIntent, b: MoveIntent): boolean {
    return (
      a.from.row === b.from.row &&
      a.from.col === b.from.col &&
      a.to.row === b.to.row &&
      a.to.col === b.to.col
    );
  }

  /**
   * Orders moves to maximize Alpha-Beta pruning efficiency:
   * 1. Transposition Table / Principal Variation move (1,000,000)
   * 2. Captures ordered by MVV-LVA (100,000 + VictimValue * 10 - AttackerValue)
   * 3. Killer Moves (80,000 / 70,000)
   * 4. Positional PST Gain (getPieceSquareBonus(to) - getPieceSquareBonus(from))
   */
  private orderMoves(
    engine: XiangqiEngine,
    moves: MoveIntent[],
    ttMove: MoveIntent | null,
    ply: number
  ): MoveIntent[] {
    const rawBoard = engine.getRawBoard();
    const killers = ply < MAX_PLY ? this.killerMoves[ply] : [null, null];

    const scoredMoves = moves.map((move) => {
      let priority = 0;

      if (ttMove && XiangqiAiSearchEngine.isSameMove(move, ttMove)) {
        priority = 1000000;
      } else {
        const attacker = rawBoard[move.from.row][move.from.col];
        const victim = rawBoard[move.to.row][move.to.col];

        if (victim && attacker) {
          priority =
            100000 +
            PIECE_MATERIAL_VALUE[victim.type] * 10 -
            PIECE_MATERIAL_VALUE[attacker.type];
        } else {
          if (killers[0] && XiangqiAiSearchEngine.isSameMove(move, killers[0])) {
            priority = 80000;
          } else if (killers[1] && XiangqiAiSearchEngine.isSameMove(move, killers[1])) {
            priority = 70000;
          } else if (attacker) {
            priority =
              getPieceSquareBonus(attacker, move.to.row, move.to.col) -
              getPieceSquareBonus(attacker, move.from.row, move.from.col);
          }
        }
      }

      return { move, priority };
    });

    scoredMoves.sort((a, b) => b.priority - a.priority);
    return scoredMoves.map((item) => item.move);
  }
}
