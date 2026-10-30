"use strict";
// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - EXPRESS API RATE LIMITING MIDDLEWARE
// ============================================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiRateLimiter = exports.authRateLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
/**
 * Strict Rate Limiter for Login / Register endpoints to prevent credential stuffing & brute force.
 * Allows max 15 requests per 15-minute window per IP.
 */
exports.authRateLimiter = (0, express_rate_limit_1.default)({
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
exports.apiRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 150,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'TOO_MANY_REQUESTS',
        message: 'Tần suất gửi yêu cầu quá nhanh. Vui lòng thử lại sau ít giây.',
    },
});
//# sourceMappingURL=rate-limit.middleware.js.map