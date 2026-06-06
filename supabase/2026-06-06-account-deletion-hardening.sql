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
