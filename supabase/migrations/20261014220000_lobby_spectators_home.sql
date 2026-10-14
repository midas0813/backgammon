-- Lobby tables, spectators and the Home dashboard.
--  * summary: the few fields lobby lists need, so listing never loads the full match document.
--  * allow_spectators: the host's choice; private (invite) matches are never listed.
--  * completed_at: lets "today" be a query instead of a scan.
--  * last_seen_at: "players online" and daily active users.

alter table matches add column if not exists summary jsonb;
alter table matches add column if not exists allow_spectators boolean not null default true;
alter table matches add column if not exists completed_at timestamptz;

update matches set completed_at = updated_at where status = 'COMPLETED' and completed_at is null;
update matches set summary = jsonb_build_object(
    'names', data->'names',
    'score', data->'state'->'score',
    'cube', coalesce(data->'state'->'game'->'cubeValue', '1'::jsonb),
    'gameNumber', coalesce(data->'state'->'game'->'gameNumber', '0'::jsonb),
    'hostId', data->'createdBy',
    'seats', data->'seats'
  )
  where summary is null and jsonb_typeof(data) = 'object';

create index if not exists matches_lobby on matches (mode, status, updated_at desc);
create index if not exists matches_completed on matches (completed_at) where completed_at is not null;

alter table app_users add column if not exists last_seen_at timestamptz;
create index if not exists app_users_last_seen on app_users (last_seen_at);

-- Viewers of a match: one row per user, refreshed while they watch.
create table if not exists match_spectators (
  match_id text not null,
  user_id uuid not null,
  seen_at timestamptz not null,
  primary key (match_id, user_id)
);
create index if not exists match_spectators_seen on match_spectators (match_id, seen_at);

alter table match_spectators enable row level security;
