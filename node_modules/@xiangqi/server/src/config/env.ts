// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - SERVER ENVIRONMENT CONFIGURATION
// ============================================================================

import dotenv from 'dotenv';

dotenv.config();

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '4000', 10),
  DATABASE_URL:
    process.env.DATABASE_URL ||
    'postgresql://xiangqi:xiangqi_secret@localhost:5432/xiangqi_db?schema=public',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  JWT_ACCESS_SECRET:
    process.env.JWT_ACCESS_SECRET || 'xiangqi-enterprise-access-secret-key-2026',
  JWT_REFRESH_SECRET:
    process.env.JWT_REFRESH_SECRET || 'xiangqi-enterprise-refresh-secret-key-2026',
  ACCESS_TOKEN_EXPIRES_IN: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m',
  REFRESH_TOKEN_TTL_DAYS: parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '7', 10),
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
} as const;
