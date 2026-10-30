"use strict";
// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - DEDICATED NODE.JS AI WORKER THREAD
// Runs CPU-intensive Minimax / Alpha-Beta / Quiescence calculations off the
// Main Event Loop so WebSocket & Clock ticks remain 100% responsive.
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const worker_threads_1 = require("worker_threads");
const ai_search_1 = require("./ai-search");
const searchEngine = new ai_search_1.XiangqiAiSearchEngine();
if (!worker_threads_1.parentPort) {
    throw new Error('ai-worker.ts must be executed inside a Node.js worker_threads context.');
}
worker_threads_1.parentPort.on('message', (request) => {
    const start = Date.now();
    try {
        const response = searchEngine.computeBestMove(request);
        worker_threads_1.parentPort?.postMessage({
            status: 'ok',
            data: response,
        });
    }
    catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown AI worker error';
        worker_threads_1.parentPort?.postMessage({
            status: 'error',
            requestId: request.requestId,
            error: errorMessage,
            elapsedMs: Date.now() - start,
        });
    }
});
//# sourceMappingURL=ai-worker.js.map