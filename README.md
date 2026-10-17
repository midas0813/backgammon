# Backgammon (Next.js)

Mobile-first multiplayer backgammon: free online matches with the full rules and doubling cube, a
computer opponent, pass & play, spectators with chat and reactions, wallet accounts, an admin area,
and a double-entry token ledger with simulated payments (real money is not enabled).

Live: https://backgammon-iota-gules.vercel.app

## Run

```bash
npm install
npm run dev              # http://localhost:3000 (data in .data/db.json)
npm test                 # 126 unit/integration tests on the in-memory store
npm run test:pg          # the same tests on Postgres (PGlite + the Supabase migrations)
npm run test:postgres    # the same tests through the production driver on a real Postgres (CI)
npm run build && npm run e2e   # 22 browser tests (Playwright); PW_CHANNEL=chrome uses installed Chrome
npm run typecheck        # route types + TypeScript
npm run lint             # ESLint (Next.js, React hooks, TypeScript rules)
npm run format           # Prettier
npm run knip             # unused files, exports and dependencies
```

Every push runs all of these on GitHub (`.github/workflows/ci.yml`), with browser tests in Chromium,
WebKit (Safari's engine) and a phone-sized screen.

## Configuration

Copy `.env.example` to `.env.local` for development. In production these are Vercel environment
variables (Project → Settings → Environment Variables; redeploy after changing any `NEXT_PUBLIC_` one).

| Variable | Needed | What it does |
| --- | --- | --- |
| `DATABASE_URL` | yes | Supabase Postgres, *Transaction pooler* (port 6543). Tables are created and upgraded automatically ([docs/DATABASE.md](docs/DATABASE.md)) |
| `ADMIN_BOOTSTRAP_WALLETS` | yes | Wallet address(es) that become Owner on first admin unlock ([docs/ADMIN.md](docs/ADMIN.md)) |
| `CRON_SECRET` | yes | Protects the daily clean-up job (`/api/cron/cleanup`, scheduled in `vercel.json`) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | recommended | QR codes and mobile wallet apps ([docs/WALLET_ACCOUNTS.md](docs/WALLET_ACCOUNTS.md)) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | recommended | Instant match updates and chat via Supabase Realtime; without them pages poll ([docs/RUNBOOK.md](docs/RUNBOOK.md#instant-updates)) |
| `DISCORD_WEBHOOK_URL` | recommended | Alerts for error spikes and payment errors |
| `ENABLE_SIMULATED_PAYMENTS`, `SIMULATED_PAYMENTS_SECRET` | demo only | Simulated payment provider (off in production unless enabled) |
| `DATABASE_POOL_SIZE` | optional | Connections per server instance (default 5) |

## Pages

`/` landing · `/home` dashboard · `/play` lobby and room browser · `/match/:id` play, watch and chat ·
`/profile` · `/wallet` · `/signup`, `/login`, `/welcome` · `/admin`.

## What works

| Area | Status |
| --- | --- |
| Rules engine (`lib/engine`) | Full legal-move enumeration (max dice, higher-die rule, doubles), hitting, bar, bear-off, single/gammon/backgammon, opening roll, 15-checker invariant every turn |
| Cube | Offer before rolling, ownership, accept/pass, cap 128, Crawford game, dead-cube block |
| Authoritative server | Server-only dice; every action carries `actionId` + `expectedVersion`; retries are idempotent; append-only event log per match |
| Lobby | Room browser: open tables and live matches, filters (length, fee), sorting and paging, cached at the edge. Public and invite-only tables; host-away tables stay listed |
| Clocks | Free seconds per move plus a time bank; timeouts; disconnect protection with a reconnect window; Standard, Fast or No clock |
| Fair dice | Sealed server seed + players' device seeds; verify any finished match in the browser (`/fair`) |
| Progress | Daily and weekly quests, XP, levels, avatar frames; ratings (FIBS) on ranked tables; weekly/season leaderboard with a free weekly prize pool (admin-approved) |
| Social | Friends with online status, direct invites, rematch, replays (`/replay/:id`), sit & go tournaments (`/tournaments`) |
| Fair-play review | Anti-cheat flags reviewed by admins; spectator delay on ranked and tournament matches |
| Beta | Invite codes per community (optional invite-only), Feedback button, tester guide (`/beta`), Terms / Privacy / Cookies (`/legal`) |
| Fair play rules | **One game per player** (any tab or device). Left games end on their own: the player to act loses after 10 min away while the opponent waits; matches both left close after 30 min with no result; a host who doesn't return within 2 min of someone joining → called off; invites expire after 15 min; public tables close 15 min after the host leaves or after 1 h; computer and pass & play games close after a day alone |
| Spectating & chat | Watch live matches; players and spectators chat with preset phrases or their own words; emoji reactions float over the board. The host decides whether spectators may watch, chat and react, and can remove a spectator; anyone can report a message; admins can remove messages |
| Instant updates | Supabase Realtime notices make moves and chat appear at once; polling remains as a backup |
| Phones | Edge-to-edge board, one-tap moves, large destination buttons, forgiving taps, landscape layout |
| Home & profile | Today's progress, games to continue, stats from a results table (correct for any number of matches), paged match history, avatar, settings, problem reports |
| Accounts | **Wallet = account**: in-app wallet dialog (wagmi 3), Sign-In with Ethereum verified on the server, incl. smart wallets. Guests can play free games; idle guests are removed after 30 minutes; practice credits come with the account |
| Admin | Wallet-signed unlock, roles, signed risky actions, append-only audit, players, matches (event log, chat), reports, finance with two-person adjustments, settings, announcements, recent errors |
| Reliability | Request limits on every write, error screens with reference numbers, offline banner, stored errors with Discord alerts, nightly encrypted backups, daily clean-up job |
| Wallet / ledger | Double-entry ledger in integer minor units, separate free and paid accounts, reserves, reconciliation, simulated HMAC-signed payment provider |

## Not yet

Token-stake matches and paid tournaments (ledger functions exist and are tested; blocked on the open
decisions in spec 05), real payment providers and identity checks, an on-chain record of the dice. See
`../specifications`.

## More

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the pieces fit together
- [docs/RUNBOOK.md](docs/RUNBOOK.md): deploying, settings, backups and restore, incidents
- [docs/DATABASE.md](docs/DATABASE.md) · [docs/ADMIN.md](docs/ADMIN.md) · [docs/WALLET_ACCOUNTS.md](docs/WALLET_ACCOUNTS.md) · [docs/IMAGE_BRIEF.md](docs/IMAGE_BRIEF.md)
- [CHANGELOG.md](CHANGELOG.md)
