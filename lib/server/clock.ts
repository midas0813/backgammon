import type { Seat } from "../engine/board";

/**
 * Match clocks (Phase 2 "Timers and disconnect protection").
 *
 * Every decision (a turn from roll to confirm, or answering a double) gives the player `perMoveMs`
 * free; time beyond that comes out of their bank. An empty bank loses the match by timeout.
 * A player whose app stops checking in on their turn is "disconnected": their bank stops and a
 * reconnect window runs instead (90 s per drop, 3 min per match). When both players are gone at once
 * (more likely our problem than theirs) nobody's clock runs.
 *
 * Chess uses the usual Fischer clock instead: no free seconds, a starting bank, and an increment
 * added after each move ("3+2" = 3 minutes + 2 seconds a move).
 *
 * Pure functions over a small state object stored on the match; the server applies them under the
 * match's row lock, and the browser uses the same numbers to draw the clocks.
 */
export type ClockPreset = "standard" | "fast" | "none";

export interface ClockState {
  /** "standard" / "fast" (backgammon) or a chess time control such as "3+2". */
  preset: string;
  perMoveMs: number;
  /** Chess: added to the mover's bank after each move. */
  incrementMs?: number;
  bankMs: [number, number];
  /** The seat whose decision is running, and when it started (ms; moved forward after a reconnect). */
  seat: Seat | null;
  turnStartedAt: number;
  /** Reconnect time already used per seat this match. */
  awayUsedMs: [number, number];
}

export const CLOCK_SETTINGS = {
  standard: { perMoveMs: 12_000, bankPerPointMs: 60_000, minBankMs: 120_000 },
  fast: { perMoveMs: 8_000, bankPerPointMs: 30_000, minBankMs: 60_000 },
} as const;
/** No check-in for this long on your turn counts as disconnected. Pages check in every few seconds. */
export const DISCONNECT_GRACE_MS = 15_000;
export const RECONNECT_WINDOW_MS = 90_000;
export const AWAY_TOTAL_MS = 180_000;

export function newClock(preset: ClockPreset, targetPoints: number): ClockState | undefined {
  if (preset === "none") return undefined;
  const s = CLOCK_SETTINGS[preset];
  const bank = Math.max(s.minBankMs, s.bankPerPointMs * targetPoints);
  return { preset, perMoveMs: s.perMoveMs, bankMs: [bank, bank], seat: null, turnStartedAt: 0, awayUsedMs: [0, 0] };
}

/** A chess clock: `baseMs` each, plus `incMs` after every move. */
export function newChessClock(id: string, baseMs: number, incMs: number): ClockState {
  return { preset: id, perMoveMs: 0, incrementMs: incMs, bankMs: [baseMs, baseMs], seat: null, turnStartedAt: 0, awayUsedMs: [0, 0] };
}

const offline = (seen: [number, number], seat: Seat, now: number) => now - seen[seat] > DISCONNECT_GRACE_MS;

/** When the running seat dropped off (null while connected). */
function awaySince(c: ClockState, seen: [number, number], now: number): number | null {
  if (c.seat === null || !offline(seen, c.seat, now)) return null;
  return Math.max(c.turnStartedAt, seen[c.seat] + DISCONNECT_GRACE_MS);
}

export interface ClockView {
  seat: Seat | null;
  /** Free time left on this decision, then bank left, per seat (ms) as of `now`. */
  freeLeftMs: number;
  bankLeftMs: [number, number];
  /** Set while the running seat is disconnected: when their reconnect window ends (ms). */
  reconnectBy: number | null;
  paused: boolean;
}

/** The clocks as of `now`. Charges nothing; see `settleClock` / `endDecision` for that. */
export function clockView(c: ClockState, seen: [number, number], now: number): ClockView {
  const bank: [number, number] = [c.bankMs[0], c.bankMs[1]];
  if (c.seat === null) return { seat: null, freeLeftMs: c.perMoveMs, bankLeftMs: bank, reconnectBy: null, paused: false };
  const other = (1 - c.seat) as Seat;
  const away = awaySince(c, seen, now);
  // Both gone: likely an outage on our side; no clock runs.
  const paused = away !== null && offline(seen, other, now);
  const runUntil = away ?? now;
  const used = Math.max(0, runUntil - c.turnStartedAt);
  bank[c.seat] = Math.max(0, c.bankMs[c.seat] - Math.max(0, used - c.perMoveMs));
  const reconnectBy = away === null || paused ? null : away + Math.min(RECONNECT_WINDOW_MS, AWAY_TOTAL_MS - c.awayUsedMs[c.seat]);
  return { seat: c.seat, freeLeftMs: Math.max(0, c.perMoveMs - used), bankLeftMs: bank, reconnectBy, paused };
}

/** The seat that has lost on time as of `now`, if any. */
export function timedOut(c: ClockState, seen: [number, number], now: number): Seat | null {
  if (c.seat === null) return null;
  const v = clockView(c, seen, now);
  if (v.paused) return null;
  if (v.bankLeftMs[c.seat] <= 0) return c.seat;
  if (v.reconnectBy !== null && now >= v.reconnectBy) return c.seat;
  return null;
}

/**
 * The running seat checked in again after a drop: the time away comes off their reconnect allowance
 * (not their bank) by moving the decision's start forward. Returns true if anything changed.
 */
export function noteReturn(c: ClockState, seat: Seat, seenBefore: [number, number], now: number, free = false): boolean {
  if (c.seat !== seat) return false;
  const away = awaySince(c, seenBefore, now);
  if (away === null) return false;
  const gone = now - away;
  if (gone <= 0) return false; // the decision has not started yet (e.g. a tournament round's grace period)
  // If the opponent was gone too, nobody was waiting: nothing is charged. `free`: a host arriving after
  // someone joined their table is not "reconnecting".
  if (!free && !offline(seenBefore, (1 - seat) as Seat, now)) c.awayUsedMs[seat] = Math.min(AWAY_TOTAL_MS, c.awayUsedMs[seat] + gone);
  c.turnStartedAt += gone;
  return true;
}

/** A decision ended (the seat to act changed): charge the bank and start the next decision. */
export function nextDecision(c: ClockState, nextSeat: Seat | null, now: number) {
  if (c.seat !== null) {
    const used = Math.max(0, now - c.turnStartedAt);
    c.bankMs[c.seat] = Math.max(0, c.bankMs[c.seat] - Math.max(0, used - c.perMoveMs));
    if (c.incrementMs && nextSeat !== null && nextSeat !== c.seat) c.bankMs[c.seat] += c.incrementMs;
  }
  c.seat = nextSeat;
  c.turnStartedAt = now;
}
