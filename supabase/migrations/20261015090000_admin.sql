-- Admin area: wallet-based admin roles, short admin sessions, signed challenges, an append-only audit
-- log, operator settings and announcements, user suspension, match voiding, report handling and
-- two-person balance adjustments.

-- Users can be suspended (blocks wallet sign-in and starting or joining matches).
alter table app_users add column if not exists status text not null default 'active';
alter table app_users add column if not exists suspended_until timestamptz;
alter table app_users add column if not exists suspended_reason text;
do $$ begin
  alter table app_users add constraint app_users_status check (status in ('active', 'suspended'));
exception when duplicate_object then null; end $$;

-- An administrative void is a status, never a deletion (spec 02).
alter table matches drop constraint if exists matches_status_check;
alter table matches add constraint matches_status_check
  check (status in ('WAITING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'VOIDED'));

-- Roles: one active role per user; revoking keeps the row.
create table if not exists admin_roles (
  id bigserial primary key,
  user_id uuid not null,
  role text not null check (role in ('owner', 'operator', 'finance', 'viewer')),
  granted_by uuid,
  granted_at timestamptz not null default now(),
  revoked_by uuid,
  revoked_at timestamptz
);
create unique index if not exists admin_roles_one_active on admin_roles (user_id) where revoked_at is null;

-- Admin sessions are separate from game sessions and short-lived (30 min idle, 8 h max).
create table if not exists admin_sessions (
  token uuid primary key,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ip text,
  user_agent text
);
create index if not exists admin_sessions_user on admin_sessions (user_id);

-- Messages an admin's wallet must sign: sign-in, and each risky action (step-up).
create table if not exists admin_challenges (
  nonce text primary key,
  user_id uuid not null,
  purpose text not null,
  message text not null,
  details jsonb not null default '{}',
  expires_at timestamptz not null,
  used_at timestamptz
);

-- Append-only audit log.
create table if not exists admin_audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_role text,
  action text not null,
  target_type text,
  target_id text,
  reason text,
  details jsonb not null default '{}',
  ip text,
  user_agent text,
  signature text
);
create index if not exists admin_audit_at on admin_audit (at desc);
create index if not exists admin_audit_actor on admin_audit (actor_id, at desc);
create index if not exists admin_audit_target on admin_audit (target_type, target_id, at desc);
create or replace function admin_audit_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'audit rows are immutable';
end $$;
drop trigger if exists admin_audit_no_change on admin_audit;
create trigger admin_audit_no_change before update or delete on admin_audit
  for each row execute function admin_audit_immutable();

create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists announcements (
  id text primary key,
  message text not null check (char_length(message) between 3 and 280),
  tone text not null default 'info' check (tone in ('info', 'warn', 'ok')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  expires_at timestamptz
);

-- Problem reports: assignment, resolution and internal notes.
alter table disputes add column if not exists assigned_to uuid;
alter table disputes add column if not exists resolution text;
alter table disputes add column if not exists updated_at timestamptz;
create index if not exists disputes_status on disputes (status, created_at desc);
create table if not exists dispute_notes (
  id bigserial primary key,
  dispute_id text not null,
  author_id uuid not null,
  note text not null check (char_length(note) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists dispute_notes_dispute on dispute_notes (dispute_id, id);

-- Manual balance adjustments: requested by one admin, approved by a different one.
create table if not exists admin_adjustments (
  id text primary key,
  user_id uuid not null,
  account_kind text not null check (account_kind in ('PAID_AVAILABLE', 'FREE_CREDITS')),
  amount bigint not null check (amount <> 0),
  reason text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  txn_key text
);
create index if not exists admin_adjustments_status on admin_adjustments (status, requested_at desc);

-- Adjustments post against this system account, which may go negative like the other sources.
alter table ledger_accounts drop constraint if exists ledger_no_overdraft;
alter table ledger_accounts add constraint ledger_no_overdraft check (
  balance >= 0 or account in ('system:EXTERNAL_CLEARING', 'system:FREE_ISSUANCE', 'system:ADJUSTMENTS')
);

create index if not exists deposit_intents_status on deposit_intents (status, created_at desc);
create index if not exists withdrawals_status on withdrawals (status, created_at desc);
create index if not exists app_users_created on app_users (created_at);

alter table admin_roles enable row level security;
alter table admin_sessions enable row level security;
alter table admin_challenges enable row level security;
alter table admin_audit enable row level security;
alter table app_settings enable row level security;
alter table announcements enable row level security;
alter table dispute_notes enable row level security;
alter table admin_adjustments enable row level security;
