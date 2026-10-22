# Runbook

Day-to-day operation of the live site. Vercel project `backgammon`, Supabase project in `ap-northeast-1`.

## Deploying

Every push to `main` deploys to production on Vercel. GitHub runs the checks (`CI` workflow) on the
same push: types, lint, formatting, unused code, unit tests on both stores, a build, and browser tests
in Chromium, WebKit and a phone viewport. To make Vercel wait for a green CI before promoting a deploy,
turn on **Vercel → Project → Settings → Deployment Checks** and select the `checks` and `browser` jobs.

Database changes ship as new files in `supabase/migrations/` (named `YYYYMMDDHHMMSS_what.sql`). The app
applies pending files on its first request after a deploy, under a lock. Write them so that running
twice is harmless (`create … if not exists`, `on conflict do nothing`).

Rollback: Vercel → Deployments → previous deployment → **Promote to Production**. Migrations do not
roll back on their own; a later migration has to undo a schema change.

## Settings

Environment variables: see the table in the README. After changing one, redeploy (Deployments → … →
Redeploy). Operator switches that need no deploy (maintenance mode, spectators, announcements) are in
`/admin` → Settings.

### Wallet window

**Connect Wallet** opens the app's own window (laid out like Reown AppKit) and needs no settings. It
lists the browser wallets it finds; on a phone without a wallet browser, MetaMask, Trust, Coinbase
Wallet, OKX and Phantom open this site inside their app. There is no WalletConnect and no QR code.
`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is no longer used and can be removed from Vercel.

### Instant updates

1. Supabase → Project Settings → API (or **Connect**): copy the **Project URL** and the **publishable**
   key (older projects: the `anon` key). Both are public by design; RLS keeps all tables closed.
2. Add them in Vercel as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, redeploy.
3. Check: in a match, a move appears on the other device within a fraction of a second. Without these,
   matches poll every second (fine, just more requests).
4. Supabase's free plan allows 200 simultaneous Realtime connections; Pro allows 500 and more on request.

## Scheduled jobs

| Job | Where | When | What |
| --- | --- | --- | --- |
| Clean-up | Vercel Cron → `/api/cron/cleanup` (needs `CRON_SECRET`) | daily 03:30 UTC | Settles left games, closes stale tables, removes idle guests, prunes old rate-limit windows and errors. Busy pages do the same every few minutes; this catches quiet periods |
| Backup | GitHub Actions → `Backup` workflow | daily 02:15 UTC | Encrypted database dump kept 30 days |

## Backups

**Set up once** (GitHub → repository → Settings → Secrets and variables → Actions → New secret):

- `BACKUP_DATABASE_URL`: Supabase → Connect → **Session pooler** connection string (port 5432).
- `BACKUP_PASSPHRASE`: a long random passphrase. Keep a copy in your password manager — without it
  the backups cannot be opened.
- Optional `DISCORD_WEBHOOK_URL` for failure alerts. GitHub also emails you when a scheduled run fails.

Run it once by hand: Actions → Backup → Run workflow. Each run's summary shows the file and its size.

**Restore** (into a *new* Supabase project first, never straight over production):

```bash
# 1. Download the artifact from the Backup run and decrypt it
gpg --decrypt backgammon-YYYYMMDD-HHMM.dump.gpg > backup.dump
# 2. Load it into the target database (Session pooler URL of the new project)
pg_restore --no-owner --no-privileges --dbname "$TARGET_DATABASE_URL" backup.dump
```

Then point a test deployment at it and check the lobby, a profile and the admin finance page
(reconciliation should show no mismatches). Do this drill once a quarter.

Before real money: upgrade Supabase to Pro (daily backups included) and add Point-in-Time Recovery.

## When something goes wrong

- **Players see an error screen**: it shows a reference number. Admin dashboard → *Latest errors*
  lists the same references with the message and the player. Vercel → Logs has the full server log.
- **Discord says errors spiked**: open the admin dashboard, look at the newest errors, then Vercel
  logs around that time. If a deploy caused it, promote the previous deployment.
- **Database unreachable**: the app answers "The game server is not connected to its database". Check
  Supabase status and that `DATABASE_URL` is set for Production.
- **Need to stop new games** (incident or maintenance): `/admin` → Settings → Maintenance mode. Games in
  progress continue.

## Moving to another region

Players are mainly in Canada and Africa; the database is in Tokyo. To move to US East:

1. Create a Supabase project in `us-east-1` (Virginia).
2. Turn on maintenance mode, take a backup (above), restore it into the new project.
3. In Vercel set `DATABASE_URL` (and the Realtime variables) to the new project; change `regions` in
   `vercel.json` to `["iad1"]`; push. Turn maintenance mode off.
4. Expect about 15 minutes of maintenance. Keep the old project for a week, then delete it.

## Checking on real devices

Before a release that changes the board or effects: on an iPhone (Safari) and an Android phone
(Chrome) switch through all six board themes; play until you see doubles, a hit, "your turn" and a
closed-out pass; try reduced motion on and off; connect and sign in with a wallet; open the room
browser and the chat in portrait and landscape.
