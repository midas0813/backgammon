-- Multiple games on one platform: each match and result records its game; XP and ratings are per game.
-- Backgammon keeps its existing columns on app_users; other games use user_game_stats.

alter table matches add column if not exists game text not null default 'backgammon';
create index if not exists matches_game_public on matches (game, mode, status, created_at desc);

alter table match_results add column if not exists game text not null default 'backgammon';
create index if not exists match_results_game_period on match_results (game, completed_at, user_id);

create table if not exists user_game_stats (
  user_id uuid not null references app_users (id) on delete cascade,
  game text not null,
  xp integer not null default 0,
  rating double precision not null default 1500,
  rating_experience integer not null default 0,
  rating_games integer not null default 0,
  primary key (user_id, game)
);
create index if not exists user_game_stats_rating on user_game_stats (game, rating desc) where rating_games > 0;
alter table user_game_stats enable row level security;
