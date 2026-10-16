-- One game at a time, abandoned games, results and an append-only event log.
--  * matches: indexes for "the player's current game" and for finding idle matches.
--  * match_results: one row per human player per finished match, so stats never load match documents.
--  * app_counters: site-wide running totals (games played).
--  * match_events / match_actions: each move appends rows instead of rewriting the whole match.

create index if not exists matches_seat0_status on matches (seat0, status);
create index if not exists matches_seat1_status on matches (seat1, status);
create index if not exists matches_status_updated on matches (status, updated_at);

create table if not exists match_results (
  match_id text not null,
  user_id uuid not null,
  mode text not null,
  won boolean not null,
  points integer not null,
  games integer not null,
  gammons integer not null,
  opponent text not null,
  score_for integer not null,
  score_against integer not null,
  target_points integer not null,
  end_reason text not null,
  completed_at timestamptz not null,
  primary key (match_id, user_id)
);
create index if not exists match_results_user on match_results (user_id, completed_at desc);

create table if not exists app_counters (
  key text primary key,
  value bigint not null default 0
);

create table if not exists match_events (
  match_id text not null,
  seq integer not null,
  type text not null,
  state_version integer not null,
  server_time timestamptz not null,
  payload jsonb not null,
  primary key (match_id, seq)
);

create table if not exists match_actions (
  match_id text not null,
  action_id text not null,
  fingerprint text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (match_id, action_id)
);

alter table match_results enable row level security;
alter table app_counters enable row level security;
alter table match_events enable row level security;
alter table match_actions enable row level security;

-- Move the event and action logs out of the match documents.
insert into match_events (match_id, seq, type, state_version, server_time, payload)
select m.id, (e->>'seq')::int, e->>'type', (e->>'stateVersion')::int, (e->>'serverTime')::timestamptz, coalesce(e->'payload', '{}'::jsonb)
from matches m, jsonb_array_elements(case when jsonb_typeof(m.data->'events') = 'array' then m.data->'events' else '[]'::jsonb end) e
on conflict do nothing;

insert into match_actions (match_id, action_id, fingerprint, response)
select m.id, a.key, a.value->>'fingerprint', coalesce(a.value->'response', '{}'::jsonb)
from matches m, jsonb_each(case when jsonb_typeof(m.data->'actions') = 'object' then m.data->'actions' else '{}'::jsonb end) a
on conflict do nothing;

update matches set data = jsonb_set(jsonb_set(data, '{events}', '[]'::jsonb), '{actions}', '{}'::jsonb)
where jsonb_typeof(data) = 'object' and (data->'events' <> '[]'::jsonb or data->'actions' <> '{}'::jsonb);

-- Results of matches finished so far (computer games count; pass & play does not).
insert into match_results (match_id, user_id, mode, won, points, games, gammons, opponent, score_for, score_against,
                           target_points, end_reason, completed_at)
select m.id, (m.data->'seats'->>s.seat)::uuid, m.mode,
       (m.data->'state'->>'winner')::int = s.seat,
       coalesce((select sum((r->>'points')::int) from jsonb_array_elements(m.data->'state'->'results') r
                 where (r->>'winner')::int = s.seat), 0),
       jsonb_array_length(m.data->'state'->'results'),
       (select count(*) from jsonb_array_elements(m.data->'state'->'results') r
         where (r->>'winner')::int = s.seat and r->>'kind' in ('gammon', 'backgammon')),
       coalesce(m.data->'names'->>(1 - s.seat), ''),
       (m.data->'state'->'score'->>s.seat)::int,
       (m.data->'state'->'score'->>(1 - s.seat))::int,
       m.target_points,
       coalesce(m.data->'state'->>'endReason', 'points'),
       coalesce(m.completed_at, m.updated_at)
from matches m cross join (values (0), (1)) as s(seat)
where m.status = 'COMPLETED' and m.mode <> 'local'
  and m.data->'seats'->>s.seat ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
on conflict do nothing;

insert into app_counters (key, value)
select 'games', coalesce(sum(jsonb_array_length(data->'state'->'results')), 0) from matches
where status in ('COMPLETED', 'ACTIVE') and jsonb_typeof(data->'state'->'results') = 'array'
on conflict (key) do nothing;
