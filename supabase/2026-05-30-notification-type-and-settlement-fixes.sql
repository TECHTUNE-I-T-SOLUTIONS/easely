-- Fix notification event values so triggers respect the existing notifications.type check.
-- Run this after the mobile review migration if the old trigger version was already applied.

create or replace function public.notify_on_ride_status_change()
returns trigger
language plpgsql
as $$
declare
  v_title text;
  v_message text;
  v_event_type text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  v_event_type := case
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
    public.ck_notification_route(v_event_type, 'rider', 'ride', new.id),
    public.ck_notification_route(v_event_type, 'rider', 'ride', new.id),
    jsonb_build_object('rideId', new.id, 'status', new.status, 'event_type', v_event_type)
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
      public.ck_notification_route(v_event_type, 'driver', 'ride', new.id),
      public.ck_notification_route(v_event_type, 'driver', 'ride', new.id),
      jsonb_build_object('rideId', new.id, 'status', new.status, 'event_type', v_event_type)
    from public.drivers d
    where d.id = new.driver_id;
  end if;

  return new;
end;
$$;

-- Keep future remittance/payment notifications within the broad allowed type buckets.
-- The app should read metadata.event_type for the specific event name.
