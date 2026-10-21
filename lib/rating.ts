/**
 * Ratings (FIBS formula, the usual one for backgammon). Everyone starts at 1500. For a match of
 * length N between ratings Ra and Rb, the chance that A wins is
 *   P(A) = 1 / (10^((Rb − Ra) · √N / 2000) + 1)
 * The winner gains 4·√N·K·P(loser wins) and the loser loses the same, where K starts high for new
 * players (fast movement while provisional) and settles at 1 after 400 points of experience.
 */
export const START_RATING = 1500;
export const PROVISIONAL_GAMES = 20;

export function winChance(ra: number, rb: number, n: number) {
  return 1 / (10 ** (((rb - ra) * Math.sqrt(n)) / 2000) + 1);
}

/** Experience factor: 5 for a brand-new player, falling to 1 after 400 match points played. */
export const kFactor = (experience: number) => Math.max(1, 5 - experience / 100);

/** Rating changes for a finished ranked match: [winner's gain, loser's loss] (both positive). */
export function ratingChange(winner: { rating: number; experience: number }, loser: { rating: number; experience: number }, n: number) {
  const pLoserWins = winChance(loser.rating, winner.rating, n);
  const base = 4 * Math.sqrt(n) * pLoserWins;
  return [base * kFactor(winner.experience), base * kFactor(loser.experience)] as const;
}

/**
 * Chess (Elo): expected score 1 / (1 + 10^((Rb − Ra) / 400)); a draw scores ½. K is 40 for a player's
 * first 30 rated games, then 20, as FIDE uses for newer and established players.
 */
export const eloK = (games: number) => (games < 30 ? 40 : 20);

export function eloChange(ra: number, rb: number, scoreA: 0 | 0.5 | 1, gamesA: number) {
  const expected = 1 / (1 + 10 ** ((rb - ra) / 400));
  return eloK(gamesA) * (scoreA - expected);
}
