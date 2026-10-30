import { AiMoveRequest, AiMoveResponse } from '@xiangqi/shared';
export declare class XiangqiAiSearchEngine {
    private transpositionTable;
    private killerMoves;
    private nodesEvaluated;
    private startTimeMs;
    private timeLimitMs;
    private abortSearch;
    private gameHistoryHashes;
    constructor();
    /**
     * Main entry point to compute the best move for EASY, MEDIUM, or HARD difficulty.
     */
    computeBestMove(request: AiMoveRequest): AiMoveResponse;
    private searchEasyLevel;
    private minimaxEasy;
    private searchMediumLevel;
    private searchHardLevel;
    private searchRootAlphaBeta;
    private alphaBeta;
    private quiescenceSearch;
    private generateAllPseudoMoves;
    private generateCapturePseudoMoves;
    private storeKillerMove;
    private static isSameMove;
    /**
     * Orders moves to maximize Alpha-Beta pruning efficiency:
     * 1. Transposition Table / Principal Variation move (1,000,000)
     * 2. Captures ordered by MVV-LVA (100,000 + VictimValue * 10 - AttackerValue)
     * 3. Killer Moves (80,000 / 70,000)
     * 4. Positional PST Gain (getPieceSquareBonus(to) - getPieceSquareBonus(from))
     */
    private orderMoves;
}
//# sourceMappingURL=ai-search.d.ts.map