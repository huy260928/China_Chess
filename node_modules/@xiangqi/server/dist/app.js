"use strict";
// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - EXPRESS REST APPLICATION SETUP
// ============================================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createExpressApp = createExpressApp;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const env_1 = require("./config/env");
const rate_limit_middleware_1 = require("./middlewares/rate-limit.middleware");
const auth_routes_1 = require("./routes/auth.routes");
const profile_routes_1 = require("./routes/profile.routes");
const saved_game_routes_1 = require("./routes/saved-game.routes");
function createExpressApp() {
    const app = (0, express_1.default)();
    // Security headers & CORS with HttpOnly cookie credentials
    app.use((0, helmet_1.default)());
    app.use((0, cors_1.default)({
        origin: env_1.ENV.CLIENT_ORIGIN,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    }));
    app.use((0, cookie_parser_1.default)());
    app.use(express_1.default.json({ limit: '1mb' }));
    app.use('/api', rate_limit_middleware_1.apiRateLimiter);
    // Healthcheck Endpoint
    app.get('/api/health', (_req, res) => {
        res.status(200).json({
            status: 'ok',
            service: 'xiangqi-enterprise-server',
            timestamp: new Date().toISOString(),
        });
    });
    // Mount REST API Routers
    app.use('/api/auth', auth_routes_1.authRouter);
    app.use('/api/profile', profile_routes_1.profileRouter);
    app.use('/api/saved-games', saved_game_routes_1.savedGameRouter);
    // 404 Not Found Handler
    app.use((req, res) => {
        res.status(404).json({
            error: 'NOT_FOUND',
            message: `Không tìm thấy đường dẫn API: ${req.method} ${req.originalUrl}`,
        });
    });
    // Global Error Handler
    app.use((err, _req, res, _next) => {
        console.error('[Unhandled Express Error]:', err);
        res.status(500).json({
            error: 'INTERNAL_SERVER_ERROR',
            message: 'Đã xảy ra lỗi không mong muốn trên máy chủ.',
        });
    });
    return app;
}
//# sourceMappingURL=app.js.map