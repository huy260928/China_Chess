"use strict";
// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - USER PROFILE, LEADERBOARD & MATCH HISTORY API
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.profileRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const database_1 = require("../config/database");
const password_1 = require("../utils/password");
const auth_middleware_1 = require("../middlewares/auth.middleware");
exports.profileRouter = (0, express_1.Router)();
const updateProfileSchema = zod_1.z.object({
    avatarUrl: zod_1.z.string().trim().min(1).max(512).optional(),
    currentPassword: zod_1.z.string().min(1).optional(),
    newPassword: zod_1.z.string().min(6).max(72).optional(),
});
function formatMatchSummary(match) {
    const moveHistory = Array.isArray(match.moveHistoryJson)
        ? match.moveHistoryJson
        : [];
    return {
        id: match.id,
        mode: match.mode,
        status: match.status,
        redPlayer: match.redPlayer,
        blackPlayer: match.blackPlayer,
        aiDifficulty: match.aiDifficulty,
        winnerSide: match.winnerSide,
        endReason: match.endReason,
        initialFen: match.initialFen,
        finalFen: match.finalFen,
        moveHistory,
        moveHistoryWxf: match.moveHistoryWxf,
        redEloBefore: match.redEloBefore,
        blackEloBefore: match.blackEloBefore,
        redEloDelta: match.redEloDelta,
        blackEloDelta: match.blackEloDelta,
        startedAt: match.startedAt.toISOString(),
        endedAt: match.endedAt ? match.endedAt.toISOString() : null,
    };
}
/**
 * GET /api/profile/leaderboard
 * Returns top 50 Xiangqi players ranked by ELO rating descending.
 */
exports.profileRouter.get('/leaderboard', async (_req, res) => {
    try {
        const topPlayers = await database_1.prisma.user.findMany({
            orderBy: [{ eloRating: 'desc' }, { wins: 'desc' }],
            take: 50,
            select: {
                id: true,
                username: true,
                avatarUrl: true,
                eloRating: true,
                gamesPlayed: true,
                wins: true,
                losses: true,
                draws: true,
            },
        });
        res.status(200).json({ leaderboard: topPlayers });
    }
    catch (err) {
        console.error('[Leaderboard Error]:', err);
        res.status(500).json({
            error: 'INTERNAL_SERVER_ERROR',
            message: 'Không thể tải bảng xếp hạng ELO.',
        });
    }
});
/**
 * GET /api/profile/matches/:matchId
 * Fetches full details and move-by-move notation of a completed or adjourned match for Replay.
 */
exports.profileRouter.get('/matches/:matchId', async (req, res) => {
    try {
        const { matchId } = req.params;
        const match = await database_1.prisma.match.findUnique({
            where: { id: matchId },
            include: {
                redPlayer: {
                    select: { id: true, username: true, avatarUrl: true, eloRating: true },
                },
                blackPlayer: {
                    select: { id: true, username: true, avatarUrl: true, eloRating: true },
                },
            },
        });
        if (!match) {
            res.status(404).json({
                error: 'MATCH_NOT_FOUND',
                message: 'Không tìm thấy biên bản ván đấu.',
            });
            return;
        }
        res.status(200).json({
            match: formatMatchSummary(match),
        });
    }
    catch (err) {
        console.error('[Match Detail Error]:', err);
        res.status(500).json({
            error: 'INTERNAL_SERVER_ERROR',
            message: 'Lỗi khi tải biên bản ván đấu.',
        });
    }
});
/**
 * GET /api/profile/:username
 * Fetches a player's profile (Username, Avatar, ELO, Win/Draw/Loss stats) and recent Match History.
 */
