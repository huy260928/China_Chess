"use strict";
// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - SAVE & RESUME MATCH API (PVE & PVP ADJOURNMENT)
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.savedGameRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const shared_1 = require("@xiangqi/shared");
const database_1 = require("../config/database");
const auth_middleware_1 = require("../middlewares/auth.middleware");
exports.savedGameRouter = (0, express_1.Router)();
const savePveGameSchema = zod_1.z.object({
    savedGameId: zod_1.z.string().uuid().optional(),
    title: zod_1.z.string().trim().max(128).optional(),
    playerColor: zod_1.z.enum(['RED', 'BLACK']),
    aiDifficulty: zod_1.z.enum(['EASY', 'MEDIUM', 'HARD']),
    initialFen: zod_1.z.string().trim().min(10).max(255).default(shared_1.INITIAL_XIANGQI_FEN),
    currentFen: zod_1.z.string().trim().min(10).max(255),
    moveHistory: zod_1.z.array(zod_1.z.any()).default([]),
    moveHistoryWxf: zod_1.z.string().default(''),
    positionHashes: zod_1.z.array(zod_1.z.string()).default([]),
    totalTimeMs: zod_1.z.number().int().positive().default(1800000),
    turnTimeMs: zod_1.z.number().int().positive().default(60000),
    redTimeLeftMs: zod_1.z.number().int().nonnegative().default(1800000),
    blackTimeLeftMs: zod_1.z.number().int().nonnegative().default(1800000),
});
function formatSavedGameDto(record) {
    const moveHistory = Array.isArray(record.moveHistoryJson)
        ? record.moveHistoryJson
        : [];
    const positionHashes = Array.isArray(record.positionHashesJson)
        ? record.positionHashesJson
        : [];
    return {
        id: record.id,
        matchType: record.matchType,
        status: record.status,
        title: record.title,
        ownerId: record.ownerId,
        redPlayer: record.redPlayer,
        blackPlayer: record.blackPlayer,
        playerColor: record.playerColor,
        aiDifficulty: record.aiDifficulty,
        initialFen: record.initialFen,
        currentFen: record.currentFen,
        turn: record.turn,
        moveHistory,
        moveHistoryWxf: record.moveHistoryWxf,
        positionHashes,
        totalTimeMs: record.totalTimeMs,
        turnTimeMs: record.turnTimeMs,
        redTimeLeftMs: record.redTimeLeftMs,
        blackTimeLeftMs: record.blackTimeLeftMs,
        redReadyToResume: record.redReadyToResume,
        blackReadyToResume: record.blackReadyToResume,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
    };
}
/**
 * GET /api/saved-games
 * Lists all active Saved Games (both PvE and PvP Adjourned) involving the current player.
 */
exports.savedGameRouter.get('/', auth_middleware_1.requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const savedGames = await database_1.prisma.savedGame.findMany({
            where: {
                status: 'ACTIVE',
                OR: [
                    { ownerId: userId },
                    { redPlayerId: userId },
                    { blackPlayerId: userId },
                ],
            },
            orderBy: { updatedAt: 'desc' },
            include: {
                redPlayer: {
                    select: { id: true, username: true, avatarUrl: true, eloRating: true },
                },
                blackPlayer: {
                    select: { id: true, username: true, avatarUrl: true, eloRating: true },
                },
            },
        });
        res.status(200).json({
            savedGames: savedGames.map(formatSavedGameDto),
        });
    }
    catch (err) {
        console.error('[List Saved Games Error]:', err);
        res.status(500).json({
            error: 'INTERNAL_SERVER_ERROR',
            message: 'Lỗi khi tải danh sách ván cờ đang lưu.',
        });
    }
});
/**
 * GET /api/saved-games/:id
 * Fetches a single saved game by ID if the user is a participant.
 */
