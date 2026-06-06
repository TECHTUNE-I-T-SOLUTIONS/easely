-- Normalize stored auth identifiers so signup, login, and password recovery agree.
-- Run the duplicate checks first; resolve any returned rows before adding indexes.

select lower(trim(email)) as normalized_email, count(*) as duplicate_count, array_agg(id) as user_ids
from public.users
where email is not null
  and status <> 'deleted'
group by lower(trim(email))
having count(*) > 1;

select regexp_replace(phone_number, '[^0-9]', '', 'g') as phone_digits, count(*) as duplicate_count, array_agg(id) as user_ids
from public.users
where phone_number is not null
  and status <> 'deleted'
group by regexp_replace(phone_number, '[^0-9]', '', 'g')
having count(*) > 1;

update public.users
set email = lower(trim(email))
where email is not null
  and email <> lower(trim(email));

update public.users
set phone_number = case
  when regexp_replace(phone_number, '[^0-9]', '', 'g') like '234%' then '+' || regexp_replace(phone_number, '[^0-9]', '', 'g')
  when regexp_replace(phone_number, '[^0-9]', '', 'g') like '0%' then '+234' || substring(regexp_replace(phone_number, '[^0-9]', '', 'g') from 2)
  when length(regexp_replace(phone_number, '[^0-9]', '', 'g')) = 10 then '+234' || regexp_replace(phone_number, '[^0-9]', '', 'g')
  else regexp_replace(phone_number, '[^0-9+]', '', 'g')
end
where phone_number is not null;

create unique index if not exists users_email_lower_unique_active
on public.users (lower(email))
where status <> 'deleted';

create unique index if not exists users_phone_digits_unique_active
on public.users ((regexp_replace(phone_number, '[^0-9]', '', 'g')))
where status <> 'deleted';
