"use strict";
// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - INTERNATIONAL STANDARD ELO CALCULATOR
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKFactor = getKFactor;
exports.calculateExpectedScore = calculateExpectedScore;
exports.calculateMatchElo = calculateMatchElo;
/**
 * Determines K-Factor based on player's current ELO rating:
 * - K = 16 for Master-level players (ELO >= 2000)
 * - K = 32 for players below 2000 ELO
 */
function getKFactor(elo) {
    return elo >= 2000 ? 16 : 32;
}
/**
 * Calculates expected score E_A = 1 / (1 + 10^((R_B - R_A) / 400))
 */
function calculateExpectedScore(playerElo, opponentElo) {
    return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
}
/**
 * Computes new ELO ratings and deltas after a ranked PvP match.
 * @param redElo Current ELO of Red player
 * @param blackElo Current ELO of Black player
 * @param winner 'w' (Red win), 'b' (Black win), or 'draw'
 */
function calculateMatchElo(redElo, blackElo, winner) {
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
//# sourceMappingURL=elo.js.map