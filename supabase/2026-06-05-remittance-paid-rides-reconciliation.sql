-- Reconcile driver remittance from the real source of truth:
-- rides.remitted / rides.remitted_at / rides.remitted_by_payment_id.
--
-- Run this after deploying the backend fix. It:
-- 1) Marks rides covered by completed driver_payments as remitted.
-- 2) Rebuilds driver_daily_settlement totals so total_platform_fees means
--    unremitted platform fee still due, not historical paid fee.
-- 3) Marks stale empty settlements paid and stale unpaid past settlements overdue.

begin;

create or replace function public.ck_reconcile_driver_remittance()
returns void
language plpgsql
security definer
as $$
declare
  p record;
  sid uuid;
  settlement_day date;
begin
  for p in
    select id, driver_id, settlement_id, metadata
    from public.driver_payments
    where status = 'completed'
  loop
    if p.settlement_id is not null then
      select settlement_date into settlement_day
      from public.driver_daily_settlement
      where id = p.settlement_id and driver_id = p.driver_id;

      if settlement_day is not null then
        update public.rides
        set remitted = true,
            remitted_at = coalesce(remitted_at, now()),
            remitted_by_payment_id = coalesce(remitted_by_payment_id, p.id)
        where driver_id = p.driver_id
          and remitted = false
          and status in ('accepted', 'in_progress', 'completed')
          and ((updated_at + interval '1 hour')::date = settlement_day);
      end if;
    end if;

    if p.metadata ? 'settlement_ids' then
      for sid in
        select jsonb_array_elements_text(p.metadata -> 'settlement_ids')::uuid
      loop
        select settlement_date into settlement_day
        from public.driver_daily_settlement
        where id = sid and driver_id = p.driver_id;

        if settlement_day is not null then
          update public.rides
          set remitted = true,
              remitted_at = coalesce(remitted_at, now()),
              remitted_by_payment_id = coalesce(remitted_by_payment_id, p.id)
          where driver_id = p.driver_id
            and remitted = false
            and status in ('accepted', 'in_progress', 'completed')
            and ((updated_at + interval '1 hour')::date = settlement_day);
        end if;
      end loop;
    end if;

    if p.metadata ? 'ride_ids' then
      update public.rides r
      set remitted = true,
          remitted_at = coalesce(remitted_at, now()),
          remitted_by_payment_id = coalesce(remitted_by_payment_id, p.id)
      where r.driver_id = p.driver_id
        and r.remitted = false
        and r.id in (
          select jsonb_array_elements_text(p.metadata -> 'ride_ids')::uuid
        );
    end if;
  end loop;

  with daily as (
    select
      driver_id,
      ((updated_at + interval '1 hour')::date) as settlement_date,
      count(*)::integer as total_rides,
      coalesce(sum(fare_amount), 0) as total_fare_amount,
      coalesce(sum(case when remitted = false then platform_fee else 0 end), 0) as unremitted_platform_fees,
      coalesce(sum(driver_earnings), 0) as total_driver_earnings
    from public.rides
    where driver_id is not null
      and status in ('accepted', 'in_progress', 'completed')
    group by driver_id, ((updated_at + interval '1 hour')::date)
  )
  update public.driver_daily_settlement s
  set total_rides = d.total_rides,
      total_fare_amount = d.total_fare_amount,
      total_platform_fees = d.unremitted_platform_fees,
      total_driver_earnings = d.total_driver_earnings,
      settlement_status = case
        when d.unremitted_platform_fees <= 0 then 'paid'
        when s.settlement_date < ((now() + interval '1 hour')::date) then 'overdue'
        else 'pending'
      end,
      paid_at = case
        when d.unremitted_platform_fees <= 0 then coalesce(s.paid_at, now())
        else null
      end,
      updated_at = now()
  from daily d
  where s.driver_id = d.driver_id
    and s.settlement_date = d.settlement_date;

  update public.driver_daily_settlement s
  set total_platform_fees = 0,
      settlement_status = 'paid',
      paid_at = coalesce(paid_at, now()),
      updated_at = now()
  where not exists (
    select 1
    from public.rides r
    where r.driver_id = s.driver_id
      and r.status in ('accepted', 'in_progress', 'completed')
      and r.remitted = false
      and ((r.updated_at + interval '1 hour')::date = s.settlement_date)
  );
end;
$$;

select public.ck_reconcile_driver_remittance();

commit;
