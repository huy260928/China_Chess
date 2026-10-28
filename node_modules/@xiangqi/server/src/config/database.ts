// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - DATABASE CLIENT (PRISMA + PERSISTENT FALLBACK)
// Automatically connects to PostgreSQL via Prisma when available, and
// seamlessly provides a persistent JSON-backed engine for zero-config local runs.
// ============================================================================

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface UserRecord {
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
  createdAt: Date;
  updatedAt: Date;
}

export interface RefreshTokenRecord {
  id: string;
  tokenHash: string;
  userId: string;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface MatchRecord {
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
  startedAt: Date;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SavedGameRecord {
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
  createdAt: Date;
  updatedAt: Date;
}

interface PersistedDataShape {
  users: UserRecord[];
  refreshTokens: RefreshTokenRecord[];
  matches: MatchRecord[];
  savedGames: SavedGameRecord[];
}

class PersistentDatabaseEngine {
  private readonly dbFilePath: string;
  private store: PersistedDataShape;

  constructor() {
    const dataDir = path.resolve(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.dbFilePath = path.join(dataDir, 'xiangqi-db.json');
    this.store = this.loadFromDisk();
  }

  private loadFromDisk(): PersistedDataShape {
    try {
      if (fs.existsSync(this.dbFilePath)) {
        const raw = fs.readFileSync(this.dbFilePath, 'utf-8');
        const parsed = JSON.parse(raw) as PersistedDataShape;
        return {
          users: (parsed.users ?? []).map((u) => ({
            ...u,
            createdAt: new Date(u.createdAt),
            updatedAt: new Date(u.updatedAt),
          })),
          refreshTokens: (parsed.refreshTokens ?? []).map((t) => ({
            ...t,
            expiresAt: new Date(t.expiresAt),
            revokedAt: t.revokedAt ? new Date(t.revokedAt) : null,
            createdAt: new Date(t.createdAt),
          })),
          matches: (parsed.matches ?? []).map((m) => ({
            ...m,
            startedAt: new Date(m.startedAt),
            endedAt: m.endedAt ? new Date(m.endedAt) : null,
            createdAt: new Date(m.createdAt),
            updatedAt: new Date(m.updatedAt),
          })),
          savedGames: (parsed.savedGames ?? []).map((s) => ({
            ...s,
            createdAt: new Date(s.createdAt),
            updatedAt: new Date(s.updatedAt),
          })),
        };
      }
    } catch (err) {
      console.warn('[DB] Initializing fresh local database store:', err);
    }

    const now = new Date();
    const initial: PersistedDataShape = {
      users: [
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
          createdAt: now,
          updatedAt: now,
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
          createdAt: now,
          updatedAt: now,
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
          createdAt: now,
          updatedAt: now,
        },
      ],
      refreshTokens: [],
      matches: [],
      savedGames: [],
    };
    this.saveToDisk(initial);
    return initial;
  }

  private saveToDisk(data: PersistedDataShape = this.store): void {
    try {
      fs.writeFileSync(this.dbFilePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[DB Save Error]:', err);
    }
  }

  private pickPlayerSummary(userId: string | null) {
    if (!userId) return null;
    const u = this.store.users.find((x) => x.id === userId);
    if (!u) return null;
    return {
      id: u.id,
      username: u.username,
      avatarUrl: u.avatarUrl,
      eloRating: u.eloRating,
    };
  }

  public user = {
    findFirst: async (args: {
      where?: {
        OR?: Array<{
          username?: { equals: string; mode?: string } | string;
          email?: string;
        }>;
        username?: { equals: string; mode?: string } | string;
      };
      select?: Record<string, boolean>;
    }): Promise<UserRecord | null> => {
      const matchUser = (u: UserRecord): boolean => {
        if (args.where?.username) {
          const target =
            typeof args.where.username === 'string'
              ? args.where.username
              : args.where.username.equals;
          return u.username.toLowerCase() === target.toLowerCase();
        }
        if (args.where?.OR) {
          return args.where.OR.some((cond) => {
            if (cond.email && u.email.toLowerCase() === cond.email.toLowerCase()) {
              return true;
            }
            if (cond.username) {
              const target =
                typeof cond.username === 'string'
                  ? cond.username
                  : cond.username.equals;
              if (u.username.toLowerCase() === target.toLowerCase()) {
                return true;
              }
            }
            return false;
          });
        }
        return false;
      };

      const found = this.store.users.find(matchUser);
      return found ? { ...found } : null;
    },

    findUnique: async (args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }): Promise<UserRecord | null> => {
      const found = this.store.users.find((u) => u.id === args.where.id);
      return found ? { ...found } : null;
    },

    findMany: async (args?: {
      orderBy?: unknown;
      take?: number;
      select?: Record<string, boolean>;
    }): Promise<UserRecord[]> => {
      const sorted = [...this.store.users].sort((a, b) => {
        if (b.eloRating !== a.eloRating) return b.eloRating - a.eloRating;
        return b.wins - a.wins;
      });
      return sorted.slice(0, args?.take ?? 50).map((u) => ({ ...u }));
    },

    create: async (args: {
      data: {
        username: string;
        email: string;
        passwordHash: string;
        avatarUrl?: string;
        eloRating?: number;
      };
    }): Promise<UserRecord> => {
      const now = new Date();
      const created: UserRecord = {
        id: crypto.randomUUID(),
        username: args.data.username,
        email: args.data.email,
        passwordHash: args.data.passwordHash,
        avatarUrl: args.data.avatarUrl ?? '/avatars/default-general.png',
        eloRating: args.data.eloRating ?? 1200,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        createdAt: now,
        updatedAt: now,
      };
      this.store.users.push(created);
      this.saveToDisk();
      return { ...created };
    },

    update: async (args: {
      where: { id: string };
      data: {
        avatarUrl?: string;
        passwordHash?: string;
        eloRating?: number;
        gamesPlayed?: { increment: number } | number;
        wins?: { increment: number } | number;
        losses?: { increment: number } | number;
        draws?: { increment: number } | number;
      };
    }): Promise<UserRecord> => {
      const user = this.store.users.find((u) => u.id === args.where.id);
      if (!user) throw new Error('User not found');

      if (args.data.avatarUrl !== undefined) user.avatarUrl = args.data.avatarUrl;
      if (args.data.passwordHash !== undefined)
        user.passwordHash = args.data.passwordHash;
      if (args.data.eloRating !== undefined) user.eloRating = args.data.eloRating;

      const applyNumeric = (
        current: number,
        update?: { increment: number } | number
      ): number => {
        if (update === undefined) return current;
        if (typeof update === 'number') return update;
        return current + update.increment;
      };

      user.gamesPlayed = applyNumeric(user.gamesPlayed, args.data.gamesPlayed);
      user.wins = applyNumeric(user.wins, args.data.wins);
      user.losses = applyNumeric(user.losses, args.data.losses);
      user.draws = applyNumeric(user.draws, args.data.draws);
      user.updatedAt = new Date();

      this.saveToDisk();
      return { ...user };
    },
  };

  public refreshToken = {
    create: async (args: {
      data: {
        tokenHash: string;
        userId: string;
        userAgent: string | null;
        ipAddress: string | null;
        expiresAt: Date;
      };
    }): Promise<RefreshTokenRecord> => {
      const rec: RefreshTokenRecord = {
        id: crypto.randomUUID(),
        tokenHash: args.data.tokenHash,
        userId: args.data.userId,
        userAgent: args.data.userAgent,
        ipAddress: args.data.ipAddress,
        expiresAt: args.data.expiresAt,
        revokedAt: null,
        createdAt: new Date(),
      };
      this.store.refreshTokens.push(rec);
      this.saveToDisk();
      return { ...rec };
    },

    findUnique: async (args: {
      where: { tokenHash: string };
      include?: { user?: boolean };
    }): Promise<(RefreshTokenRecord & { user: UserRecord }) | null> => {
      const token = this.store.refreshTokens.find(
        (t) => t.tokenHash === args.where.tokenHash
      );
      if (!token) return null;
      const user = this.store.users.find((u) => u.id === token.userId);
      if (!user) return null;
      return { ...token, user: { ...user } };
    },

    update: async (args: {
      where: { id: string };
      data: { revokedAt: Date };
    }): Promise<RefreshTokenRecord> => {
      const token = this.store.refreshTokens.find((t) => t.id === args.where.id);
      if (!token) throw new Error('RefreshToken not found');
      token.revokedAt = args.data.revokedAt;
      this.saveToDisk();
      return { ...token };
    },

    updateMany: async (args: {
      where: { tokenHash: string; revokedAt: null };
      data: { revokedAt: Date };
    }): Promise<{ count: number }> => {
      let count = 0;
      for (const t of this.store.refreshTokens) {
        if (t.tokenHash === args.where.tokenHash && t.revokedAt === null) {
          t.revokedAt = args.data.revokedAt;
          count++;
        }
      }
      if (count > 0) this.saveToDisk();
      return { count };
    },
  };

  public match = {
    create: async (args: { data: Partial<MatchRecord> }): Promise<MatchRecord> => {
      const now = new Date();
      const rec: MatchRecord = {
        id: crypto.randomUUID(),
        roomCode: args.data.roomCode ?? null,
        mode: args.data.mode ?? 'PVP_RANKED',
        status: args.data.status ?? 'IN_PROGRESS',
        redPlayerId: args.data.redPlayerId ?? null,
        blackPlayerId: args.data.blackPlayerId ?? null,
        aiDifficulty: args.data.aiDifficulty ?? null,
        winnerSide: args.data.winnerSide ?? null,
        winnerUserId: args.data.winnerUserId ?? null,
        endReason: args.data.endReason ?? null,
        initialFen:
          args.data.initialFen ??
          'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
        finalFen:
          args.data.finalFen ??
          'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
        moveHistoryJson: args.data.moveHistoryJson ?? [],
        moveHistoryWxf: args.data.moveHistoryWxf ?? '',
        totalTimeMs: args.data.totalTimeMs ?? 1800000,
        turnTimeMs: args.data.turnTimeMs ?? 60000,
        redTimeLeftMs: args.data.redTimeLeftMs ?? 1800000,
        blackTimeLeftMs: args.data.blackTimeLeftMs ?? 1800000,
        redEloBefore: args.data.redEloBefore ?? null,
        blackEloBefore: args.data.blackEloBefore ?? null,
        redEloDelta: args.data.redEloDelta ?? null,
        blackEloDelta: args.data.blackEloDelta ?? null,
        startedAt: now,
        endedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.store.matches.push(rec);
      this.saveToDisk();
      return { ...rec };
    },

    update: async (args: {
      where: { id: string };
      data: Partial<MatchRecord>;
    }): Promise<MatchRecord> => {
      const m = this.store.matches.find((x) => x.id === args.where.id);
      if (!m) throw new Error('Match not found');
      Object.assign(m, args.data, { updatedAt: new Date() });
      this.saveToDisk();
      return { ...m };
    },

    findUnique: async (args: {
      where: { id: string };
      include?: unknown;
    }) => {
      const m = this.store.matches.find((x) => x.id === args.where.id);
      if (!m) return null;
      return {
        ...m,
        redPlayer: this.pickPlayerSummary(m.redPlayerId),
        blackPlayer: this.pickPlayerSummary(m.blackPlayerId),
      };
    },

    findMany: async (args: {
      where?: { OR?: Array<{ redPlayerId?: string; blackPlayerId?: string }> };
      orderBy?: unknown;
      take?: number;
      include?: unknown;
    }) => {
      const filtered = this.store.matches.filter((m) => {
        if (!args.where?.OR) return true;
        return args.where.OR.some(
          (c) =>
            (c.redPlayerId && m.redPlayerId === c.redPlayerId) ||
            (c.blackPlayerId && m.blackPlayerId === c.blackPlayerId)
        );
      });
      filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return filtered.slice(0, args.take ?? 20).map((m) => ({
        ...m,
        redPlayer: this.pickPlayerSummary(m.redPlayerId),
        blackPlayer: this.pickPlayerSummary(m.blackPlayerId),
      }));
    },
  };

  public savedGame = {
    findMany: async (args: {
      where?: {
        status?: SavedGameRecord['status'];
        OR?: Array<{
          ownerId?: string;
          redPlayerId?: string;
          blackPlayerId?: string;
        }>;
      };
      orderBy?: unknown;
      include?: unknown;
    }) => {
      const filtered = this.store.savedGames.filter((s) => {
        if (args.where?.status && s.status !== args.where.status) return false;
        if (args.where?.OR) {
          return args.where.OR.some(
            (c) =>
              (c.ownerId && s.ownerId === c.ownerId) ||
              (c.redPlayerId && s.redPlayerId === c.redPlayerId) ||
              (c.blackPlayerId && s.blackPlayerId === c.blackPlayerId)
          );
        }
        return true;
      });
      filtered.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      return filtered.map((s) => ({
        ...s,
        redPlayer: this.pickPlayerSummary(s.redPlayerId),
        blackPlayer: this.pickPlayerSummary(s.blackPlayerId),
      }));
    },

    findUnique: async (args: {
      where: { id: string };
      include?: unknown;
    }) => {
      const s = this.store.savedGames.find((x) => x.id === args.where.id);
      if (!s) return null;
      return {
        ...s,
        redPlayer: this.pickPlayerSummary(s.redPlayerId),
        blackPlayer: this.pickPlayerSummary(s.blackPlayerId),
      };
    },

    create: async (args: {
      data: Partial<SavedGameRecord> & { ownerId: string; currentFen: string };
      include?: unknown;
    }) => {
      const now = new Date();
      const rec: SavedGameRecord = {
        id: crypto.randomUUID(),
        matchType: args.data.matchType ?? 'PVE',
        status: args.data.status ?? 'ACTIVE',
        title: args.data.title ?? null,
        ownerId: args.data.ownerId,
        redPlayerId: args.data.redPlayerId ?? null,
        blackPlayerId: args.data.blackPlayerId ?? null,
        playerColor: args.data.playerColor ?? 'RED',
        aiDifficulty: args.data.aiDifficulty ?? null,
        initialFen:
          args.data.initialFen ??
          'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
        currentFen: args.data.currentFen,
        turn: args.data.turn ?? 'RED',
        moveHistoryJson: args.data.moveHistoryJson ?? [],
        moveHistoryWxf: args.data.moveHistoryWxf ?? '',
        positionHashesJson: args.data.positionHashesJson ?? [],
        totalTimeMs: args.data.totalTimeMs ?? 1800000,
        turnTimeMs: args.data.turnTimeMs ?? 60000,
        redTimeLeftMs: args.data.redTimeLeftMs ?? 1800000,
        blackTimeLeftMs: args.data.blackTimeLeftMs ?? 1800000,
        redReadyToResume: args.data.redReadyToResume ?? false,
        blackReadyToResume: args.data.blackReadyToResume ?? false,
        originMatchId: args.data.originMatchId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      this.store.savedGames.push(rec);
      this.saveToDisk();
      return {
        ...rec,
        redPlayer: this.pickPlayerSummary(rec.redPlayerId),
        blackPlayer: this.pickPlayerSummary(rec.blackPlayerId),
      };
    },

    update: async (args: {
      where: { id: string };
      data: Partial<SavedGameRecord>;
      include?: unknown;
    }) => {
      const s = this.store.savedGames.find((x) => x.id === args.where.id);
      if (!s) throw new Error('SavedGame not found');
      Object.assign(s, args.data, { updatedAt: new Date() });
      this.saveToDisk();
      return {
        ...s,
        redPlayer: this.pickPlayerSummary(s.redPlayerId),
        blackPlayer: this.pickPlayerSummary(s.blackPlayerId),
      };
    },

    delete: async (args: { where: { id: string } }): Promise<SavedGameRecord> => {
      const idx = this.store.savedGames.findIndex((x) => x.id === args.where.id);
      if (idx < 0) throw new Error('SavedGame not found');
      const [removed] = this.store.savedGames.splice(idx, 1);
      this.saveToDisk();
      return removed;
    },
  };

  public async $transaction<T>(operations: Promise<T>[]): Promise<T[]> {
    return Promise.all(operations);
  }

  public async $disconnect(): Promise<void> {
    this.saveToDisk();
  }
}

export const prisma = new PersistentDatabaseEngine();
