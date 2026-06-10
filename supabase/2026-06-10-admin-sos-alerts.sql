create table if not exists public.sos_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  user_role text,
  user_name text,
  user_email text,
  user_phone text,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved', 'false_alarm')),
  latitude double precision,
  longitude double precision,
  accuracy double precision,
  altitude double precision,
  heading double precision,
  speed double precision,
  full_address text,
  street text,
  place_name text,
  city text,
  region text,
  country text,
  postal_code text,
  active_ride_id uuid references public.rides(id) on delete set null,
  active_ride_status text,
  active_ride_note text,
  driver_user_id uuid references public.users(id) on delete set null,
  driver_name text,
  driver_phone text,
  device_name text,
  device_brand text,
  device_model text,
  os_name text,
  os_version text,
  app_version text,
  raw_location jsonb not null default '{}'::jsonb,
  raw_device jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  acknowledged_by uuid references public.users(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_sos_alerts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_sos_alerts_updated_at on public.sos_alerts;
create trigger trg_sos_alerts_updated_at
before update on public.sos_alerts
for each row
execute function public.set_sos_alerts_updated_at();

create index if not exists idx_sos_alerts_status_created_at
  on public.sos_alerts(status, created_at desc);

create index if not exists idx_sos_alerts_user_created_at
  on public.sos_alerts(user_id, created_at desc);

create index if not exists idx_sos_alerts_active_ride_id
  on public.sos_alerts(active_ride_id);

alter table public.sos_alerts replica identity full;

create or replace function public.insert_admin_notifications_for_sos()
returns trigger
language plpgsql
as $$
begin
  insert into public.admin_notifications (
    recipient_user_id,
    recipient_department,
    title,
    body,
    type,
    action_url,
    metadata
  )
  select
    a.user_id,
    null,
    'SOS alert triggered',
    coalesce(new.user_name, 'A Charter Keke user') ||
      case
        when new.full_address is not null and length(new.full_address) > 0
          then ' triggered SOS at ' || new.full_address || '.'
        else ' triggered SOS.'
      end,
    'sos_alert',
    '/admin/sos?alert=' || new.id,
    jsonb_build_object(
      'sosAlertId', new.id,
      'userId', new.user_id,
      'activeRideId', new.active_ride_id,
      'sourceEventId', 'sos_alert:' || new.id,
      'source', 'database_trigger'
    )
  from public.admins a
  join public.users u on u.id = a.user_id
  where coalesce(u.status, 'active') <> 'deleted'
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists trg_insert_admin_notifications_for_sos on public.sos_alerts;
create trigger trg_insert_admin_notifications_for_sos
after insert on public.sos_alerts
for each row
execute function public.insert_admin_notifications_for_sos();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'sos_alerts'
     ) then
    alter publication supabase_realtime add table public.sos_alerts;
  end if;
end $$;
