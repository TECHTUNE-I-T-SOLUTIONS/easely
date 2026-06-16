-- Support AI memory and feedback store for Charter Keke.
-- Run this in Supabase after the support AI backend changes.

create table if not exists public.support_ai_memory (
  id uuid primary key default gen_random_uuid(),
  memory_type text not null default 'knowledge' check (memory_type in ('knowledge', 'correction', 'policy', 'route', 'faq', 'escalation')),
  title text not null,
  content text not null,
  category text,
  audience text not null default 'all' check (audience in ('all', 'rider', 'driver', 'support', 'admin')),
  route text,
  tags text[] not null default '{}',
  source text not null default 'manual',
  source_entity_type text,
  source_entity_id uuid,
  confidence numeric(4,3) not null default 0.800 check (confidence >= 0 and confidence <= 1),
  usefulness_score integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_support_ai_memory_active_audience on public.support_ai_memory (is_active, audience);
create index if not exists idx_support_ai_memory_category on public.support_ai_memory (category);
create index if not exists idx_support_ai_memory_type on public.support_ai_memory (memory_type);
create index if not exists idx_support_ai_memory_created_at on public.support_ai_memory (created_at desc);
create index if not exists idx_support_ai_memory_tags on public.support_ai_memory using gin (tags);
create index if not exists idx_support_ai_memory_metadata on public.support_ai_memory using gin (metadata);

create table if not exists public.support_ai_feedback (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.support_tickets(id) on delete cascade,
  message_id uuid references public.ticket_messages(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  role text not null check (role in ('rider', 'driver', 'support', 'admin', 'system')),
  feedback_type text not null check (feedback_type in ('corrected_answer', 'wrong_role', 'wrong_route', 'too_many_questions', 'helpful', 'unhelpful', 'escalate')),
  original_reply text,
  corrected_reply text,
  correction_note text,
  route text,
  tags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_support_ai_feedback_ticket_id on public.support_ai_feedback (ticket_id);
create index if not exists idx_support_ai_feedback_user_id on public.support_ai_feedback (user_id);
create index if not exists idx_support_ai_feedback_created_at on public.support_ai_feedback (created_at desc);

create or replace function public.touch_support_ai_memory_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_support_ai_memory_updated_at on public.support_ai_memory;
create trigger trg_support_ai_memory_updated_at
before update on public.support_ai_memory
for each row execute function public.touch_support_ai_memory_updated_at();

alter table public.support_ai_memory enable row level security;
alter table public.support_ai_feedback enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'support_ai_memory'
      and policyname = 'support_ai_memory_service_role'
  ) then
    create policy support_ai_memory_service_role
      on public.support_ai_memory
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'support_ai_feedback'
      and policyname = 'support_ai_feedback_service_role'
  ) then
    create policy support_ai_feedback_service_role
      on public.support_ai_feedback
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;

comment on table public.support_ai_memory is 'Persistent support AI memory containing approved knowledge, corrections, routes, and escalation notes.';
comment on table public.support_ai_feedback is 'Feedback and corrections used to improve support AI responses over time.';

insert into public.support_ai_memory (
  memory_type,
  title,
  content,
  category,
  audience,
  route,
  tags,
  source,
  confidence,
  metadata
)
values
  (
    'knowledge',
    'Driver remittance lives in wallet',
    'Drivers should be told to open the driver wallet screen to pay remittance or view settlement status. Riders should not see driver payment steps.',
    'payment',
    'all',
    '/driver/wallet',
    array['driver', 'remittance', 'wallet', 'settlement'],
    'seed',
    0.95,
    '{"priority":"high"}'::jsonb
  ),
  (
    'route',
    'Driver wallet shortcut',
    'When a driver asks about remittance, settlement, payments, or wallet balance, answer directly and include the driver wallet link.',
    'payment',
    'driver',
    '/driver/wallet',
    array['wallet', 'remittance', 'driver'],
    'seed',
    0.95,
    '{"priority":"high"}'::jsonb
  ),
  (
    'policy',
    'Rider should not see driver remittance internals',
    'If a rider asks about driver remittance or settlement, explain it is only available to drivers and keep internal payment flow details private.',
    'policy',
    'rider',
    null,
    array['privacy', 'role-scope', 'driver'],
    'seed',
    0.95,
    '{"priority":"high"}'::jsonb
  )
on conflict do nothing;
