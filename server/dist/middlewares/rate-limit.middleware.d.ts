/**
 * Strict Rate Limiter for Login / Register endpoints to prevent credential stuffing & brute force.
 * Allows max 15 requests per 15-minute window per IP.
 */
export declare const authRateLimiter: import("express-rate-limit").RateLimitRequestHandler;
/**
 * General API Rate Limiter for authenticated/public REST endpoints.
 * Allows max 150 requests per 1-minute window per IP.
 */
export declare const apiRateLimiter: import("express-rate-limit").RateLimitRequestHandler;
//# sourceMappingURL=rate-limit.middleware.d.ts.map