# Database (Supabase Postgres)

The schema lives in `supabase/migrations/`. The app talks to Postgres directly from the server
(`postgres.js`), inside transactions with row locks. The Supabase JS client and the public API keys are
**not** used. Every table has Row Level Security enabled with no policies, so the anon/authenticated keys
can't read or write anything.

## Connect your Supabase project

**On Vercel with the Supabase integration, nothing else is needed.** The integration provides
`POSTGRES_URL`; the app reads it (extra provider parameters are stripped) and, on its first request,
**creates and upgrades the tables itself** from `supabase/migrations/`. Each file is applied once
(tracked in `app_schema_migrations`) under a lock, so simultaneous cold starts are safe.

Other setups:
- Set `DATABASE_URL` (Supabase → Connect → *Transaction pooler*, port 6543). It takes priority over `POSTGRES_URL`.
- Without any database variable the app uses `.data/db.json` locally; on Vercel it refuses to start
  data requests and logs "No database configured".
- The SQL files are idempotent, so applying them with the Supabase CLI/GitHub integration or the SQL
  editor as well is harmless.
- Keep the server functions next to the database. Every request makes several database round trips,
  so a cross-ocean hop turns each one into seconds. `vercel.json` pins functions to `hnd1` (Tokyo)
  because the Supabase project is in `ap-northeast-1`; change both together if the database moves.

## Tables

| Table | Purpose |
| --- | --- |
| `app_users` | Accounts (wallet address unique) and guests |
| `app_sessions` | Opaque session tokens and the pending SIWE nonce |
| `app_avatars` | Profile photos (≤ 2 MB, already re-encoded by the browser) |
| `matches` | Versioned match documents (JSON) with indexed status/seats |
| `idempotency_keys` | Safe retries for wallet requests |
| `ledger_accounts`, `ledger_transactions`, `ledger_entries` | Double-entry token ledger; no-overdraft check; journal rows are immutable (trigger) |
| `deposit_intents`, `withdrawals`, `payment_events` | Simulated payment lifecycle; each provider event is processed once |
| `match_presence` | "Online" heartbeat per seat, shared by all server instances |
| `disputes` | Player problem reports with reference IDs |
| `app_schema_migrations` | Which migration files the app has applied |

## Testing against Postgres without Supabase

`npm run test:pg` runs the whole test suite on an in-process Postgres (PGlite), loaded with the same
migration file.
