"use strict";
// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - POSTGRESQL PRISMA DATABASE CLIENT
// Connects directly to the external PostgreSQL 18 database (`xiangqi_db`)
// configured via `DATABASE_URL` in `.env`.
// ============================================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
exports.connectAndSeedDatabase = connectAndSeedDatabase;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const env_1 = require("./env");
const globalForPrisma = globalThis;
exports.prisma = globalForPrisma.xiangqiPrisma ??
    new client_1.PrismaClient({
        datasources: {
            db: {
                url: env_1.ENV.DATABASE_URL,
            },
        },
        log: env_1.ENV.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
if (env_1.ENV.NODE_ENV !== 'production') {
    globalForPrisma.xiangqiPrisma = exports.prisma;
}
const DEFAULT_GRANDMASTERS = [
    {
        id: '00000000-0000-4000-8000-000000000001',
        username: 'HuaNganXuyen',
        email: 'huanganxuyen@xiangqi.vn',
        passwordHash: '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4oL8/.1/1e',
        avatarUrl: '/avatars/default-general.png',
        eloRating: 2240,
        gamesPlayed: 84,
        wins: 62,
        losses: 8,
        draws: 14,
    },
    {
        id: '00000000-0000-4000-8000-000000000002',
        username: 'VuongThienNhat',
        email: 'vuongthiennhat@xiangqi.vn',
        passwordHash: '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4oL8/.1/1e',
        avatarUrl: '/avatars/default-general.png',
        eloRating: 2310,
        gamesPlayed: 96,
        wins: 74,
        losses: 9,
        draws: 13,
    },
    {
        id: '00000000-0000-4000-8000-000000000003',
        username: 'LaiLyHuynh',
        email: 'lailyhuynh@xiangqi.vn',
        passwordHash: '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4oL8/.1/1e',
        avatarUrl: '/avatars/default-general.png',
        eloRating: 2195,
        gamesPlayed: 70,
        wins: 51,
        losses: 9,
        draws: 10,
    },
];
/**
 * Connects to PostgreSQL (`xiangqi_db`) and performs a one-time idempotent
 * migration of any pre-existing local records from `server/data/xiangqi-db.json`
 * (excluding temporary `@xiangqi.test` test-suite accounts) when PostgreSQL is empty.
 */
async function connectAndSeedDatabase() {
    await exports.prisma.$connect();
    console.log('[PostgreSQL] Connected to PostgreSQL database (xiangqi_db).');
    const existingUserCount = await exports.prisma.user.count();
    if (existingUserCount > 0) {
        return;
    }
    const legacyPath = path_1.default.resolve(__dirname, '../../data/xiangqi-db.json');
    if (fs_1.default.existsSync(legacyPath)) {
        try {
            const raw = fs_1.default.readFileSync(legacyPath, 'utf-8');
            const dump = JSON.parse(raw);
            const realUsers = (dump.users ?? []).filter((u) => !u.email.endsWith('@xiangqi.test'));
            const validUserIds = new Set(realUsers.map((u) => u.id));
            for (const u of realUsers) {
                await exports.prisma.user.upsert({
                    where: { id: u.id },
                    update: {},
                    create: {
                        id: u.id,
                        username: u.username,
                        email: u.email,
                        passwordHash: u.passwordHash,
                        avatarUrl: u.avatarUrl,
                        eloRating: u.eloRating,
                        gamesPlayed: u.gamesPlayed,
                        wins: u.wins,
                        losses: u.losses,
                        draws: u.draws,
                        createdAt: new Date(u.createdAt),
                        updatedAt: new Date(u.updatedAt),
                    },
                });
            }
            const realMatches = (dump.matches ?? []).filter((m) => (m.redPlayerId === null || validUserIds.has(m.redPlayerId)) &&
                (m.blackPlayerId === null || validUserIds.has(m.blackPlayerId)));
            const validMatchIds = new Set(realMatches.map((m) => m.id));
            for (const m of realMatches) {
                await exports.prisma.match.upsert({
                    where: { id: m.id },
                    update: {},
                    create: {
                        id: m.id,
                        roomCode: m.roomCode,
                        mode: m.mode,
                        status: m.status,
                        redPlayerId: m.redPlayerId,
                        blackPlayerId: m.blackPlayerId,
                        aiDifficulty: m.aiDifficulty,
                        winnerSide: m.winnerSide,
                        winnerUserId: m.winnerUserId && validUserIds.has(m.winnerUserId)
                            ? m.winnerUserId
                            : null,
                        endReason: m.endReason,
                        initialFen: m.initialFen,
                        finalFen: m.finalFen,
                        moveHistoryJson: (m.moveHistoryJson ?? []),
                        moveHistoryWxf: m.moveHistoryWxf ?? '',
                        totalTimeMs: m.totalTimeMs,
                        turnTimeMs: m.turnTimeMs,
                        redTimeLeftMs: m.redTimeLeftMs,
                        blackTimeLeftMs: m.blackTimeLeftMs,
                        redEloBefore: m.redEloBefore,
                        blackEloBefore: m.blackEloBefore,
                        redEloDelta: m.redEloDelta,
                        blackEloDelta: m.blackEloDelta,
                        startedAt: new Date(m.startedAt),
                        endedAt: m.endedAt ? new Date(m.endedAt) : null,
                        createdAt: new Date(m.createdAt),
                        updatedAt: new Date(m.updatedAt),
                    },
                });
            }
            const realSavedGames = (dump.savedGames ?? []).filter((s) => validUserIds.has(s.ownerId));
            for (const s of realSavedGames) {
                await exports.prisma.savedGame.upsert({
                    where: { id: s.id },
                    update: {},
                    create: {
                        id: s.id,
                        matchType: s.matchType,
                        status: s.status,
                        title: s.title,
                        ownerId: s.ownerId,
                        redPlayerId: s.redPlayerId && validUserIds.has(s.redPlayerId)
                            ? s.redPlayerId
                            : null,
                        blackPlayerId: s.blackPlayerId && validUserIds.has(s.blackPlayerId)
                            ? s.blackPlayerId
                            : null,
                        playerColor: s.playerColor,
                        aiDifficulty: s.aiDifficulty,
                        initialFen: s.initialFen,
                        currentFen: s.currentFen,
                        turn: s.turn,
                        moveHistoryJson: (s.moveHistoryJson ?? []),
                        moveHistoryWxf: s.moveHistoryWxf ?? '',
                        positionHashesJson: (s.positionHashesJson ?? []),
                        totalTimeMs: s.totalTimeMs,
                        turnTimeMs: s.turnTimeMs,
                        redTimeLeftMs: s.redTimeLeftMs,
                        blackTimeLeftMs: s.blackTimeLeftMs,
                        redReadyToResume: s.redReadyToResume,
                        blackReadyToResume: s.blackReadyToResume,
                        originMatchId: s.originMatchId && validMatchIds.has(s.originMatchId)
                            ? s.originMatchId
                            : null,
                        createdAt: new Date(s.createdAt),
                        updatedAt: new Date(s.updatedAt),
                    },
                });
            }
            console.log(`[PostgreSQL] Migrated ${realUsers.length} users, ${realMatches.length} matches, and ${realSavedGames.length} saved games into xiangqi_db.`);
            return;
        }
        catch (err) {
            console.warn('[PostgreSQL] Legacy JSON migration skipped, seeding defaults:', err);
        }
    }
    for (const gm of DEFAULT_GRANDMASTERS) {
        await exports.prisma.user.upsert({
            where: { id: gm.id },
            update: {},
            create: gm,
        });
    }
    console.log('[PostgreSQL] Seeded 3 initial Grandmaster accounts.');
}
//# sourceMappingURL=database.js.map