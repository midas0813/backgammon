-- Ratings (FIBS formula) for ranked matches: rating, experience (match points played in ranked
-- matches) and games; each result keeps its rating change.
alter table app_users add column if not exists rating double precision not null default 1500;
alter table app_users add column if not exists rating_experience integer not null default 0;
alter table app_users add column if not exists rating_games integer not null default 0;
create index if not exists app_users_rating on app_users (rating desc) where rating_games > 0;
alter table match_results add column if not exists rating_change double precision;
