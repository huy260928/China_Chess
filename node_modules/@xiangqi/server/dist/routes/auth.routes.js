"use strict";
// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - AUTHENTICATION ROUTES (REGISTER / LOGIN / JWT)
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const database_1 = require("../config/database");
const password_1 = require("../utils/password");
const jwt_1 = require("../utils/jwt");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const rate_limit_middleware_1 = require("../middlewares/rate-limit.middleware");
exports.authRouter = (0, express_1.Router)();
const BCRYPT_SALT_ROUNDS = 12;
const registerSchema = zod_1.z.object({
    username: zod_1.z
        .string()
        .trim()
        .min(3, 'Tên kỳ thủ phải từ 3 đến 32 ký tự.')
        .max(32, 'Tên kỳ thủ tối đa 32 ký tự.')
        .regex(/^[a-zA-Z0-9_]+$/, 'Tên kỳ thủ chỉ được chứa chữ cái, chữ số và dấu gạch dưới (_).'),
    email: zod_1.z.string().trim().email('Địa chỉ email không hợp lệ.').max(128),
    password: zod_1.z
        .string()
        .min(6, 'Mật khẩu phải có ít nhất 6 ký tự.')
        .max(72, 'Mật khẩu tối đa 72 ký tự.'),
    avatarUrl: zod_1.z.string().trim().max(512).optional(),
});
const loginSchema = zod_1.z.object({
    usernameOrEmail: zod_1.z.string().trim().min(1, 'Vui lòng nhập Username hoặc Email.'),
    password: zod_1.z.string().min(1, 'Vui lòng nhập mật khẩu.'),
});
function toUserProfileDto(user) {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatarUrl,
        eloRating: user.eloRating,
        gamesPlayed: user.gamesPlayed,
        wins: user.wins,
        losses: user.losses,
        draws: user.draws,
        createdAt: user.createdAt.toISOString(),
    };
}
/**
 * POST /api/auth/register
 * Registers a new player account with default ELO = 1200, bcrypt password hash,
 * and issues JWT Access Token + HttpOnly Refresh Token.
 */
exports.authRouter.post('/register', rate_limit_middleware_1.authRateLimiter, async (req, res) => {
    try {
        const parsed = registerSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                error: 'VALIDATION_ERROR',
                message: parsed.error.issues[0]?.message || 'Dữ liệu đăng ký không hợp lệ.',
                issues: parsed.error.issues,
            });
            return;
        }
        const { username, email, password, avatarUrl } = parsed.data;
        const normalizedEmail = email.toLowerCase();
        const existingUser = await database_1.prisma.user.findFirst({
            where: {
                OR: [
                    { username: { equals: username, mode: 'insensitive' } },
                    { email: normalizedEmail },
                ],
            },
        });
        if (existingUser) {
            const conflictField = existingUser.email === normalizedEmail ? 'Email' : 'Username';
            res.status(409).json({
                error: 'USER_ALREADY_EXISTS',
                message: `${conflictField} này đã được sử dụng bởi một kỳ thủ khác.`,
            });
            return;
        }
        const passwordHash = await (0, password_1.hashPassword)(password, BCRYPT_SALT_ROUNDS);
        const user = await database_1.prisma.user.create({
            data: {
                username,
                email: normalizedEmail,
                passwordHash,
                avatarUrl: avatarUrl || '/avatars/default-general.png',
                eloRating: 1200,
            },
        });
        const accessToken = (0, jwt_1.signAccessToken)({
            userId: user.id,
            username: user.username,
            eloRating: user.eloRating,
        });
        const { rawToken, tokenHash, expiresAt } = (0, jwt_1.generateRefreshTokenPair)();
        await database_1.prisma.refreshToken.create({
            data: {
                tokenHash,
                userId: user.id,
                userAgent: req.headers['user-agent']?.substring(0, 512) || null,
                ipAddress: req.ip || null,
                expiresAt,
            },
        });
        (0, jwt_1.setRefreshTokenCookie)(res, rawToken, expiresAt);
        res.status(201).json({
            accessToken,
            user: toUserProfileDto(user),
        });
    }
    catch (err) {
        console.error('[Auth Register Error]:', err);
        res.status(500).json({
            error: 'INTERNAL_SERVER_ERROR',
            message: 'Lỗi hệ thống khi đăng ký tài khoản.',
        });
    }
});
/**
 * POST /api/auth/login
 * Authenticates player credentials and issues JWT Access Token + HttpOnly Refresh Token.
 */
