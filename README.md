# Backgammon MVP (Next.js)

MVP of the mobile-first backgammon site described in `../specifications`. It covers **Phase 1, the foundation**: a real two-session free match with full rules, the doubling cube, results and reconnect. It also includes the **wallet ledger and simulated payments** requested in `06-payments-development.md`.

## Run

```bash
npm install
npm run dev            # http://localhost:3000
npm test               # 39 tests on the in-memory store
npm run test:pg        # the same tests on Postgres (PGlite + the Supabase migration)
npm run typecheck
```

Production build: `npm run build && npm start`. The simulated payment provider is **off in production**. To demo the wallet on a production build, opt in with `ENABLE_SIMULATED_PAYMENTS=true npm start`.

**Configuration:** copy `.env.example` to `.env.local`. `DATABASE_URL` switches storage to Supabase Postgres ([docs/DATABASE.md](docs/DATABASE.md)). `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` enables QR-code and mobile wallets ([docs/WALLET_ACCOUNTS.md](docs/WALLET_ACCOUNTS.md)).

**Pages:** `/` landing · `/play` lobby · `/signup` · `/login` · `/profile` · `/wallet` · `/match/:id`.

**Images:** the landing and auth pages have 11 AI-image slots. Until files are added to `public/images/`, built-in vector art is shown. See [docs/IMAGE_BRIEF.md](docs/IMAGE_BRIEF.md) for file names, sizes and prompts. Production builds pick up new images on the next build.

**Playing alone:** click **Play vs computer** (a simple heuristic bot, unrated, free).

**Two players:** each player must be a *different browser identity*. Tabs in the same browser share a cookie and count as the same player. Use **Invite a friend** and open the link in a private window or on another device, or press **Find online opponent** in two different browsers with the same match length. **Pass & play** runs both seats on one device.

## What works

| Area | Status |
| --- | --- |
| Rules engine (`lib/engine`) | 24 signed points + bar + off; opening roll with tie reroll; full legal-sequence enumeration (max dice, higher-die rule, doubles ×4); hitting, bar entry, bear-off with overshoot; single/gammon/backgammon; 15-checker invariant checked after every turn |
| Cube | Offer before roll, ownership, accept/pass (pass awards the old value), cap 128, Crawford game, dead-cube block |
| Authoritative server | Server-only dice (`crypto.randomInt`); clients only propose actions; every action carries `actionId` + `expectedVersion`; retries are idempotent, stale versions are rejected, and the event log has cursors |
| Multiplayer | Play vs computer, quick-match queue, invite link, pass & play, 1 s polling, presence, refresh/restart restores the exact game |
| Accounts | **Wallet = account.** RainbowKit + wagmi connect, Sign-In with Ethereum (EIP-4361) verified server-side (EOA and EIP-1271/6492 smart wallets), single-use session-bound nonces, rotated httpOnly session cookies. A guest is upgraded in place on first sign-in, keeping its games and credits; `/welcome` onboarding for name and photo |
| Profile | Avatar upload (cropped/re-encoded in the browser, type checked by magic bytes, ≤ 2 MB, stored in the database, served from `/api/avatars`), name, bio, country, stats, match history, account wallet with explorer link, settings |
| Storage | Store interface with two implementations: Supabase Postgres (`DATABASE_URL`, row locks, advisory locks, RLS on every table) and a local JSON file for development |
| Look & motion | Landing page, glass UI, display font, shaded board; dice tumble, checker slides (including opponent replay and hits), cube flip, confetti, scroll reveals. Honors OS reduced-motion and the profile toggle |
| UI | Lobby, waiting room, live board (tap source → highlighted destinations with die labels, undo, confirm), cube decision panel, result & match-over screens, forced-pass announcements, 6 board themes switchable mid-game, profile. Checked for no horizontal overflow at 320/360/390/430 px |
| Wallet | Double-entry ledger in integer minor units (100 = 1 token = $1). Free credits and paid tokens are separate accounts; match and withdrawal reserves are separate; idempotency keys and reconciliation. Deposit states CREATED→PENDING→CREDITED/FAILED/REVIEW and the withdrawal lifecycle via a **simulated, HMAC-signed provider adapter**. Duplicate, out-of-order, underpaid and forged callbacks are all handled |
| Fees | Proposed full-tier policy (≤$10 10%, <$500 5%, ≥$500 2.5%) with half-up rounding, marked **not approved** |

## Not in this MVP (by design)

* Ranked play, ratings and tournaments (Phase 2). They are shown in the lobby as disabled.
* Token-stake matches (Phase 3). The ledger functions `reserveForMatch`, `settleTokensPerPoint` and `settleFixedStake` exist and are tested, but are not exposed in the UI. They are blocked on the open decisions in `05-decisions.md`.
* Clocks/timeouts, drag-to-move, sign-in (guest cookie only), real payment providers (Nuvei/Paysafe), admin tools.

## Architecture

```
lib/engine/      pure rules + match state machine (shared by server and client preview)
lib/server/      store/ (Postgres + local), siwe, matches, users, ledger, wallet, payments/
supabase/        migrations (schema, RLS)
app/api/         REST contracts from 03-api-contracts.md
components/      Board (SVG), MatchView, ThemePicker, BottomNav
tests/           vitest suites mirroring 04-test-plan.md
```

Persistence goes through `lib/server/store`: Postgres when `DATABASE_URL` is set, otherwise a JSON file at `.data/db.json` (one process only). Realtime uses polling; WebSockets/SSE would replace it later.
