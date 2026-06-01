-- Charter Keke mobile notification/support deltas.
-- Run in Supabase to make notification deeplinks and support/admin broadcasts tolerant of new event types.

alter table if exists public.notifications
  add column if not exists deeplink text,
  add column if not exists action_url text,
  add column if not exists target_type varchar(80),
  add column if not exists target_id uuid,
  add column if not exists metadata jsonb default '{}'::jsonb;

update public.notifications
set
  deeplink = coalesce(deeplink, deep_link, action_url),
  deep_link = coalesce(deep_link, deeplink, action_url),
  action_url = coalesce(action_url, deeplink, deep_link),
  target_type = coalesce(target_type, entity_type),
  target_id = coalesce(target_id, entity_id),
  entity_type = coalesce(entity_type, target_type),
  entity_id = coalesce(entity_id, target_id),
  metadata = coalesce(metadata, data, '{}'::jsonb),
  data = coalesce(data, metadata, '{}'::jsonb);

alter table if exists public.notifications
  alter column metadata set default '{}'::jsonb;

alter table if exists public.notifications
  drop constraint if exists notifications_type_check;

alter table if exists public.notifications
  add constraint notifications_type_check
  check (
    type is not null
    and length(trim(type::text)) between 1 and 80
    and type::text !~ '[[:space:]]'
  );

create index if not exists idx_notifications_user_created
  on public.notifications(user_id, created_at desc);

create index if not exists idx_notifications_deeplink
  on public.notifications(deeplink)
  where deeplink is not null;

create index if not exists idx_notifications_target
  on public.notifications(target_type, target_id)
  where target_type is not null and target_id is not null;

create or replace function public.emit_mobile_notification_event()
returns trigger
language plpgsql
as $$
begin
  perform pg_notify(
    'mobile_notifications',
    json_build_object(
      'id', new.id,
      'userId', new.user_id,
      'title', new.title,
      'message', new.message,
      'type', new.type,
      'deeplink', coalesce(new.deeplink, new.deep_link, new.action_url),
      'targetType', new.target_type,
      'targetId', new.target_id,
      'metadata', coalesce(new.metadata, '{}'::jsonb),
      'createdAt', new.created_at
    )::text
  );
  return new;
end;
$$;

drop trigger if exists trg_emit_mobile_notification_event on public.notifications;
create trigger trg_emit_mobile_notification_event
after insert on public.notifications
for each row execute function public.emit_mobile_notification_event();

create or replace function public.notify_support_ticket_message_mobile()
returns trigger
language plpgsql
as $$
declare
  v_ticket public.support_tickets%rowtype;
  v_sender_role text;
begin
  select * into v_ticket
  from public.support_tickets
  where id = new.ticket_id;

  select role into v_sender_role
  from public.users
  where id = new.sender_id;

  if v_ticket.user_id is not null and new.sender_id <> v_ticket.user_id and coalesce(new.is_internal, false) = false then
    insert into public.notifications (
      user_id,
      title,
      message,
      type,
      channel,
      deeplink,
      action_url,
      target_type,
      target_id,
      metadata
    )
    values (
      v_ticket.user_id,
      'Support replied',
      left(coalesce(new.message, 'Your support ticket has a new reply.'), 220),
      'support_ticket_message',
      'in_app',
      '/support/tickets/' || new.ticket_id::text,
      '/support/tickets/' || new.ticket_id::text,
      'support_ticket',
      new.ticket_id,
      jsonb_build_object(
        'ticketId', new.ticket_id,
        'messageId', new.id,
        'senderId', new.sender_id,
        'senderRole', v_sender_role
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_support_ticket_message_mobile on public.ticket_messages;
create trigger trg_notify_support_ticket_message_mobile
after insert on public.ticket_messages
for each row execute function public.notify_support_ticket_message_mobile();
