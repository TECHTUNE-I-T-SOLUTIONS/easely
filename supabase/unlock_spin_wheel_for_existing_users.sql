-- Migration: Unlock Spin Wheel for Existing Users
-- This migration unlocks the spin wheel for users who have already completed rides
-- instead of automatically awarding the cashback bonus. Users must spin to determine
-- their actual reward (1-5% discount instead of automatic 10%)

-- Step 1: Create a function to unlock spin wheel for user
CREATE OR REPLACE FUNCTION unlock_spin_wheel_for_user(p_user_id uuid)
RETURNS boolean AS $$
DECLARE
  v_rider_stats RECORD;
BEGIN
  -- Get user's cashback stats
  SELECT * INTO v_rider_stats
  FROM public.user_cashback_stats
  WHERE user_id = p_user_id;

  -- Check if user already has the spin wheel unlocked
  IF v_rider_stats.first_ride_bonus_earned = true THEN
    RAISE NOTICE 'User % already has spin wheel unlocked', p_user_id;
    RETURN false;
  END IF;

  -- Check if user has completed any rides
  IF v_rider_stats.total_rides_completed = 0 THEN
    RAISE NOTICE 'User % has not completed any rides yet', p_user_id;
    RETURN false;
  END IF;

  -- Update user stats to mark spin wheel as unlocked (eligible)
  UPDATE public.user_cashback_stats
  SET
    first_ride_bonus_earned = true,
    updated_at = NOW()
  WHERE user_id = p_user_id;

  RAISE NOTICE 'Spin wheel unlocked for user %', p_user_id;
  RETURN true;

EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Error unlocking spin wheel for user %: %', p_user_id, SQLERRM;
  RETURN false;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Ensure all users have a cashback stats record
INSERT INTO public.user_cashback_stats (user_id, total_rides_completed, total_cashback_earned, total_cashback_used, available_cashback_balance, first_ride_bonus_earned, spin_wheel_plays_count)
SELECT
  u.id,
  (SELECT COUNT(*) FROM public.rides r WHERE r.rider_id = u.id AND r.status = 'completed'),
  0,
  0,
  0,
  false,
  0
FROM public.users u
WHERE u.role = 'user'
  AND u.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM public.user_cashback_stats ucs WHERE ucs.user_id = u.id)
ON CONFLICT (user_id) DO UPDATE SET
  total_rides_completed = EXCLUDED.total_rides_completed;

-- Step 3: Find all users who have completed rides but no spin wheel unlocked
-- This creates a temporary table to hold eligible users
CREATE TEMP TABLE IF NOT EXISTS eligible_users AS
SELECT DISTINCT
  r.rider_id,
  ucs.first_ride_bonus_earned,
  ucs.total_rides_completed
FROM public.rides r
LEFT JOIN public.user_cashback_stats ucs ON r.rider_id = ucs.user_id
WHERE r.status = 'completed'
  AND (ucs.first_ride_bonus_earned IS NULL OR ucs.first_ride_bonus_earned = false)
  AND (ucs.total_rides_completed > 0 OR EXISTS (
    SELECT 1 FROM public.rides r2
    WHERE r2.rider_id = r.rider_id
    AND r2.status = 'completed'
  ));

-- Step 4: Backfill spin wheel unlock for all eligible users
DO $$
DECLARE
  user_record RECORD;
  success_count INTEGER := 0;
  total_count INTEGER := 0;
BEGIN
  total_count := (SELECT COUNT(*) FROM eligible_users);

  FOR user_record IN SELECT rider_id FROM eligible_users LOOP
    IF unlock_spin_wheel_for_user(user_record.rider_id) THEN
      success_count := success_count + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Backfill complete: % of % users unlocked spin wheel', success_count, total_count;
END $$;

-- Step 5: Create a notification for users who received the backfilled spin wheel unlock
-- This inserts a notification into the notifications table for each user who just got the unlock
INSERT INTO public.notifications (
  user_id,
  title,
  message,
  type,
  metadata,
  read,
  read_at,
  created_at
)
SELECT
  ucs.user_id,
  '🎰 Spin Wheel Unlocked!' as title,
  'Congratulations! You have unlocked the spin wheel. Spin to win 1-5% off your next ride!' as message,
  'cashback' as type,
  jsonb_build_object(
    'spin_wheel_unlocked', true,
    'deeplink', '/rider/cashback',
    'backfilled', true
  ) as metadata,
  false as read,
  NULL as read_at,
  NOW() as created_at
FROM public.user_cashback_stats ucs
WHERE ucs.first_ride_bonus_earned = true
  AND ucs.updated_at > NOW() - INTERVAL '5 minutes'; -- Only notify for backfills from this run

-- Clean up temp table
DROP TABLE IF EXISTS eligible_users;

-- Step 6: Create a summary view to see the backfill results
CREATE OR REPLACE VIEW spin_wheel_unlock_backfill_summary AS
SELECT
  COUNT(*) as total_users_with_spin_wheel_unlocked,
  COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '5 minutes') as backfilled_users,
  COUNT(*) FILTER (WHERE updated_at <= NOW() - INTERVAL '5 minutes') as naturally_unlocked_users
FROM public.user_cashback_stats
WHERE first_ride_bonus_earned = true;

-- Display summary
SELECT * FROM spin_wheel_unlock_backfill_summary;
