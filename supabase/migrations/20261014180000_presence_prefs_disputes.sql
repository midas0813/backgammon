-- Player settings required by the brief (sound, high contrast, board orientation),
-- presence shared across server instances, and player problem reports (disputes).

alter table app_users add column if not exists sound boolean not null default true;
alter table app_users add column if not exists high_contrast boolean not null default false;
alter table app_users add column if not exists board_orientation text not null default 'right';
do $$ begin
  alter table app_users add constraint app_users_board_orientation check (board_orientation in ('right', 'left'));
exception when duplicate_object then null; end $$;

-- "Online" badge: last time each seat polled the match. Written at most every few seconds per seat.
create table if not exists match_presence (
  match_id text not null,
  seat smallint not null check (seat in (0, 1)),
  seen_at timestamptz not null,
  primary key (match_id, seat)
);

create table if not exists disputes (
  id text primary key,                  -- reference shown to the player
  user_id uuid not null,
  match_id text,
  transaction_id text,
  category text not null check (category in ('GAME', 'PAYMENT', 'ACCOUNT', 'OTHER')),
  reason text not null check (char_length(reason) between 5 and 2000),
  status text not null default 'OPEN',
  created_at timestamptz not null default now()
);
create index if not exists disputes_user on disputes (user_id, created_at desc);

alter table match_presence enable row level security;
alter table disputes enable row level security;
