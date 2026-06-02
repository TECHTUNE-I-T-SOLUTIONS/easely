-- Ride expiry update:
-- Pending/dispatched rides are cancelled after the scheduled pickup day ends.
-- Accepted/in_progress rides are automatically completed after the scheduled pickup day ends.

create or replace function public.cancel_expired_open_rides()
returns integer
language plpgsql
security definer
as $$
declare
  v_cancelled_count integer := 0;
  v_completed_count integer := 0;
begin
  update public.rides
  set
    status = 'cancelled',
    cancellation_reason = coalesce(
      cancellation_reason,
      'No available drivers accepted this ride before the scheduled day ended.'
    ),
    updated_at = now()
  where status in ('pending', 'dispatched')
    and pickup_time is not null
    and pickup_time::date < current_date;

  get diagnostics v_cancelled_count = row_count;

  update public.rides
  set
    status = 'completed',
    dropoff_time = coalesce(dropoff_time, now()),
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
  where status in ('accepted', 'in_progress')
    and pickup_time is not null
    and pickup_time::date < current_date;

  get diagnostics v_completed_count = row_count;

  return v_cancelled_count + v_completed_count;
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
    when new.status = 'cancelled' then coalesce(
      new.cancellation_reason,
      'Your ride was cancelled because no driver accepted it before the scheduled day ended. Please book again when you are ready.'
    )
    when new.status = 'completed' then 'Your ride from ' || coalesce(new.pickup_zone, 'pickup') || ' to ' || coalesce(new.destination_zone, 'destination') || ' has been completed.'
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
