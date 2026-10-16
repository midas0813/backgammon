# Architecture

One Next.js app (App Router) on Vercel, one Supabase Postgres database. The browser never decides
anything that matters: it proposes actions, the server applies the rules and stores the result.

```
browser ──HTTP──▶ app/api/* (route handlers) ──▶ lib/server/* (services) ──▶ lib/server/store (Tx) ──▶ Postgres
   ▲                                                    │
   └──── Supabase Realtime "something changed" ◀────────┘ (after commit)
```

## Layers

| Folder | Role |
| --- | --- |
| `lib/engine/` | Pure rules: board, legal moves, match state machine. Shared by server and browser (move previews) |
| `lib/server/store/` | The `Tx` interface and two implementations: Postgres (`postgres.ts`) and an in-memory/JSON store (`memory.ts`) for development and tests. Every unit of work is one transaction |
| `lib/server/` | Services: `matches` (actions, timing rules, one game per player), `lobby`, `home`, `chat`, `users`, `siwe` (sign-in), `ledger`, `wallet`, `payments/`, `admin/`, `ratelimit`, `realtime`, `monitor` |
| `app/api/` | Thin route handlers: parse input, call a service through `handle()` (session, rate limit, error envelope) |
| `components/`, `app/*/page.tsx` | UI. `MatchView` (board, controls, chat), `Board` (SVG), `FxLayer` (effects), `RoomBrowser`, `WalletDialog`, admin screens |
| `lib/client/` | Browser helpers: API client, effects rules (`fx.ts`), sound, realtime channel, wallet config |
| `supabase/migrations/` | Schema, applied automatically in order on first request |
| `tests/` (Vitest), `e2e/` (Playwright) | Service tests on both stores; browser journeys |

## A move, end to end

1. The player confirms a turn. The browser sends `POST /api/matches/:id/actions` with a fresh
   `actionId` and the `expectedVersion` it last saw.
2. `submitAction` locks the match row, returns the stored answer if this `actionId` was seen before
   (safe retry), rejects a stale version, applies the action through the engine, and appends the
   resulting events to `match_events`. The match row holds only the current position.
3. After commit, `realtime.publish` sends a notice on channel `match:<id>`. Open pages (players and
   spectators) fetch the new snapshot at once; without Realtime they poll every second.
4. Effects (doubles, hits, "your turn") are derived in the browser from the same committed events,
   so players and spectators see the same show.

## Rules that run on a timer

`sweep()` in `lib/server/matches.ts` runs from busy endpoints (at most every 30 s per instance) and
from the daily cron. It closes stale tables, settles left games (abandonment, host missing, both gone,
idle offline games), removes idle guests and prunes old rate-limit windows and errors. The same
`settlementFor` rule is applied when someone opens a match, so a waiting player sees the result
immediately.

## Data written per match

`matches` (current state + summary columns for lists) · `match_events` (append-only log) ·
`match_actions` (idempotency) · `match_results` (one row per human player when it ends: stats read
only these) · `match_presence` / `match_spectators` (heartbeats) · `match_chat`.

## Security model

- Sessions: opaque httpOnly cookie → `app_sessions`. Wallet sign-in (SIWE) rotates it.
- The database is reached only from the server. Every table has RLS on and no policies, so the public
  Supabase key (used for Realtime) can read nothing. Realtime notices carry no data.
- Request limits per player or address on every write (`lib/server/ratelimit.ts`).
- Admin: separate wallet-signed session, roles, signed risky actions, append-only audit log.
- Ledger: integer minor units, double entry, immutable journal (database trigger).
