import { createHash, createHmac, randomBytes } from "node:crypto";
import { FAIR_VERSION, cleanSeed, dieFromDigest, fairMessage } from "../fair";

/** Stored on the match; `serverSeed` stays secret until the match is over. */
export interface FairState {
  version: string;
  commit: string;
  serverSeed: string;
  clientSeeds: [string, string];
  /** Dice rolled so far. */
  n: number;
}

export function newFair(hostSeed: unknown): FairState {
  const serverSeed = randomBytes(32).toString("hex");
  return { version: FAIR_VERSION, commit: createHash("sha256").update(serverSeed).digest("hex"), serverSeed, clientSeeds: [cleanSeed(hostSeed), ""], n: 0 };
}

export function nextDie(f: FairState): number {
  const digest = createHmac("sha256", f.serverSeed).update(fairMessage(f.clientSeeds, f.n)).digest();
  f.n += 1;
  return dieFromDigest(digest);
}

/** What players may see: the fingerprint and seeds always, the secret only once the match is over. */
export const fairView = (f: FairState | undefined, over: boolean) =>
  f ? { version: f.version, commit: f.commit, clientSeeds: f.clientSeeds, rolls: f.n, serverSeed: over ? f.serverSeed : null } : null;
