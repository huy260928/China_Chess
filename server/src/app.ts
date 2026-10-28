// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - EXPRESS REST APPLICATION SETUP
// ============================================================================

import express, { Express, NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { ENV } from './config/env';
import { apiRateLimiter } from './middlewares/rate-limit.middleware';
import { authRouter } from './routes/auth.routes';
import { profileRouter } from './routes/profile.routes';
import { savedGameRouter } from './routes/saved-game.routes';

export function createExpressApp(): Express {
  const app = express();

  // Security headers & CORS with HttpOnly cookie credentials
  app.use(helmet());
  app.use(
    cors({
      origin: ENV.CLIENT_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', apiRateLimiter);

  // Healthcheck Endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'xiangqi-enterprise-server',
      timestamp: new Date().toISOString(),
    });
  });

  // Mount REST API Routers
  app.use('/api/auth', authRouter);
  app.use('/api/profile', profileRouter);
  app.use('/api/saved-games', savedGameRouter);

  // 404 Not Found Handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: 'NOT_FOUND',
      message: `Không tìm thấy đường dẫn API: ${req.method} ${req.originalUrl}`,
    });
  });

  // Global Error Handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Unhandled Express Error]:', err);
    res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Đã xảy ra lỗi không mong muốn trên máy chủ.',
    });
  });

  return app;
}
