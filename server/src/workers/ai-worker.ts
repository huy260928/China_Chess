// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - DEDICATED NODE.JS AI WORKER THREAD
// Runs CPU-intensive Minimax / Alpha-Beta / Quiescence calculations off the
// Main Event Loop so WebSocket & Clock ticks remain 100% responsive.
// ============================================================================

import { parentPort } from 'worker_threads';
import { AiMoveRequest, AiMoveResponse } from '@xiangqi/shared';
import { XiangqiAiSearchEngine } from './ai-search';

const searchEngine = new XiangqiAiSearchEngine();

if (!parentPort) {
  throw new Error('ai-worker.ts must be executed inside a Node.js worker_threads context.');
}

parentPort.on('message', (request: AiMoveRequest) => {
  const start = Date.now();
  try {
    const response: AiMoveResponse = searchEngine.computeBestMove(request);
    parentPort?.postMessage({
      status: 'ok',
      data: response,
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown AI worker error';
    parentPort?.postMessage({
      status: 'error',
      requestId: request.requestId,
      error: errorMessage,
      elapsedMs: Date.now() - start,
    });
  }
});
