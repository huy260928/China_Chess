import { AiDifficulty, AiMoveResponse } from '@xiangqi/shared';
export declare class AiWorkerPool {
    private workers;
    private taskQueue;
    private activeTasks;
    private readonly poolSize;
    private isShuttingDown;
    constructor(poolSize?: number);
    private initializePool;
    private resolveWorkerConfig;
    private spawnWorker;
    private replaceWorker;
    /**
     * Submits a board FEN and difficulty level to the AI Worker Pool and resolves
     * with the best move computed on a background thread.
     */
    requestBestMove(params: {
        fen: string;
        difficulty: AiDifficulty;
        positionHashes?: string[];
        moveHistoryWxf?: string[];
        maxTimeMs?: number;
    }): Promise<AiMoveResponse>;
    private dispatchNext;
    shutdown(): Promise<void>;
}
export declare function getAiWorkerPool(): AiWorkerPool;
//# sourceMappingURL=ai-pool.d.ts.map