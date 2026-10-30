"use strict";
// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - AI WORKER THREAD POOL MANAGER
// Manages a pool of Node.js worker_threads for concurrent PvE matches.
// ============================================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiWorkerPool = void 0;
exports.getAiWorkerPool = getAiWorkerPool;
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const worker_threads_1 = require("worker_threads");
class AiWorkerPool {
    workers = [];
    taskQueue = [];
    activeTasks = new Map();
    poolSize;
    isShuttingDown = false;
    constructor(poolSize) {
        const cpuCount = os_1.default.cpus().length;
        this.poolSize = poolSize ?? Math.max(2, Math.min(4, cpuCount - 1));
        this.initializePool();
    }
    initializePool() {
        for (let i = 0; i < this.poolSize; i++) {
            this.spawnWorker(i);
        }
    }
    resolveWorkerConfig() {
        const compiledJsPath = path_1.default.resolve(__dirname, 'ai-worker.js');
        if (fs_1.default.existsSync(compiledJsPath)) {
            return {
                scriptPath: compiledJsPath,
                execArgv: [],
            };
        }
        // Development mode running via tsx / ts-node directly on .ts source
        const tsSourcePath = path_1.default.resolve(__dirname, 'ai-worker.ts');
        return {
            scriptPath: tsSourcePath,
            execArgv: ['--import', 'tsx'],
        };
    }
    spawnWorker(id) {
        const { scriptPath, execArgv } = this.resolveWorkerConfig();
        const worker = new worker_threads_1.Worker(scriptPath, { execArgv });
        const managed = {
            id,
            worker,
            busy: false,
            currentRequestId: null,
        };
        worker.on('message', (msg) => {
            const reqId = msg.status === 'ok' ? msg.data?.requestId : msg.requestId;
            managed.busy = false;
            managed.currentRequestId = null;
            if (reqId) {
                const task = this.activeTasks.get(reqId);
                if (task) {
                    clearTimeout(task.timeoutHandle);
                    this.activeTasks.delete(reqId);
                    if (msg.status === 'ok' && msg.data) {
                        task.resolve(msg.data);
                    }
                    else {
                        task.reject(new Error(msg.error || 'AI Worker returned an error'));
                    }
                }
            }
            this.dispatchNext();
        });
        worker.on('error', (err) => {
            const failedReqId = managed.currentRequestId;
            managed.busy = false;
            managed.currentRequestId = null;
            if (failedReqId) {
                const task = this.activeTasks.get(failedReqId);
                if (task) {
                    clearTimeout(task.timeoutHandle);
                    this.activeTasks.delete(failedReqId);
                    task.reject(err);
                }
            }
            this.replaceWorker(managed);
        });
        worker.on('exit', (code) => {
            if (code !== 0 && !this.isShuttingDown) {
                this.replaceWorker(managed);
            }
        });
        const existingIdx = this.workers.findIndex((w) => w.id === id);
        if (existingIdx >= 0) {
            this.workers[existingIdx] = managed;
        }
        else {
            this.workers.push(managed);
        }
        return managed;
    }
    replaceWorker(deadWorker) {
        if (this.isShuttingDown)
            return;
        try {
            deadWorker.worker.terminate().catch(() => undefined);
        }
        catch {
            // Ignore termination errors on already exited worker
        }
        this.spawnWorker(deadWorker.id);
        this.dispatchNext();
    }
    /**
     * Submits a board FEN and difficulty level to the AI Worker Pool and resolves
     * with the best move computed on a background thread.
     */
    requestBestMove(params) {
        const requestId = `ai-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const maxTimeMs = params.maxTimeMs ??
            (params.difficulty === 'EASY'
                ? 1000
                : params.difficulty === 'MEDIUM'
                    ? 2500
                    : 3000);
        const request = {
            requestId,
            fen: params.fen,
            difficulty: params.difficulty,
            positionHashes: params.positionHashes,
            moveHistoryWxf: params.moveHistoryWxf,
            maxTimeMs,
        };
        return new Promise((resolve, reject) => {
            const hardTimeoutMs = maxTimeMs + 5000;
            const timeoutHandle = setTimeout(() => {
                this.activeTasks.delete(requestId);
                const queueIdx = this.taskQueue.findIndex((t) => t.request.requestId === requestId);
                if (queueIdx >= 0) {
                    this.taskQueue.splice(queueIdx, 1);
                }
                // Recycle any hung worker processing this request
                const hungWorker = this.workers.find((w) => w.currentRequestId === requestId);
                if (hungWorker) {
                    hungWorker.busy = false;
                    hungWorker.currentRequestId = null;
                    this.replaceWorker(hungWorker);
                }
                reject(new Error(`AI calculation timed out after ${hardTimeoutMs}ms`));
            }, hardTimeoutMs);
            const task = {
                request,
                resolve,
                reject,
                timeoutHandle,
            };
            this.taskQueue.push(task);
            this.dispatchNext();
        });
    }
    dispatchNext() {
        if (this.taskQueue.length === 0)
            return;
        const availableWorker = this.workers.find((w) => !w.busy);
        if (!availableWorker)
            return;
        const nextTask = this.taskQueue.shift();
        if (!nextTask)
            return;
        availableWorker.busy = true;
        availableWorker.currentRequestId = nextTask.request.requestId;
        this.activeTasks.set(nextTask.request.requestId, nextTask);
        availableWorker.worker.postMessage(nextTask.request);
    }
    async shutdown() {
        this.isShuttingDown = true;
        for (const task of this.taskQueue) {
            clearTimeout(task.timeoutHandle);
            task.reject(new Error('AI Worker Pool is shutting down'));
        }
        this.taskQueue = [];
        for (const [, task] of this.activeTasks) {
            clearTimeout(task.timeoutHandle);
            task.reject(new Error('AI Worker Pool is shutting down'));
        }
        this.activeTasks.clear();
        await Promise.all(this.workers.map((w) => w.worker.terminate().catch(() => 0)));
    }
}
exports.AiWorkerPool = AiWorkerPool;
let singletonAiPool = null;
function getAiWorkerPool() {
    if (!singletonAiPool) {
        singletonAiPool = new AiWorkerPool();
    }
    return singletonAiPool;
}
//# sourceMappingURL=ai-pool.js.map