-- Apple App Review privacy cleanup.
-- Charter Keke no longer collects date of birth or gender during signup/profile flows.
-- Run after deploying the backend changes that remove all users.dob/users.gender writes.

alter table public.users
  drop column if exists dob;

alter table public.users
  drop column if exists gender;

