-- Errors seen by players (server failures and crashes in the browser), each with the reference number
-- shown to the player, so support can find the exact failure and admins see problems as they happen.
create table if not exists app_errors (
  id bigserial primary key,
  ref text not null,
  source text not null check (source in ('server', 'client')),
  message text not null,
  detail text,
  path text,
  user_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists app_errors_created on app_errors (created_at desc);
create index if not exists app_errors_ref on app_errors (ref);
alter table app_errors enable row level security;
