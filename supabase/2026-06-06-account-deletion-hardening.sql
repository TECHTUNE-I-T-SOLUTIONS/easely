-- Apple 5.1.1(v): support permanent in-app account deletion.
-- This keeps operational ride/payment/support rows intact while making login impossible
-- and removing personal identifiers from the users table.

alter table public.users
  add column if not exists deleted_at timestamp without time zone,
  add column if not exists deletion_reason text;

do $$
declare
  constraint_name text;
begin
  select conname
    into constraint_name
  from pg_constraint
  where conrelid = 'public.users'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%'
  order by conname
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.users drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.users
  add constraint users_status_check
  check (status::text = any (array['active', 'suspended', 'pending', 'deleted']::text[]));

create index if not exists idx_users_deleted_at on public.users(deleted_at);

create table if not exists public.deleted_accounts (
  id uuid primary key default gen_random_uuid(),
  original_user_id uuid not null,
  role character varying,
  previous_status character varying,
  masked_email text,
  masked_phone text,
  email_hash text,
  phone_hash text,
  account_created_at timestamp without time zone,
  deleted_at timestamp without time zone not null default now(),
  deletion_reason text not null default 'user_requested',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp without time zone not null default now()
);

create index if not exists idx_deleted_accounts_original_user_id
  on public.deleted_accounts(original_user_id);

create index if not exists idx_deleted_accounts_email_hash
  on public.deleted_accounts(email_hash);

create index if not exists idx_deleted_accounts_phone_hash
  on public.deleted_accounts(phone_hash);

create index if not exists idx_deleted_accounts_deleted_at
  on public.deleted_accounts(deleted_at desc);
