-- Backgammon MVP — initial schema.
-- Applied automatically by the Supabase GitHub integration ("Deploy to production", working directory ".")
-- or manually: paste into the Supabase SQL editor.
--
-- Access model: the Next.js server connects with DATABASE_URL (postgres role, bypasses RLS).
-- RLS is enabled with NO policies on every table, so the public anon/authenticated API keys can read nothing.

-- Accounts are wallet-based: one EVM address = one account. Guests (free play only) have no wallet yet.
create table if not exists app_users (
  id uuid primary key,
  wallet_address text unique,           -- EIP-55 checksummed address, null for guests
  chain_id integer,                     -- chain used when signing in
  name text not null,
  theme_id text not null default 'walnut',
  reduced_motion boolean not null default false,
  bio text not null default '',
  country text not null default '',
  avatar text,                          -- file name in app_avatars
  created_at timestamptz not null default now(),
  registered_at timestamptz             -- first successful Sign-In with Ethereum
);
create unique index if not exists app_users_wallet_lower on app_users (lower(wallet_address));

create table if not exists app_sessions (
  token uuid primary key,               -- opaque httpOnly cookie value
  user_id uuid not null references app_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  siwe_nonce text,                      -- single-use Sign-In with Ethereum nonce
  siwe_nonce_expires_at timestamptz
);
create index if not exists app_sessions_user on app_sessions (user_id);

create table if not exists app_avatars (
  file text primary key,
  user_id uuid not null references app_users (id) on delete cascade,
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  bytes bytea not null check (octet_length(bytes) <= 2097152),
  created_at timestamptz not null default now()
);

-- Matches: authoritative state is a versioned JSON document; hot fields are columns for querying.
create table if not exists matches (
  id text primary key,
  mode text not null check (mode in ('quick', 'private', 'local', 'bot')),
  status text not null check (status in ('WAITING', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  target_points integer not null,
  created_by uuid not null,
  seat0 text,
  seat1 text,
  version integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists matches_status_mode on matches (status, mode, target_points, created_at);
create index if not exists matches_seat0 on matches (seat0);
create index if not exists matches_seat1 on matches (seat1);

create table if not exists idempotency_keys (
  key text primary key,
  fingerprint text not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

-- Double-entry ledger in integer minor units (100 = 1 token = $1).
create table if not exists ledger_accounts (
  account text primary key,
  balance bigint not null default 0,
  constraint ledger_no_overdraft check (
    balance >= 0 or account in ('system:EXTERNAL_CLEARING', 'system:FREE_ISSUANCE')
  )
);

create table if not exists ledger_transactions (
  id bigserial primary key,
  key text not null unique,             -- idempotency key: a key can be posted only once
  type text not null,
  memo text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists ledger_entries (
  id bigserial primary key,
  txn_id bigint not null references ledger_transactions (id),
  account text not null references ledger_accounts (account),
  amount bigint not null check (amount <> 0)
);
create index if not exists ledger_entries_txn on ledger_entries (txn_id);
create index if not exists ledger_entries_account on ledger_entries (account);

-- Journal rows are immutable.
create or replace function ledger_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'ledger rows are immutable; post a reversing transaction instead';
end $$;
drop trigger if exists ledger_transactions_immutable on ledger_transactions;
create trigger ledger_transactions_immutable before update or delete on ledger_transactions
  for each row execute function ledger_immutable();
drop trigger if exists ledger_entries_immutable on ledger_entries;
create trigger ledger_entries_immutable before update or delete on ledger_entries
  for each row execute function ledger_immutable();

create table if not exists deposit_intents (
  id text primary key,
  user_id uuid not null,
  external_ref text not null unique,
  status text not null,
  created_at timestamptz not null,
  data jsonb not null
);
create index if not exists deposit_intents_user on deposit_intents (user_id, created_at desc);

create table if not exists withdrawals (
  id text primary key,
  user_id uuid not null,
  external_ref text not null unique,
  status text not null,
  created_at timestamptz not null,
  data jsonb not null
);
create index if not exists withdrawals_user on withdrawals (user_id, created_at desc);

create table if not exists payment_events (
  event_id text primary key,           -- provider event ID: each event is processed once
  outcome text not null,
  processed_at timestamptz not null default now()
);

alter table app_users enable row level security;
alter table app_sessions enable row level security;
alter table app_avatars enable row level security;
alter table matches enable row level security;
alter table idempotency_keys enable row level security;
alter table ledger_accounts enable row level security;
alter table ledger_transactions enable row level security;
alter table ledger_entries enable row level security;
alter table deposit_intents enable row level security;
alter table withdrawals enable row level security;
alter table payment_events enable row level security;
