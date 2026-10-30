"use strict";
// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - JWT ACCESS TOKEN & HTTPONLY REFRESH TOKEN UTILS
// ============================================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.REFRESH_COOKIE_NAME = void 0;
exports.signAccessToken = signAccessToken;
exports.verifyAccessToken = verifyAccessToken;
exports.generateRefreshTokenPair = generateRefreshTokenPair;
exports.hashRefreshToken = hashRefreshToken;
exports.setRefreshTokenCookie = setRefreshTokenCookie;
exports.clearRefreshTokenCookie = clearRefreshTokenCookie;
const crypto_1 = __importDefault(require("crypto"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
exports.REFRESH_COOKIE_NAME = 'xiangqi_rt';
/**
 * Signs a short-lived JWT Access Token (default 15 minutes).
 */
function signAccessToken(payload) {
    return jsonwebtoken_1.default.sign(payload, env_1.ENV.JWT_ACCESS_SECRET, {
        expiresIn: env_1.ENV.ACCESS_TOKEN_EXPIRES_IN,
    });
}
/**
 * Verifies a JWT Access Token and returns the decoded payload.
 */
function verifyAccessToken(token) {
    return jsonwebtoken_1.default.verify(token, env_1.ENV.JWT_ACCESS_SECRET);
}
/**
 * Generates a cryptographically strong opaque Refresh Token and its SHA-256 hash
 * for database storage.
 */
function generateRefreshTokenPair() {
    const rawToken = crypto_1.default.randomBytes(48).toString('hex');
    const tokenHash = hashRefreshToken(rawToken);
    const expiresAt = new Date(Date.now() + env_1.ENV.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    return { rawToken, tokenHash, expiresAt };
}
/**
 * Hashes a raw Refresh Token using SHA-256 + secret pepper before storing/looking up in DB.
 */
function hashRefreshToken(rawToken) {
    return crypto_1.default
        .createHmac('sha256', env_1.ENV.JWT_REFRESH_SECRET)
        .update(rawToken)
        .digest('hex');
}
/**
 * Attaches the Refresh Token as a secure HttpOnly cookie on the Express Response.
 */
function setRefreshTokenCookie(res, rawToken, expiresAt) {
    res.cookie(exports.REFRESH_COOKIE_NAME, rawToken, {
        httpOnly: true,
        secure: env_1.ENV.NODE_ENV === 'production',
        sameSite: env_1.ENV.NODE_ENV === 'production' ? 'strict' : 'lax',
        expires: expiresAt,
        path: '/api/auth',
    });
}
/**
 * Clears the HttpOnly Refresh Token cookie.
 */
function clearRefreshTokenCookie(res) {
    res.clearCookie(exports.REFRESH_COOKIE_NAME, {
        httpOnly: true,
        secure: env_1.ENV.NODE_ENV === 'production',
        sameSite: env_1.ENV.NODE_ENV === 'production' ? 'strict' : 'lax',
        path: '/api/auth',
    });
}
//# sourceMappingURL=jwt.js.map