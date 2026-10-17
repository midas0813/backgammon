-- Weekly leaderboard and free prize pool.
--  * match_results.lb_points: leaderboard points for that result (0 when capped or not eligible).
--  * match_results.flagged: under anti-cheat review; does not count for prizes until cleared.
--  * prize_weeks: each finished week's proposed winners, approved (paid) or skipped by an admin.
--  * system:PRIZES funds prizes and, like the other system sources, may go negative.
alter table match_results add column if not exists lb_points integer not null default 0;
alter table match_results add column if not exists flagged boolean not null default false;
create index if not exists match_results_period on match_results (completed_at, user_id);

create table if not exists prize_weeks (
  week_key text primary key,              -- Monday (UTC) that starts the week, e.g. 2026-10-12
  status text not null check (status in ('PENDING_REVIEW', 'PAID', 'SKIPPED')),
  pool_units bigint not null,
  winners jsonb not null,                 -- [{ userId, name, place, points, units }]
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  note text
);
alter table prize_weeks enable row level security;

alter table ledger_accounts drop constraint if exists ledger_no_overdraft;
alter table ledger_accounts add constraint ledger_no_overdraft check (
  balance >= 0 or account in ('system:EXTERNAL_CLEARING', 'system:FREE_ISSUANCE', 'system:ADJUSTMENTS', 'system:PRIZES')
);
