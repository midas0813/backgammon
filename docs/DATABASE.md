# Database (Supabase Postgres)

The schema lives in `supabase/migrations/`. The app talks to Postgres directly from the server
(`postgres.js`), inside transactions with row locks. The Supabase JS client and the public API keys are
**not** used. Every table has Row Level Security enabled with no policies, so the anon/authenticated keys
can't read or write anything.

## Connect your Supabase project

1. **Apply the schema** (pick one):
   - GitHub integration: Supabase → Project Settings → Integrations → GitHub → this repo, working directory
     `.`, turn on **Deploy to production**. Pushing to `main` then applies new migrations automatically.
   - Or paste `supabase/migrations/20261014120000_init.sql` into the Supabase SQL editor and run it.
2. **Get the connection string**: Supabase → Connect → *Transaction pooler* (port 6543), with your
   database password filled in.
3. **Set it where the app runs** (never commit it):
   - Local: `.env.local` → `DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`
   - Hosting (e.g. Vercel): add `DATABASE_URL` as an environment variable.
4. Restart the app. With `DATABASE_URL` set it uses Postgres; without it, the local `.data/db.json` file.

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

## Testing against Postgres without Supabase

`npm run test:pg` runs the whole test suite on an in-process Postgres (PGlite), loaded with the same
migration file.