exports.profileRouter.get('/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
        const user = await database_1.prisma.user.findFirst({
            where: { username: { equals: username, mode: 'insensitive' } },
            select: {
                id: true,
                username: true,
                email: true,
                avatarUrl: true,
                eloRating: true,
                gamesPlayed: true,
                wins: true,
                losses: true,
                draws: true,
                createdAt: true,
            },
        });
        if (!user) {
            res.status(404).json({
                error: 'USER_NOT_FOUND',
                message: 'Không tìm thấy kỳ thủ này.',
            });
            return;
        }
        const matches = await database_1.prisma.match.findMany({
            where: {
                OR: [{ redPlayerId: user.id }, { blackPlayerId: user.id }],
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: {
                redPlayer: {
                    select: { id: true, username: true, avatarUrl: true, eloRating: true },
                },
                blackPlayer: {
                    select: { id: true, username: true, avatarUrl: true, eloRating: true },
                },
            },
        });
        const winRate = user.gamesPlayed > 0
            ? Number(((user.wins / user.gamesPlayed) * 100).toFixed(1))
            : 0;
        res.status(200).json({
            profile: {
                id: user.id,
                username: user.username,
                avatarUrl: user.avatarUrl,
                eloRating: user.eloRating,
                gamesPlayed: user.gamesPlayed,
                wins: user.wins,
                losses: user.losses,
                draws: user.draws,
                winRate,
                createdAt: user.createdAt.toISOString(),
            },
            matchHistory: matches.map(formatMatchSummary),
        });
    }
    catch (err) {
        console.error('[Profile Get Error]:', err);
        res.status(500).json({
            error: 'INTERNAL_SERVER_ERROR',
            message: 'Lỗi khi tải hồ sơ kỳ thủ.',
        });
    }
});
/**
 * PATCH /api/profile/me
 * Updates authenticated player's avatarUrl or password.
 */
exports.profileRouter.patch('/me', auth_middleware_1.requireAuth, async (req, res) => {
    try {
        const parsed = updateProfileSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                error: 'VALIDATION_ERROR',
                message: parsed.error.issues[0]?.message || 'Dữ liệu cập nhật không hợp lệ.',
            });
            return;
        }
        const userId = req.user.userId;
        const { avatarUrl, currentPassword, newPassword } = parsed.data;
        const user = await database_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            res.status(404).json({
                error: 'USER_NOT_FOUND',
                message: 'Không tìm thấy tài khoản.',
            });
            return;
        }
        const updateData = {};
        if (avatarUrl) {
            updateData.avatarUrl = avatarUrl;
        }
        if (newPassword) {
            if (!currentPassword) {
                res.status(400).json({
                    error: 'CURRENT_PASSWORD_REQUIRED',
                    message: 'Vui lòng nhập mật khẩu hiện tại để đổi mật khẩu mới.',
                });
                return;
            }
            const matchesCurrent = await (0, password_1.verifyPassword)(currentPassword, user.passwordHash);
            if (!matchesCurrent) {
                res.status(401).json({
                    error: 'INVALID_CURRENT_PASSWORD',
                    message: 'Mật khẩu hiện tại không đúng.',
                });
                return;
            }
            updateData.passwordHash = await (0, password_1.hashPassword)(newPassword, 12);
        }
        const updatedUser = await database_1.prisma.user.update({
            where: { id: userId },
            data: updateData,
        });
        res.status(200).json({
            message: 'Cập nhật hồ sơ thành công.',
            user: {
                id: updatedUser.id,
                username: updatedUser.username,
                email: updatedUser.email,
                avatarUrl: updatedUser.avatarUrl,
                eloRating: updatedUser.eloRating,
                gamesPlayed: updatedUser.gamesPlayed,
                wins: updatedUser.wins,
                losses: updatedUser.losses,
                draws: updatedUser.draws,
                createdAt: updatedUser.createdAt.toISOString(),
            },
        });
    }
    catch (err) {
        console.error('[Profile Update Error]:', err);
        res.status(500).json({
            error: 'INTERNAL_SERVER_ERROR',
            message: 'Lỗi khi cập nhật hồ sơ.',
        });
    }
});
//# sourceMappingURL=profile.routes.js.map