// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - SERVER BOOTSTRAP ENTRY POINT
// ============================================================================

import http from 'http';
import { ENV } from './config/env';
import { prisma } from './config/database';
import { redisStore } from './config/redis';
import { createExpressApp } from './app';
import { XiangqiSocketServer } from './socket/socket-manager';
import { getAiWorkerPool } from './workers/ai-pool';

async function bootstrap(): Promise<void> {
  // 1. Connect to Redis State Store
  await redisStore.connect();

  // 2. Initialize AI Worker Thread Pool
  getAiWorkerPool();

  // 3. Create Express HTTP Server + Socket.io Real-time Server
  const app = createExpressApp();
  const httpServer = http.createServer(app);
  const socketServer = new XiangqiSocketServer(httpServer);

  httpServer.listen(ENV.PORT, () => {
    console.log(
      `============================================================================`
    );
    console.log(
      `[Xiangqi Enterprise Server] Running on http://localhost:${ENV.PORT} (${ENV.NODE_ENV})`
    );
    console.log(
      `============================================================================`
    );
  });

  // 4. Graceful Shutdown Handler
  const gracefulShutdown = async (signal: string) => {
    console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);
    await socketServer.shutdown();
    await redisStore.disconnect();
    await prisma.$disconnect();
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
