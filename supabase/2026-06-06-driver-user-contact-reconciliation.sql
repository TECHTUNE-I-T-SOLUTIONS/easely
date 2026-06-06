-- Reconcile signup/contact data after phone/email normalization and driver signup fixes.
-- Run the SELECT reports first; if they show duplicates, merge or delete duplicate accounts
-- before creating the unique indexes in 2026-06-06-normalize-user-contact-identifiers.sql.

-- 1) Preview duplicate normalized emails.
select lower(trim(email)) as normalized_email, count(*) as account_count, array_agg(id) as user_ids
from public.users
where email is not null
  and coalesce(status, '') <> 'deleted'
group by lower(trim(email))
having count(*) > 1;

-- 2) Preview duplicate normalized Nigerian phone numbers.
with normalized as (
  select
    id,
    phone_number,
    case
      when regexp_replace(coalesce(phone_number, ''), '\D', '', 'g') like '234%' then regexp_replace(coalesce(phone_number, ''), '\D', '', 'g')
      when regexp_replace(coalesce(phone_number, ''), '\D', '', 'g') like '0%' then '234' || substring(regexp_replace(coalesce(phone_number, ''), '\D', '', 'g') from 2)
      when length(regexp_replace(coalesce(phone_number, ''), '\D', '', 'g')) = 10 then '234' || regexp_replace(coalesce(phone_number, ''), '\D', '', 'g')
      else regexp_replace(coalesce(phone_number, ''), '\D', '', 'g')
    end as phone_digits
  from public.users
  where phone_number is not null
    and coalesce(status, '') <> 'deleted'
)
select phone_digits, count(*) as account_count, array_agg(id) as user_ids
from normalized
where phone_digits <> ''
group by phone_digits
having count(*) > 1;

-- 3) Normalize existing user emails and phone numbers.
update public.users
set
  email = lower(trim(email)),
  updated_at = now()
where email is not null
  and email <> lower(trim(email));

update public.users
set
  phone_number = '+' || case
    when regexp_replace(coalesce(phone_number, ''), '\D', '', 'g') like '234%' then regexp_replace(coalesce(phone_number, ''), '\D', '', 'g')
    when regexp_replace(coalesce(phone_number, ''), '\D', '', 'g') like '0%' then '234' || substring(regexp_replace(coalesce(phone_number, ''), '\D', '', 'g') from 2)
    when length(regexp_replace(coalesce(phone_number, ''), '\D', '', 'g')) = 10 then '234' || regexp_replace(coalesce(phone_number, ''), '\D', '', 'g')
    else regexp_replace(coalesce(phone_number, ''), '\D', '', 'g')
  end,
  updated_at = now()
where phone_number is not null
  and regexp_replace(coalesce(phone_number, ''), '\D', '', 'g') <> ''
  and phone_number <> '+' || case
    when regexp_replace(coalesce(phone_number, ''), '\D', '', 'g') like '234%' then regexp_replace(coalesce(phone_number, ''), '\D', '', 'g')
    when regexp_replace(coalesce(phone_number, ''), '\D', '', 'g') like '0%' then '234' || substring(regexp_replace(coalesce(phone_number, ''), '\D', '', 'g') from 2)
    when length(regexp_replace(coalesce(phone_number, ''), '\D', '', 'g')) = 10 then '234' || regexp_replace(coalesce(phone_number, ''), '\D', '', 'g')
    else regexp_replace(coalesce(phone_number, ''), '\D', '', 'g')
  end;

-- 4) Keep driver emergency contact in sync with the canonical user emergency fields.
update public.drivers d
set
  emergency_contact = trim(concat_ws(' - ', nullif(u.emergency_contact, ''), nullif(u.emergency_phone, ''))),
  updated_at = now()
from public.users u
where d.user_id = u.id
  and coalesce(trim(d.emergency_contact), '') = ''
  and coalesce(trim(concat_ws(' - ', nullif(u.emergency_contact, ''), nullif(u.emergency_phone, ''))), '') <> '';

-- 5) Normalize driver bank account numbers and copy a safe account-name fallback where missing.
update public.drivers d
set
  bank_account_number = regexp_replace(coalesce(d.bank_account_number, ''), '\D', '', 'g'),
  updated_at = now()
where d.bank_account_number is not null
  and d.bank_account_number <> regexp_replace(coalesce(d.bank_account_number, ''), '\D', '', 'g');

update public.drivers d
set
  account_name = trim(concat_ws(' ', u.first_name, u.last_name)),
  updated_at = now()
from public.users u
where d.user_id = u.id
  and coalesce(trim(d.account_name), '') = ''
  and coalesce(trim(concat_ws(' ', u.first_name, u.last_name)), '') <> '';

-- 6) Report rows that still need admin/user follow-up because required signup data is missing.
select
  u.id as user_id,
  u.role,
  u.email,
  u.phone_number,
  u.profile_picture_url,
  u.emergency_contact,
  u.emergency_phone,
  d.id as driver_id,
  d.vehicle_type,
  d.plate_number,
  d.bank_name,
  d.bank_account_number,
  d.account_name,
  d.vehicle_picture_url,
  d.license_picture_url
from public.users u
left join public.drivers d on d.user_id = u.id
where coalesce(u.status, '') <> 'deleted'
  and (
    u.profile_picture_url is null
    or coalesce(trim(u.emergency_contact), '') = ''
    or coalesce(trim(u.emergency_phone), '') = ''
    or (
      u.role = 'driver'
      and (
        d.id is null
        or coalesce(trim(d.vehicle_type), '') = ''
        or coalesce(trim(d.plate_number), '') = ''
        or coalesce(trim(d.bank_name), '') = ''
        or coalesce(trim(d.bank_account_number), '') = ''
        or coalesce(trim(d.account_name), '') = ''
        or coalesce(trim(d.vehicle_picture_url), '') = ''
        or coalesce(trim(d.license_picture_url), '') = ''
      )
    )
  )
order by u.created_at desc;