exports.authRouter.post('/login', rate_limit_middleware_1.authRateLimiter, async (req, res) => {
    try {
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                error: 'VALIDATION_ERROR',
                message: parsed.error.issues[0]?.message || 'Thông tin đăng nhập không hợp lệ.',
            });
            return;
        }
        const { usernameOrEmail, password } = parsed.data;
        const normalizedInput = usernameOrEmail.toLowerCase();
        const user = await database_1.prisma.user.findFirst({
            where: {
                OR: [
                    { email: normalizedInput },
                    { username: { equals: usernameOrEmail, mode: 'insensitive' } },
                ],
            },
        });
        if (!user) {
            res.status(401).json({
                error: 'INVALID_CREDENTIALS',
                message: 'Tài khoản hoặc mật khẩu không chính xác.',
            });
            return;
        }
        const passwordValid = await (0, password_1.verifyPassword)(password, user.passwordHash);
        if (!passwordValid) {
            res.status(401).json({
                error: 'INVALID_CREDENTIALS',
                message: 'Tài khoản hoặc mật khẩu không chính xác.',
            });
            return;
        }
        const accessToken = (0, jwt_1.signAccessToken)({
            userId: user.id,
            username: user.username,
            eloRating: user.eloRating,
        });
        const { rawToken, tokenHash, expiresAt } = (0, jwt_1.generateRefreshTokenPair)();
        await database_1.prisma.refreshToken.create({
            data: {
                tokenHash,
                userId: user.id,
                userAgent: req.headers['user-agent']?.substring(0, 512) || null,
                ipAddress: req.ip || null,
                expiresAt,
            },
        });
        (0, jwt_1.setRefreshTokenCookie)(res, rawToken, expiresAt);
        res.status(200).json({
            accessToken,
            user: toUserProfileDto(user),
        });
    }
    catch (err) {
        console.error('[Auth Login Error]:', err);
        res.status(500).json({
            error: 'INTERNAL_SERVER_ERROR',
            message: 'Lỗi hệ thống khi đăng nhập.',
        });
    }
});
/**
 * POST /api/auth/refresh
 * Verifies HttpOnly Refresh Token cookie, rotates the refresh token in DB,
 * and returns a new JWT Access Token + latest User Profile.
 */
exports.authRouter.post('/refresh', async (req, res) => {
    try {
        const rawRefreshToken = req.cookies?.[jwt_1.REFRESH_COOKIE_NAME];
        if (!rawRefreshToken) {
            res.status(401).json({
                error: 'MISSING_REFRESH_TOKEN',
                message: 'Không tìm thấy phiên Refresh Token.',
            });
            return;
        }
        const incomingHash = (0, jwt_1.hashRefreshToken)(rawRefreshToken);
        const storedToken = await database_1.prisma.refreshToken.findUnique({
            where: { tokenHash: incomingHash },
            include: { user: true },
        });
        if (!storedToken ||
            storedToken.revokedAt !== null ||
            storedToken.expiresAt.getTime() <= Date.now()) {
            (0, jwt_1.clearRefreshTokenCookie)(res);
            res.status(401).json({
                error: 'INVALID_REFRESH_TOKEN',
                message: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.',
            });
            return;
        }
        // Rotate Refresh Token atomically in a transaction
        const { rawToken, tokenHash: newHash, expiresAt } = (0, jwt_1.generateRefreshTokenPair)();
        await database_1.prisma.$transaction([
            database_1.prisma.refreshToken.update({
                where: { id: storedToken.id },
                data: { revokedAt: new Date() },
            }),
            database_1.prisma.refreshToken.create({
                data: {
                    tokenHash: newHash,
                    userId: storedToken.user.id,
                    userAgent: req.headers['user-agent']?.substring(0, 512) || null,
                    ipAddress: req.ip || null,
                    expiresAt,
                },
            }),
        ]);
        const accessToken = (0, jwt_1.signAccessToken)({
            userId: storedToken.user.id,
            username: storedToken.user.username,
            eloRating: storedToken.user.eloRating,
        });
        (0, jwt_1.setRefreshTokenCookie)(res, rawToken, expiresAt);
        res.status(200).json({
            accessToken,
            user: toUserProfileDto(storedToken.user),
        });
    }
    catch (err) {
        console.error('[Auth Refresh Error]:', err);
        res.status(500).json({
            error: 'INTERNAL_SERVER_ERROR',
            message: 'Lỗi hệ thống khi làm mới phiên đăng nhập.',
        });
    }
});
/**
 * POST /api/auth/logout
 * Revokes the active Refresh Token in PostgreSQL and clears the HttpOnly cookie.
 */
exports.authRouter.post('/logout', async (req, res) => {
    try {
        const rawRefreshToken = req.cookies?.[jwt_1.REFRESH_COOKIE_NAME];
        if (rawRefreshToken) {
            const incomingHash = (0, jwt_1.hashRefreshToken)(rawRefreshToken);
            await database_1.prisma.refreshToken.updateMany({
                where: { tokenHash: incomingHash, revokedAt: null },
                data: { revokedAt: new Date() },
            });
        }
        (0, jwt_1.clearRefreshTokenCookie)(res);
        res.status(200).json({ message: 'Đã đăng xuất thành công.' });
    }
    catch (err) {
        console.error('[Auth Logout Error]:', err);
        (0, jwt_1.clearRefreshTokenCookie)(res);
        res.status(200).json({ message: 'Đã đăng xuất.' });
    }
});
/**
 * GET /api/auth/me
 * Returns the authenticated player's current profile and ELO rating.
 */
exports.authRouter.get('/me', auth_middleware_1.requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const user = await database_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            res.status(404).json({
                error: 'USER_NOT_FOUND',
                message: 'Không tìm thấy hồ sơ kỳ thủ.',
            });
            return;
        }
        res.status(200).json({
            user: toUserProfileDto(user),
        });
    }
    catch (err) {
        console.error('[Auth Me Error]:', err);
        res.status(500).json({
            error: 'INTERNAL_SERVER_ERROR',
            message: 'Lỗi khi tải thông tin cá nhân.',
        });
    }
});
//# sourceMappingURL=auth.routes.js.map