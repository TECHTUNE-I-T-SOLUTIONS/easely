create table if not exists public.pricing_settings (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'RAIL v1',
  base_fare numeric not null default 800 check (base_fare >= 0),
  minimum_fare numeric not null default 1500 check (minimum_fare >= 0),
  per_minute numeric not null default 15 check (per_minute >= 0),
  platform_fee_rate numeric not null default 0.15 check (platform_fee_rate >= 0 and platform_fee_rate <= 1),
  eta_low_traffic_min_per_km numeric not null default 4 check (eta_low_traffic_min_per_km > 0),
  eta_normal_traffic_min_per_km numeric not null default 6 check (eta_normal_traffic_min_per_km > 0),
  eta_heavy_traffic_min_per_km numeric not null default 8 check (eta_heavy_traffic_min_per_km > 0),
  learning_weight numeric not null default 0.1 check (learning_weight >= 0 and learning_weight <= 1),
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.distance_bands (
  id uuid primary key default gen_random_uuid(),
  pricing_setting_id uuid not null references public.pricing_settings(id) on delete cascade,
  max_km numeric check (max_km is null or max_km > 0),
  rate numeric not null check (rate >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.route_metrics (
  id uuid primary key default gen_random_uuid(),
  route_key text not null unique,
  pickup_label text,
  destination_label text,
  ride_count integer not null default 0 check (ride_count >= 0),
  avg_minutes_per_km numeric not null default 6 check (avg_minutes_per_km > 0),
  morning_avg numeric,
  afternoon_avg numeric,
  evening_avg numeric,
  last_estimated_minutes numeric,
  last_actual_minutes numeric,
  last_distance_km numeric,
  updated_at timestamptz not null default now()
);

create table if not exists public.ride_pricing_audit (
  id uuid primary key default gen_random_uuid(),
  pricing_setting_id uuid references public.pricing_settings(id) on delete set null,
  admin_user_id uuid references public.users(id) on delete set null,
  action text not null check (action in ('created', 'updated', 'activated')),
  previous_values jsonb not null default '{}'::jsonb,
  next_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_pricing_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_pricing_settings_updated_at on public.pricing_settings;
create trigger trg_pricing_settings_updated_at
before update on public.pricing_settings
for each row execute function public.set_pricing_updated_at();

drop trigger if exists trg_distance_bands_updated_at on public.distance_bands;
create trigger trg_distance_bands_updated_at
before update on public.distance_bands
for each row execute function public.set_pricing_updated_at();

create index if not exists idx_pricing_settings_active
  on public.pricing_settings(is_active, updated_at desc);

create index if not exists idx_distance_bands_setting_sort
  on public.distance_bands(pricing_setting_id, sort_order asc);

create index if not exists idx_route_metrics_updated_at
  on public.route_metrics(updated_at desc);

insert into public.pricing_settings (
  name,
  base_fare,
  minimum_fare,
  per_minute,
  platform_fee_rate,
  eta_low_traffic_min_per_km,
  eta_normal_traffic_min_per_km,
  eta_heavy_traffic_min_per_km,
  learning_weight,
  is_active,
  notes
)
select
  'RAIL v1',
  800,
  1500,
  15,
  0.15,
  4,
  6,
  8,
  0.1,
  true,
  'Route Adaptive Intelligence Layer starting pricing model.'
where not exists (select 1 from public.pricing_settings);

with active_setting as (
  select id from public.pricing_settings where is_active = true order by updated_at desc limit 1
)
insert into public.distance_bands (pricing_setting_id, max_km, rate, sort_order)
select id, 3, 500, 1 from active_setting
where not exists (select 1 from public.distance_bands)
union all
select id, 10, 600, 2 from active_setting
where not exists (select 1 from public.distance_bands)
union all
select id, null, 700, 3 from active_setting
where not exists (select 1 from public.distance_bands);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'pricing_settings'
     ) then
    alter publication supabase_realtime add table public.pricing_settings;
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'distance_bands'
     ) then
    alter publication supabase_realtime add table public.distance_bands;
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'route_metrics'
     ) then
    alter publication supabase_realtime add table public.route_metrics;
  end if;
end $$;
