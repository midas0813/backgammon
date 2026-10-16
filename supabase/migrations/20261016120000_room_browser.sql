-- Room browser: tables carry an entry fee (0 = free) and are filtered and paged by length, fee and age.
alter table matches add column if not exists entry_fee bigint not null default 0;
create index if not exists matches_public_tables on matches (mode, status, target_points, entry_fee, created_at desc);
