// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - JWT ACCESS TOKEN & HTTPONLY REFRESH TOKEN UTILS
// ============================================================================

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Response } from 'express';
import { ENV } from '../config/env';

export const REFRESH_COOKIE_NAME = 'xiangqi_rt';

export interface JwtAccessPayload {
  userId: string;
  username: string;
  eloRating: number;
}

/**
 * Signs a short-lived JWT Access Token (default 15 minutes).
 */
export function signAccessToken(payload: JwtAccessPayload): string {
  return jwt.sign(payload, ENV.JWT_ACCESS_SECRET, {
    expiresIn: ENV.ACCESS_TOKEN_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

/**
 * Verifies a JWT Access Token and returns the decoded payload.
 */
export function verifyAccessToken(token: string): JwtAccessPayload {
  return jwt.verify(token, ENV.JWT_ACCESS_SECRET) as JwtAccessPayload;
}

/**
 * Generates a cryptographically strong opaque Refresh Token and its SHA-256 hash
 * for database storage.
 */
export function generateRefreshTokenPair(): {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const rawToken = crypto.randomBytes(48).toString('hex');
  const tokenHash = hashRefreshToken(rawToken);
  const expiresAt = new Date(
    Date.now() + ENV.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  );

  return { rawToken, tokenHash, expiresAt };
}

/**
 * Hashes a raw Refresh Token using SHA-256 + secret pepper before storing/looking up in DB.
 */
export function hashRefreshToken(rawToken: string): string {
  return crypto
    .createHmac('sha256', ENV.JWT_REFRESH_SECRET)
    .update(rawToken)
    .digest('hex');
}

/**
 * Attaches the Refresh Token as a secure HttpOnly cookie on the Express Response.
 */
export function setRefreshTokenCookie(
  res: Response,
  rawToken: string,
  expiresAt: Date
): void {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: ENV.NODE_ENV === 'production',
    sameSite: ENV.NODE_ENV === 'production' ? 'strict' : 'lax',
    expires: expiresAt,
    path: '/api/auth',
  });
}

/**
 * Clears the HttpOnly Refresh Token cookie.
 */
export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: ENV.NODE_ENV === 'production',
    sameSite: ENV.NODE_ENV === 'production' ? 'strict' : 'lax',
    path: '/api/auth',
  });
}
