"use strict";
// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - JWT AUTHENTICATION MIDDLEWARE
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const jwt_1 = require("../utils/jwt");
/**
 * Express middleware that requires a valid Bearer JWT Access Token in the Authorization header.
 */
function requireAuth(req, res, next) {
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
        const payload = (0, jwt_1.verifyAccessToken)(token);
        req.user = payload;
        next();
    }
    catch {
        res.status(401).json({
            error: 'TOKEN_EXPIRED_OR_INVALID',
            message: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ.',
        });
    }
}
//# sourceMappingURL=auth.middleware.js.map