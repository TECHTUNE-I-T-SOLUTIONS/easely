-- Mobile review fixes: notification deep links, consistent platform fee, and expired ride cleanup.

alter table public.notifications
  add column if not exists deep_link text,
  add column if not exists action_url text,
  add column if not exists entity_type text,
  add column if not exists entity_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_notifications_entity
  on public.notifications(entity_type, entity_id);

create index if not exists idx_notifications_deep_link
  on public.notifications(deep_link)
  where deep_link is not null;

create or replace function public.ck_notification_route(
  p_type text,
  p_role text default null,
  p_entity_type text default null,
  p_entity_id uuid default null
)
returns text
language plpgsql
stable
as $$
begin
  if p_entity_type = 'ride' and p_entity_id is not null then
    if p_role = 'driver' then
      return '/driver/ride-details?rideId=' || p_entity_id::text;
    end if;
    if p_type in ('ride_accepted', 'ride_update') then
      return '/rider/active-ride?rideId=' || p_entity_id::text;
    end if;
    return '/rider/ride-details?rideId=' || p_entity_id::text;
  end if;

  if p_entity_type = 'chat' and p_entity_id is not null then
    return '/' || coalesce(p_role, 'rider') || '/chat?chatId=' || p_entity_id::text;
  end if;

  if p_entity_type = 'support_ticket' and p_entity_id is not null then
    return '/' || coalesce(p_role, 'rider') || '/help-and-support?ticketId=' || p_entity_id::text;
  end if;

  if p_type in ('remittance_due', 'remittance_reminder', 'payment_received') then
    return '/driver/wallet';
  end if;

  return null;
end;
$$;

create or replace function public.set_platform_fee()
returns trigger
language plpgsql
as $$
begin
  if new.fare_amount is not null then
    new.platform_fee := round((new.fare_amount * 0.15)::numeric, 2);
    new.driver_earnings := round((new.fare_amount - new.platform_fee)::numeric, 2);
  end if;
  return new;
end;
$$;

create or replace function public.cancel_expired_open_rides()
returns integer
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  update public.rides
  set
    status = 'cancelled',
    cancellation_reason = coalesce(cancellation_reason, 'No available drivers accepted or completed this ride before the scheduled day ended.'),
    updated_at = now()
  where status in ('pending', 'dispatched', 'accepted', 'in_progress')
    and pickup_time is not null
    and pickup_time::date < current_date;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.notify_on_ride_status_change()
returns trigger
language plpgsql
as $$
declare
  v_title text;
  v_message text;
  v_type text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  v_type := case
    when new.status = 'accepted' then 'ride_accepted'
    when new.status = 'completed' then 'ride_completed'
    when new.status = 'cancelled' then 'ride_cancelled'
    else 'ride_update'
  end;

  v_title := case
    when new.status = 'accepted' then 'Driver Accepted'
    when new.status = 'in_progress' then 'Ride Started'
    when new.status = 'completed' then 'Ride Completed'
    when new.status = 'cancelled' then 'Ride Cancelled'
    else 'Ride Updated'
  end;

  v_message := case
    when new.status = 'cancelled' then 'Your ride was cancelled. Please book again when you are ready.'
    else 'Your ride from ' || coalesce(new.pickup_zone, 'pickup') || ' to ' || coalesce(new.destination_zone, 'destination') || ' is now ' || new.status || '.'
  end;

  insert into public.notifications (
    user_id, title, message, type, channel, entity_type, entity_id, deep_link, action_url, metadata
  )
  values (
    new.rider_id,
    v_title,
    v_message,
    'ride',
    'in_app',
    'ride',
    new.id,
    public.ck_notification_route(v_type, 'rider', 'ride', new.id),
    public.ck_notification_route(v_type, 'rider', 'ride', new.id),
    jsonb_build_object('rideId', new.id, 'status', new.status, 'event_type', v_type)
  );

  if new.driver_id is not null then
    insert into public.notifications (
      user_id, title, message, type, channel, entity_type, entity_id, deep_link, action_url, metadata
    )
    select
      d.user_id,
      v_title,
      v_message,
      'ride',
      'in_app',
      'ride',
      new.id,
      public.ck_notification_route(v_type, 'driver', 'ride', new.id),
      public.ck_notification_route(v_type, 'driver', 'ride', new.id),
      jsonb_build_object('rideId', new.id, 'status', new.status, 'event_type', v_type)
    from public.drivers d
    where d.id = new.driver_id;
  end if;

  return new;
end;
$$;
