// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - JWT AUTHENTICATION MIDDLEWARE
// ============================================================================

import { NextFunction, Request, Response } from 'express';
import { JwtAccessPayload, verifyAccessToken } from '../utils/jwt';

declare global {
  namespace Express {
    interface Request {
      user?: JwtAccessPayload;
    }
  }
}

/**
 * Express middleware that requires a valid Bearer JWT Access Token in the Authorization header.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Vui lòng đăng nhập để thực hiện thao tác này (Thiếu Access Token).',
    });
    return;
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Access Token không hợp lệ.',
    });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({
      error: 'TOKEN_EXPIRED_OR_INVALID',
      message: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ.',
    });
  }
}
