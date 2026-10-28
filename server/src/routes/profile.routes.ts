// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - USER PROFILE, LEADERBOARD & MATCH HISTORY API
// ============================================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ExecutedMove, MatchSummaryDto } from '@xiangqi/shared';
import { prisma } from '../config/database';
import { hashPassword, verifyPassword } from '../utils/password';
import { requireAuth } from '../middlewares/auth.middleware';

export const profileRouter = Router();

const updateProfileSchema = z.object({
  avatarUrl: z.string().trim().min(1).max(512).optional(),
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(6).max(72).optional(),
});

function formatMatchSummary(match: {
  id: string;
  mode: 'PVP_RANKED' | 'PVP_CASUAL' | 'PVE_AI';
  status: 'IN_PROGRESS' | 'COMPLETED' | 'ADJOURNED' | 'ABORTED';
  redPlayer: { id: string; username: string; avatarUrl: string; eloRating: number } | null;
  blackPlayer: { id: string; username: string; avatarUrl: string; eloRating: number } | null;
  aiDifficulty: 'EASY' | 'MEDIUM' | 'HARD' | null;
  winnerSide: 'RED' | 'BLACK' | null;
  endReason: MatchSummaryDto['endReason'];
  initialFen: string;
  finalFen: string;
  moveHistoryJson: unknown;
  moveHistoryWxf: string;
  redEloBefore: number | null;
  blackEloBefore: number | null;
  redEloDelta: number | null;
  blackEloDelta: number | null;
  startedAt: Date;
  endedAt: Date | null;
}): MatchSummaryDto {
  const moveHistory = Array.isArray(match.moveHistoryJson)
    ? (match.moveHistoryJson as ExecutedMove[])
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
profileRouter.get('/leaderboard', async (_req: Request, res: Response): Promise<void> => {
  try {
    const topPlayers = await prisma.user.findMany({
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
  } catch (err: unknown) {
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
profileRouter.get(
  '/matches/:matchId',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { matchId } = req.params;
      const match = await prisma.match.findUnique({
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
    } catch (err: unknown) {
      console.error('[Match Detail Error]:', err);
      res.status(500).json({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Lỗi khi tải biên bản ván đấu.',
      });
    }
  }
);

/**
 * GET /api/profile/:username
 * Fetches a player's profile (Username, Avatar, ELO, Win/Draw/Loss stats) and recent Match History.
 */
profileRouter.get('/:username', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username } = req.params;
    const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));

    const user = await prisma.user.findFirst({
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

    const matches = await prisma.match.findMany({
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

    const winRate =
      user.gamesPlayed > 0
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
  } catch (err: unknown) {
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
profileRouter.patch(
  '/me',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = updateProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Dữ liệu cập nhật không hợp lệ.',
        });
        return;
      }

      const userId = req.user!.userId;
      const { avatarUrl, currentPassword, newPassword } = parsed.data;

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(404).json({
          error: 'USER_NOT_FOUND',
          message: 'Không tìm thấy tài khoản.',
        });
        return;
      }

      const updateData: { avatarUrl?: string; passwordHash?: string } = {};

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
        const matchesCurrent = await verifyPassword(currentPassword, user.passwordHash);
        if (!matchesCurrent) {
          res.status(401).json({
            error: 'INVALID_CURRENT_PASSWORD',
            message: 'Mật khẩu hiện tại không đúng.',
          });
          return;
        }
        updateData.passwordHash = await hashPassword(newPassword, 12);
      }

      const updatedUser = await prisma.user.update({
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
    } catch (err: unknown) {
      console.error('[Profile Update Error]:', err);
      res.status(500).json({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Lỗi khi cập nhật hồ sơ.',
      });
    }
  }
);
