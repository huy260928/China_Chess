// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - POSTGRESQL PRISMA DATABASE CLIENT
// Connects directly to the external PostgreSQL 18 database (`xiangqi_db`)
// configured via `DATABASE_URL` in `.env`.
// ============================================================================

import fs from 'fs';
import path from 'path';
import { Prisma, PrismaClient } from '@prisma/client';
import { ENV } from './env';

const globalForPrisma = globalThis as unknown as {
  xiangqiPrisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.xiangqiPrisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: ENV.DATABASE_URL,
      },
    },
    log: ENV.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (ENV.NODE_ENV !== 'production') {
  globalForPrisma.xiangqiPrisma = prisma;
}

interface LegacyJsonDump {
  users?: Array<{
    id: string;
    username: string;
    email: string;
    passwordHash: string;
    avatarUrl: string;
    eloRating: number;
    gamesPlayed: number;
    wins: number;
    losses: number;
    draws: number;
    createdAt: string;
    updatedAt: string;
  }>;
  matches?: Array<{
    id: string;
    roomCode: string | null;
    mode: 'PVP_RANKED' | 'PVP_CASUAL' | 'PVE_AI';
    status: 'IN_PROGRESS' | 'COMPLETED' | 'ADJOURNED' | 'ABORTED';
    redPlayerId: string | null;
    blackPlayerId: string | null;
    aiDifficulty: 'EASY' | 'MEDIUM' | 'HARD' | null;
    winnerSide: 'RED' | 'BLACK' | null;
    winnerUserId: string | null;
    endReason:
      | 'CHECKMATE'
      | 'STALEMATE'
      | 'TIMEOUT'
      | 'RESIGNATION'
      | 'DRAW_AGREEMENT'
      | 'DRAW_REPETITION'
      | 'DRAW_FIFTY_MOVE'
      | 'DRAW_INSUFFICIENT_MATERIAL'
      | 'ADJOURNED'
      | 'ABANDONED'
      | null;
    initialFen: string;
    finalFen: string;
    moveHistoryJson: unknown;
    moveHistoryWxf: string;
    totalTimeMs: number;
    turnTimeMs: number;
    redTimeLeftMs: number;
    blackTimeLeftMs: number;
    redEloBefore: number | null;
    blackEloBefore: number | null;
    redEloDelta: number | null;
    blackEloDelta: number | null;
    startedAt: string;
    endedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  savedGames?: Array<{
    id: string;
    matchType: 'PVE' | 'PVP_ADJOURNED';
    status: 'ACTIVE' | 'RESUMED' | 'COMPLETED' | 'EXPIRED';
    title: string | null;
    ownerId: string;
    redPlayerId: string | null;
    blackPlayerId: string | null;
    playerColor: 'RED' | 'BLACK';
    aiDifficulty: 'EASY' | 'MEDIUM' | 'HARD' | null;
    initialFen: string;
    currentFen: string;
    turn: 'RED' | 'BLACK';
    moveHistoryJson: unknown;
    moveHistoryWxf: string;
    positionHashesJson: unknown;
    totalTimeMs: number;
    turnTimeMs: number;
    redTimeLeftMs: number;
    blackTimeLeftMs: number;
    redReadyToResume: boolean;
    blackReadyToResume: boolean;
    originMatchId: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
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
export async function connectAndSeedDatabase(): Promise<void> {
  await prisma.$connect();
  console.log('[PostgreSQL] Connected to PostgreSQL database (xiangqi_db).');

  const existingUserCount = await prisma.user.count();
  if (existingUserCount > 0) {
    return;
  }

  const legacyPath = path.resolve(__dirname, '../../data/xiangqi-db.json');
  if (fs.existsSync(legacyPath)) {
    try {
      const raw = fs.readFileSync(legacyPath, 'utf-8');
      const dump = JSON.parse(raw) as LegacyJsonDump;

      const realUsers = (dump.users ?? []).filter(
        (u) => !u.email.endsWith('@xiangqi.test')
      );
      const validUserIds = new Set(realUsers.map((u) => u.id));

      for (const u of realUsers) {
        await prisma.user.upsert({
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

      const realMatches = (dump.matches ?? []).filter(
        (m) =>
          (m.redPlayerId === null || validUserIds.has(m.redPlayerId)) &&
          (m.blackPlayerId === null || validUserIds.has(m.blackPlayerId))
      );
      const validMatchIds = new Set(realMatches.map((m) => m.id));

      for (const m of realMatches) {
        await prisma.match.upsert({
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
            winnerUserId:
              m.winnerUserId && validUserIds.has(m.winnerUserId)
                ? m.winnerUserId
                : null,
            endReason: m.endReason,
            initialFen: m.initialFen,
            finalFen: m.finalFen,
            moveHistoryJson: (m.moveHistoryJson ?? []) as Prisma.InputJsonValue,
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

      const realSavedGames = (dump.savedGames ?? []).filter((s) =>
        validUserIds.has(s.ownerId)
      );

      for (const s of realSavedGames) {
        await prisma.savedGame.upsert({
          where: { id: s.id },
          update: {},
          create: {
            id: s.id,
            matchType: s.matchType,
            status: s.status,
            title: s.title,
            ownerId: s.ownerId,
            redPlayerId:
              s.redPlayerId && validUserIds.has(s.redPlayerId)
                ? s.redPlayerId
                : null,
            blackPlayerId:
              s.blackPlayerId && validUserIds.has(s.blackPlayerId)
                ? s.blackPlayerId
                : null,
            playerColor: s.playerColor,
            aiDifficulty: s.aiDifficulty,
            initialFen: s.initialFen,
            currentFen: s.currentFen,
            turn: s.turn,
            moveHistoryJson: (s.moveHistoryJson ?? []) as Prisma.InputJsonValue,
            moveHistoryWxf: s.moveHistoryWxf ?? '',
            positionHashesJson: (s.positionHashesJson ?? []) as Prisma.InputJsonValue,
            totalTimeMs: s.totalTimeMs,
            turnTimeMs: s.turnTimeMs,
            redTimeLeftMs: s.redTimeLeftMs,
            blackTimeLeftMs: s.blackTimeLeftMs,
            redReadyToResume: s.redReadyToResume,
            blackReadyToResume: s.blackReadyToResume,
            originMatchId:
              s.originMatchId && validMatchIds.has(s.originMatchId)
                ? s.originMatchId
                : null,
            createdAt: new Date(s.createdAt),
            updatedAt: new Date(s.updatedAt),
          },
        });
      }

      console.log(
        `[PostgreSQL] Migrated ${realUsers.length} users, ${realMatches.length} matches, and ${realSavedGames.length} saved games into xiangqi_db.`
      );
      return;
    } catch (err) {
      console.warn('[PostgreSQL] Legacy JSON migration skipped, seeding defaults:', err);
    }
  }

  for (const gm of DEFAULT_GRANDMASTERS) {
    await prisma.user.upsert({
      where: { id: gm.id },
      update: {},
      create: gm,
    });
  }
  console.log('[PostgreSQL] Seeded 3 initial Grandmaster accounts.');
}
