-- Keep push subscriptions to one active row per user/platform.
-- Run this after deleting old duplicated rows, or run it as-is to deactivate extras first.

with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, platform
      order by
        case when push_token like 'placeholder_%' then 1 else 0 end asc,
        coalesce(last_verified_at, subscribed_at) desc,
        subscribed_at desc
    ) as rn
  from public.push_subscriptions
)
update public.push_subscriptions ps
set
  is_active = case when ranked.rn = 1 then true else false end,
  last_verified_at = now()
from ranked
where ps.id = ranked.id;

create unique index if not exists push_subscriptions_one_active_per_user_platform
on public.push_subscriptions (user_id, platform)
where is_active = true;
