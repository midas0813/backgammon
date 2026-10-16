import { ApiError } from "./errors";
import { tx } from "./store";

/**
 * Request limits per player (or per network address before sign-in), as fixed windows counted in the
 * database so they hold across server instances. Each rule may have several windows (a burst limit
 * and a sustained one). Counted in their own unit of work, so refused or failing requests count too.
 */
export const RULES = {
  /** Wallet sign-in requests, per address. */
  signin: [{ max: 10, windowMs: 60_000 }],
  /** Creating, joining, leaving or closing games. */
  game: [{ max: 10, windowMs: 60_000 }],
  /** Moves, rolls and cube decisions. */
  action: [{ max: 120, windowMs: 60_000 }],
  /** Profile and settings changes. */
  profile: [{ max: 30, windowMs: 60_000 }],
  avatar: [{ max: 5, windowMs: 60 * 60_000 }],
  /** Admin signature requests and sign-ins. */
  admin: [{ max: 20, windowMs: 10 * 60_000 }],
  payments: [{ max: 10, windowMs: 60_000 }],
  report: [{ max: 10, windowMs: 60_000 }],
  /** Chat and reactions: one per second, 30 a minute. */
  chat: [
    { max: 1, windowMs: 1_000 },
    { max: 30, windowMs: 60_000 },
  ],
} as const;

export type LimitRule = keyof typeof RULES;

/** Count one request for `who` under `rule`; throws RATE_LIMITED (429, with retryAfter seconds) when over. */
/** Browser tests run many players from one address; their server raises the limits (never set in production). */
const scale = () => Math.max(1, Number(process.env.RATE_LIMIT_MULTIPLIER) || 1);

export async function rateLimit(rule: LimitRule, who: string, now = Date.now()) {
  const over = await tx(async (t) => {
    for (const w of RULES[rule]) {
      const start = now - (now % w.windowMs);
      const n = await t.rateLimits.hit(`${rule}:${w.windowMs}:${who}`, start);
      if (n > w.max * scale()) return Math.max(1, Math.ceil((start + w.windowMs - now) / 1000));
    }
    return 0;
  });
  if (over) {
    throw new ApiError(429, "RATE_LIMITED", `Slow down a moment — try again in ${over} s.`, { retryAfter: over });
  }
}
