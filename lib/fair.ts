/**
 * Provably fair dice (shared by the server and the browser's "Verify this game").
 *
 * Before a match the server picks a secret `serverSeed` and publishes only its SHA-256 fingerprint
 * (`commit`). Each player's device adds a random `clientSeed`. Die number n (counting every die the
 * match rolls, opening rolls included) is derived from HMAC-SHA256(serverSeed, "seed0:seed1:n"): the
 * first byte below 252 gives (byte mod 6) + 1, so all six faces are equally likely. After the match
 * the seed is revealed; anyone can check the fingerprint and recompute every die.
 */
export const FAIR_VERSION = "hmac-sha256-v1";

export const fairMessage = (clientSeeds: [string, string], n: number) => `${clientSeeds[0]}:${clientSeeds[1]}:${n}`;

export function dieFromDigest(digest: Uint8Array): number {
  for (const b of digest) if (b < 252) return (b % 6) + 1;
  return (digest[0] % 6) + 1; // all 32 bytes ≥ 252: practically impossible, still deterministic
}

/** Device seeds: hex only, at most 64 characters. */
export const cleanSeed = (v: unknown) =>
  typeof v === "string"
    ? v
        .toLowerCase()
        .replace(/[^0-9a-f]/g, "")
        .slice(0, 64)
    : "";

/** Every die a match rolled, in order, from its event log (opening rolls: white then black). */
export function rollsFromEvents(events: { type: string; payload: Record<string, unknown> }[]): number[] {
  const out: number[] = [];
  for (const e of events) {
    if (e.type === "OPENING_ROLL_COMMITTED") for (const [w, b] of e.payload.openingRolls as [number, number][]) out.push(w, b);
    if (e.type === "DICE_ROLLED") out.push(...(e.payload.dice as number[]));
  }
  return out;
}