exports.savedGameRouter.get('/:id', auth_middleware_1.requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;
        const savedGame = await database_1.prisma.savedGame.findUnique({
            where: { id },
            include: {
                redPlayer: {
                    select: { id: true, username: true, avatarUrl: true, eloRating: true },
                },
                blackPlayer: {
                    select: { id: true, username: true, avatarUrl: true, eloRating: true },
                },
            },
        });
        if (!savedGame) {
            res.status(404).json({
                error: 'SAVED_GAME_NOT_FOUND',
                message: 'Không tìm thấy ván cờ đã lưu.',
            });
            return;
        }
        if (savedGame.ownerId !== userId &&
            savedGame.redPlayerId !== userId &&
            savedGame.blackPlayerId !== userId) {
            res.status(403).json({
                error: 'FORBIDDEN',
                message: 'Bạn không có quyền truy cập ván cờ đã lưu này.',
            });
            return;
        }
        res.status(200).json({
            savedGame: formatSavedGameDto(savedGame),
        });
    }
    catch (err) {
        console.error('[Get Saved Game Error]:', err);
        res.status(500).json({
            error: 'INTERNAL_SERVER_ERROR',
            message: 'Lỗi khi tải dữ liệu ván cờ đã lưu.',
        });
    }
});
/**
 * POST /api/saved-games/pve
 * Saves or updates a PvE (Player vs AI) match state in PostgreSQL so the player
 * can exit and resume later at any time.
 */
exports.savedGameRouter.post('/pve', auth_middleware_1.requireAuth, async (req, res) => {
    try {
        const parsed = savePveGameSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                error: 'VALIDATION_ERROR',
                message: parsed.error.issues[0]?.message || 'Dữ liệu lưu ván cờ không hợp lệ.',
            });
            return;
        }
        const data = parsed.data;
        const fenValidation = shared_1.XiangqiEngine.validateFen(data.currentFen);
        if (!fenValidation.valid) {
            res.status(400).json({
                error: 'INVALID_FEN',
                message: `Chuỗi FEN không hợp lệ: ${fenValidation.error}`,
            });
            return;
        }
        const engine = new shared_1.XiangqiEngine(data.currentFen);
        const currentTurnLabel = engine.getTurn() === 'w' ? 'RED' : 'BLACK';
        const userId = req.user.userId;
        const defaultTitle = data.title ||
            `Đấu với Máy (${data.aiDifficulty}) - Hiệp ${engine.getFullMoveNumber()}`;
        let savedRecord;
        if (data.savedGameId) {
            const existing = await database_1.prisma.savedGame.findUnique({
                where: { id: data.savedGameId },
            });
            if (existing && existing.ownerId === userId && existing.matchType === 'PVE') {
                savedRecord = await database_1.prisma.savedGame.update({
                    where: { id: data.savedGameId },
                    data: {
                        title: defaultTitle,
                        playerColor: data.playerColor,
                        aiDifficulty: data.aiDifficulty,
                        currentFen: data.currentFen,
                        turn: currentTurnLabel,
                        moveHistoryJson: data.moveHistory,
                        moveHistoryWxf: data.moveHistoryWxf,
                        positionHashesJson: data.positionHashes.length > 0
                            ? data.positionHashes
                            : engine.getPositionHashes(),
                        totalTimeMs: data.totalTimeMs,
                        turnTimeMs: data.turnTimeMs,
                        redTimeLeftMs: data.redTimeLeftMs,
                        blackTimeLeftMs: data.blackTimeLeftMs,
                        status: 'ACTIVE',
                    },
                    include: {
                        redPlayer: {
                            select: { id: true, username: true, avatarUrl: true, eloRating: true },
                        },
                        blackPlayer: {
                            select: { id: true, username: true, avatarUrl: true, eloRating: true },
                        },
                    },
                });
            }
        }
        if (!savedRecord) {
            savedRecord = await database_1.prisma.savedGame.create({
                data: {
                    matchType: 'PVE',
                    status: 'ACTIVE',
                    title: defaultTitle,
                    ownerId: userId,
                    redPlayerId: data.playerColor === 'RED' ? userId : null,
                    blackPlayerId: data.playerColor === 'BLACK' ? userId : null,
                    playerColor: data.playerColor,
                    aiDifficulty: data.aiDifficulty,
                    initialFen: data.initialFen,
                    currentFen: data.currentFen,
                    turn: currentTurnLabel,
                    moveHistoryJson: data.moveHistory,
                    moveHistoryWxf: data.moveHistoryWxf,
                    positionHashesJson: data.positionHashes.length > 0
                        ? data.positionHashes
                        : engine.getPositionHashes(),
                    totalTimeMs: data.totalTimeMs,
                    turnTimeMs: data.turnTimeMs,
                    redTimeLeftMs: data.redTimeLeftMs,
                    blackTimeLeftMs: data.blackTimeLeftMs,
                },
                include: {
                    redPlayer: {
                        select: { id: true, username: true, avatarUrl: true, eloRating: true },
                    },
                    blackPlayer: {
                        select: { id: true, username: true, avatarUrl: true, eloRating: true },
                    },
                },
            });
        }
        res.status(201).json({
            message: 'Đã lưu ván cờ PvE thành công.',
            savedGame: formatSavedGameDto(savedRecord),
        });
    }
    catch (err) {
        console.error('[Save PvE Game Error]:', err);
        res.status(500).json({
            error: 'INTERNAL_SERVER_ERROR',
            message: 'Lỗi hệ thống khi lưu ván cờ.',
        });
    }
});
/**
 * POST /api/saved-games/:id/ready-pvp
 * Marks the current user as ready to resume an adjourned PvP match.
 * When both redReadyToResume and blackReadyToResume are true, both players can join the restored room.
 */
