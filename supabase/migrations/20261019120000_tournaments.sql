-- Free single-elimination tournaments ("sit & go": starts when full). The bracket is a JSON document
-- like matches, changed under a row lock.
create table if not exists tournaments (
  id text primary key,
  status text not null check (status in ('REGISTERING', 'RUNNING', 'COMPLETED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists tournaments_status on tournaments (status, created_at desc);
alter table tournaments enable row level security;
