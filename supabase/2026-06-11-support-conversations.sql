create table if not exists public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  source_channel varchar(40) not null default 'in_app' check (source_channel in ('in_app', 'email')),
  source_email text,
  source_name text,
  external_thread_id varchar(255),
  subject text,
  status varchar(40) not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  metadata jsonb not null default '{}'::jsonb,
  last_message_at timestamp default now(),
  created_at timestamp default now(),
  updated_at timestamp default now()
);

alter table public.support_tickets
  add column if not exists conversation_id uuid references public.support_conversations(id) on delete set null,
  add column if not exists case_number integer,
  add column if not exists case_source varchar(40) not null default 'manual' check (case_source in ('manual', 'ai', 'email', 'admin'));

alter table public.ticket_messages
  add column if not exists sender_type varchar(30) not null default 'user' check (sender_type in ('user', 'assistant', 'support', 'admin', 'system')),
  add column if not exists sender_label text,
  add column if not exists department_key varchar(80),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_support_conversations_user_channel
  on public.support_conversations(user_id, source_channel, updated_at desc);

create index if not exists idx_support_conversations_email_thread
  on public.support_conversations(source_email, external_thread_id, updated_at desc);

create index if not exists idx_support_tickets_conversation
  on public.support_tickets(conversation_id, case_number);

create index if not exists idx_ticket_messages_sender_type
  on public.ticket_messages(sender_type, created_at desc);

create or replace function public.set_support_conversation_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_support_conversations_updated_at on public.support_conversations;
create trigger trg_support_conversations_updated_at
before update on public.support_conversations
for each row
execute function public.set_support_conversation_updated_at();

alter table public.support_conversations replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'support_conversations'
     ) then
    alter publication supabase_realtime add table public.support_conversations;
  end if;
end $$;
