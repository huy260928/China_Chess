// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - EXPRESS API RATE LIMITING MIDDLEWARE
// ============================================================================

import rateLimit from 'express-rate-limit';

/**
 * Strict Rate Limiter for Login / Register endpoints to prevent credential stuffing & brute force.
 * Allows max 15 requests per 15-minute window per IP.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'TOO_MANY_REQUESTS',
    message: 'Quá nhiều yêu cầu xác thực từ IP này. Vui lòng thử lại sau 15 phút.',
  },
});

/**
 * General API Rate Limiter for authenticated/public REST endpoints.
 * Allows max 150 requests per 1-minute window per IP.
 */
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'TOO_MANY_REQUESTS',
    message: 'Tần suất gửi yêu cầu quá nhanh. Vui lòng thử lại sau ít giây.',
  },
});