exports.savedGameRouter.post('/:id/ready-pvp', auth_middleware_1.requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;
        const savedGame = await database_1.prisma.savedGame.findUnique({
            where: { id },
        });
        if (!savedGame || savedGame.matchType !== 'PVP_ADJOURNED') {
            res.status(404).json({
                error: 'SAVED_GAME_NOT_FOUND',
                message: 'Không tìm thấy ván đấu PvP tạm hoãn này.',
            });
            return;
        }
        if (savedGame.redPlayerId !== userId && savedGame.blackPlayerId !== userId) {
            res.status(403).json({
                error: 'FORBIDDEN',
                message: 'Bạn không phải là kỳ thủ của ván đấu tạm hoãn này.',
            });
            return;
        }
        const isRed = savedGame.redPlayerId === userId;
        const updated = await database_1.prisma.savedGame.update({
            where: { id },
            data: isRed ? { redReadyToResume: true } : { blackReadyToResume: true },
            include: {
                redPlayer: {
                    select: { id: true, username: true, avatarUrl: true, eloRating: true },
                },
                blackPlayer: {
                    select: { id: true, username: true, avatarUrl: true, eloRating: true },
                },
            },
        });
        const bothReady = updated.redReadyToResume && updated.blackReadyToResume;
        res.status(200).json({
            bothReady,
            savedGame: formatSavedGameDto(updated),
        });
    }
    catch (err) {
        console.error('[Ready PvP Saved Game Error]:', err);
        res.status(500).json({
            error: 'INTERNAL_SERVER_ERROR',
            message: 'Lỗi khi xác nhận tiếp tục ván đấu PvP.',
        });
    }
});
/**
 * DELETE /api/saved-games/:id
 * Deletes an active PvE saved game owned by the player.
 */
exports.savedGameRouter.delete('/:id', auth_middleware_1.requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;
        const savedGame = await database_1.prisma.savedGame.findUnique({ where: { id } });
        if (!savedGame) {
            res.status(404).json({
                error: 'SAVED_GAME_NOT_FOUND',
                message: 'Không tìm thấy ván cờ đã lưu.',
            });
            return;
        }
        if (savedGame.ownerId !== userId) {
            res.status(403).json({
                error: 'FORBIDDEN',
                message: 'Bạn không có quyền xóa ván cờ này.',
            });
            return;
        }
        await database_1.prisma.savedGame.delete({ where: { id } });
        res.status(200).json({
            message: 'Đã xóa ván cờ lưu thành công.',
        });
    }
    catch (err) {
        console.error('[Delete Saved Game Error]:', err);
        res.status(500).json({
            error: 'INTERNAL_SERVER_ERROR',
            message: 'Lỗi khi xóa ván cờ đã lưu.',
        });
    }
});
//# sourceMappingURL=saved-game.routes.js.map