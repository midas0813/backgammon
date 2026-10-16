-- Match chat: players and spectators send short messages, preset phrases and emoji reactions.
-- Kept for moderation (reports, admin review); removed messages stay with who removed them.
create table if not exists match_chat (
  id bigserial primary key,
  match_id text not null,
  user_id uuid not null,
  name text not null,
  role text not null check (role in ('player', 'spectator')),
  kind text not null check (kind in ('text', 'preset', 'emoji')),
  body text not null check (length(body) <= 200),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid
);
create index if not exists match_chat_match on match_chat (match_id, id);
alter table match_chat enable row level security;
