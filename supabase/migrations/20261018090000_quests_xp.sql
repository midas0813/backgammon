-- Quests, XP, levels and avatar frames; opponents' accounts on results (caps and eligibility rules).
alter table app_users add column if not exists xp integer not null default 0;
alter table app_users add column if not exists frame text not null default 'none';
alter table match_results add column if not exists opponent_id uuid;
create index if not exists match_results_pair on match_results (user_id, opponent_id, completed_at);

create table if not exists quest_progress (
  user_id uuid not null,
  period_key text not null,       -- d:2026-10-18 or w:2026-10-12 (Monday, UTC)
  quest_id text not null,
  progress integer not null default 0,
  target integer not null,
  claimed_at timestamptz,
  primary key (user_id, period_key, quest_id)
);
alter table quest_progress enable row level security;
