-- Anti-cheat: flags for an admin to review. Nothing is decided automatically.
--  * app_users.created_ip / last_ip: salted hashes of the network address (never the address itself).
create table if not exists cheat_flags (
  id bigserial primary key,
  kind text not null,
  dedupe_key text not null unique,      -- one flag per pattern, players and day
  user_ids uuid[] not null,
  match_ids text[] not null,
  details jsonb not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'DISMISSED', 'ACTIONED')),
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  note text
);
create index if not exists cheat_flags_status on cheat_flags (status, created_at desc);
alter table cheat_flags enable row level security;

alter table app_users add column if not exists created_ip text;
alter table app_users add column if not exists last_ip text;
create index if not exists app_users_created_ip on app_users (created_ip, created_at);
