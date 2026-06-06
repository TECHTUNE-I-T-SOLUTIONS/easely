-- Repair accounts deleted before the anonymized phone was shortened to fit users.phone_number varchar(20).
-- This only touches users already present in deleted_accounts.

update public.users u
set
  first_name = 'Deleted',
  last_name = 'User',
  email = 'deleted-' || u.id::text || '@deleted.charterkeke.local',
  phone_number = 'del-' || substring(replace(u.id::text, '-', '') from 1 for 16),
  profile_picture_url = null,
  emergency_contact = null,
  emergency_phone = null,
  password_reset_token = null,
  password_reset_expiry = null,
  profile_complete = false,
  status = case
    when exists (
      select 1
      from pg_constraint c
      where c.conrelid = 'public.users'::regclass
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) ilike '%deleted%'
    ) then 'deleted'
    else 'suspended'
  end,
  deleted_at = coalesce(u.deleted_at, da.deleted_at),
  deletion_reason = coalesce(u.deletion_reason, 'user_requested'),
  updated_at = now()
from public.deleted_accounts da
where da.original_user_id = u.id
  and coalesce(u.status, '') <> 'deleted';

update public.drivers d
set
  availability_status = 'offline',
  bank_name = null,
  bank_account_number = null,
  account_name = null,
  emergency_contact = null,
  vehicle_picture_url = null,
  license_picture_url = null,
  verified = false,
  updated_at = now()
from public.deleted_accounts da
where d.user_id = da.original_user_id;
