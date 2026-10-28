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
export declare function getKFactor(elo: number): number;
/**
 * Calculates expected score E_A = 1 / (1 + 10^((R_B - R_A) / 400))
 */
export declare function calculateExpectedScore(playerElo: number, opponentElo: number): number;
/**
 * Computes new ELO ratings and deltas after a ranked PvP match.
 * @param redElo Current ELO of Red player
 * @param blackElo Current ELO of Black player
 * @param winner 'w' (Red win), 'b' (Black win), or 'draw'
 */
export declare function calculateMatchElo(redElo: number, blackElo: number, winner: Side | 'draw'): EloUpdateResult;
//# sourceMappingURL=elo.d.ts.map