-- Request limits: one row per (rule, window length, player or address), holding the current window.
create table if not exists rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null
);
create index if not exists rate_limits_window on rate_limits (window_start);
alter table rate_limits enable row level security;
