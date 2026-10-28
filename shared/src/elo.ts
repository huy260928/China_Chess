// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - INTERNATIONAL STANDARD ELO CALCULATOR
// ============================================================================

import { Side } from './types';

export interface EloUpdateResult {
  redEloBefore: number;
  blackEloBefore: number;
  redEloAfter: number;
  blackEloAfter: number;
  redDelta: number;
  blackDelta: number;
}

/**
 * Determines K-Factor based on player's current ELO rating:
 * - K = 16 for Master-level players (ELO >= 2000)
 * - K = 32 for players below 2000 ELO
 */
export function getKFactor(elo: number): number {
  return elo >= 2000 ? 16 : 32;
}

/**
 * Calculates expected score E_A = 1 / (1 + 10^((R_B - R_A) / 400))
 */
export function calculateExpectedScore(playerElo: number, opponentElo: number): number {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
}

/**
 * Computes new ELO ratings and deltas after a ranked PvP match.
 * @param redElo Current ELO of Red player
 * @param blackElo Current ELO of Black player
 * @param winner 'w' (Red win), 'b' (Black win), or 'draw'
 */
export function calculateMatchElo(
  redElo: number,
  blackElo: number,
  winner: Side | 'draw'
): EloUpdateResult {
  const expectedRed = calculateExpectedScore(redElo, blackElo);
  const expectedBlack = calculateExpectedScore(blackElo, redElo);

  const actualRed = winner === 'w' ? 1 : winner === 'b' ? 0 : 0.5;
  const actualBlack = winner === 'b' ? 1 : winner === 'w' ? 0 : 0.5;

  const kRed = getKFactor(redElo);
  const kBlack = getKFactor(blackElo);

  const redDelta = Math.round(kRed * (actualRed - expectedRed));
  const blackDelta = Math.round(kBlack * (actualBlack - expectedBlack));

  const redEloAfter = Math.max(100, redElo + redDelta);
  const blackEloAfter = Math.max(100, blackElo + blackDelta);

  return {
    redEloBefore: redElo,
    blackEloBefore: blackElo,
    redEloAfter,
    blackEloAfter,
    redDelta: redEloAfter - redElo,
    blackDelta: blackEloAfter - blackElo,
  };
}
