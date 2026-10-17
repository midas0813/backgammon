-- Friends and direct match invites (also used for rematches).
create table if not exists friendships (
  id bigserial primary key,
  user_a uuid not null,                 -- the lower id of the pair
  user_b uuid not null,                 -- the higher id
  requested_by uuid not null,
  status text not null check (status in ('PENDING', 'ACCEPTED')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (user_a, user_b)
);
create index if not exists friendships_b on friendships (user_b);

create table if not exists match_invites (
  id bigserial primary key,
  from_user uuid not null,
  to_user uuid not null,
  match_id text not null,
  rematch_of text,                      -- the finished match this rematch follows
  status text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
  created_at timestamptz not null default now()
);
create index if not exists match_invites_to on match_invites (to_user, status);
create index if not exists match_invites_rematch on match_invites (rematch_of);

alter table friendships enable row level security;
alter table match_invites enable row level security;
