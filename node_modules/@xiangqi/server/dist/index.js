"use strict";
// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - SERVER BOOTSTRAP ENTRY POINT
// ============================================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const env_1 = require("./config/env");
const database_1 = require("./config/database");
const redis_1 = require("./config/redis");
const app_1 = require("./app");
const socket_manager_1 = require("./socket/socket-manager");
const ai_pool_1 = require("./workers/ai-pool");
async function bootstrap() {
    // 1. Connect to PostgreSQL 18 (`xiangqi_db`) & migrate/seed initial data
    await (0, database_1.connectAndSeedDatabase)();
    // 2. Connect to Redis State Store
    await redis_1.redisStore.connect();
    // 2. Initialize AI Worker Thread Pool
    (0, ai_pool_1.getAiWorkerPool)();
    // 3. Create Express HTTP Server + Socket.io Real-time Server
    const app = (0, app_1.createExpressApp)();
    const httpServer = http_1.default.createServer(app);
    const socketServer = new socket_manager_1.XiangqiSocketServer(httpServer);
    httpServer.listen(env_1.ENV.PORT, () => {
        console.log(`============================================================================`);
        console.log(`[Xiangqi Enterprise Server] Running on http://localhost:${env_1.ENV.PORT} (${env_1.ENV.NODE_ENV})`);
        console.log(`============================================================================`);
    });
    // 4. Graceful Shutdown Handler
    const gracefulShutdown = async (signal) => {
        console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);
        await socketServer.shutdown();
        await redis_1.redisStore.disconnect();
        await database_1.prisma.$disconnect();
        httpServer.close(() => {
            console.log('[Server] HTTP & WebSocket server closed cleanly.');
            process.exit(0);
        });
    };
    process.on('SIGINT', () => {
        gracefulShutdown('SIGINT').catch(() => process.exit(1));
    });
    process.on('SIGTERM', () => {
        gracefulShutdown('SIGTERM').catch(() => process.exit(1));
    });
}
bootstrap().catch((err) => {
    console.error('[Fatal Bootstrap Error]:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map