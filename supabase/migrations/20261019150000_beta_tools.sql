-- Beta tools: invite codes (where players come from; optionally required to create an account) and
-- in-app feedback.
create table if not exists invite_codes (
  code text primary key,                -- shown upper-case, stored upper-case
  label text not null,                  -- the community or partner, e.g. "Discord"
  max_uses integer,                     -- null = unlimited
  uses integer not null default 0,
  expires_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  active boolean not null default true
);
alter table app_users add column if not exists invite_code text;

create table if not exists feedback (
  id bigserial primary key,
  user_id uuid,
  kind text not null check (kind in ('idea', 'bug', 'other')),
  message text not null check (length(message) <= 2000),
  path text,
  user_agent text,
  status text not null default 'NEW' check (status in ('NEW', 'READ', 'DONE')),
  created_at timestamptz not null default now()
);
create index if not exists feedback_status on feedback (status, id desc);

alter table invite_codes enable row level security;
alter table feedback enable row level security;
