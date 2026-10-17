"use client";

import { dieFromDigest, fairMessage } from "@/lib/fair";
import type { FairRecord } from "@/lib/server/fairCheck";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export interface FairCheck {
  fingerprintOk: boolean;
  rolls: { n: number; played: number; expected: number; ok: boolean }[];
  allOk: boolean;
}

/** Recompute every die in this browser (WebCrypto), independent of the server. */
export async function verifyFair(r: FairRecord): Promise<FairCheck | null> {
  const seed = r.fair.serverSeed;
  if (!seed) return null;
  const enc = new TextEncoder();
  const fingerprintOk = hex(await crypto.subtle.digest("SHA-256", enc.encode(seed))) === r.fair.commit;
  const key = await crypto.subtle.importKey("raw", enc.encode(seed), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const rolls = [];
  for (let n = 0; n < r.dice.length; n++) {
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(fairMessage(r.fair.clientSeeds, n))));
    const expected = dieFromDigest(digest);
    rolls.push({ n, played: r.dice[n], expected, ok: expected === r.dice[n] });
  }
  return { fingerprintOk, rolls, allOk: fingerprintOk && rolls.every((x) => x.ok) };
}
