-- Migration: Fix Notification Column Names in Cashback Functions
-- This migration updates the cashback notification functions to use the correct column names
-- Changed: 'body' -> 'message', added 'read' boolean column

-- Step 1: Drop existing triggers and functions
DROP TRIGGER IF EXISTS notify_cashback_reward_earned ON public.user_cashback_rewards;
DROP TRIGGER IF EXISTS notify_cashback_reward_used ON public.user_cashback_rewards;
DROP TRIGGER IF EXISTS notify_cashback_reward_updated ON public.user_cashback_rewards;
DROP FUNCTION IF EXISTS handle_cashback_reward_notification();
DROP FUNCTION IF EXISTS handle_cashback_reward_used_notification();
DROP FUNCTION IF EXISTS handle_cashback_reward_status_update();

-- Step 2: Recreate function for cashback reward earned notification
CREATE OR REPLACE FUNCTION handle_cashback_reward_notification()
RETURNS TRIGGER AS $$
DECLARE
  notification_title TEXT;
  notification_body TEXT;
BEGIN
  notification_title := CASE
    WHEN NEW.discount_percentage = 10 THEN '🎉 First Ride Bonus Earned!'
    ELSE '💰 Cashback Reward Earned!'
  END;

  notification_body := CASE
    WHEN NEW.discount_percentage = 10 THEN 'Congratulations! You earned 10% off your first ride. Use it on your next booking!'
    ELSE 'You earned ' || NEW.discount_percentage || '% cashback. Use it on your next ride!'
  END;

  INSERT INTO public.notifications (
    user_id,
    title,
    message,
    type,
    metadata,
    read,
    read_at,
    created_at
  ) VALUES (
    NEW.user_id,
    notification_title,
    notification_body,
    'cashback',
    jsonb_build_object(
      'reward_id', NEW.id,
      'program_id', NEW.program_id,
      'discount_percentage', NEW.discount_percentage,
      'discount_amount', NEW.discount_amount,
      'expires_at', NEW.expires_at,
      'deeplink', '/rider/cashback'
    ),
    false,
    NULL,
    NOW()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Recreate function for cashback reward used notification
CREATE OR REPLACE FUNCTION handle_cashback_reward_used_notification()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert notification when cashback is used
  IF OLD.status = 'earned' AND NEW.status = 'used' THEN
    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      type,
      metadata,
      read,
      read_at,
      created_at
    ) VALUES (
      NEW.user_id,
      '✅ Cashback Applied',
      'Your ' || NEW.discount_percentage || '% cashback has been applied to your ride. You saved ₦' || NEW.discount_amount || '!',
      'cashback',
      jsonb_build_object(
        'reward_id', NEW.id,
        'program_id', NEW.program_id,
        'discount_percentage', NEW.discount_percentage,
        'discount_amount', NEW.discount_amount,
        'ride_id', NEW.ride_id,
        'deeplink', '/rider/rides-history'
      ),
      false,
      NULL,
      NOW()
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Recreate function for cashback reward status update (expired only)
CREATE OR REPLACE FUNCTION handle_cashback_reward_status_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Handle expired cashback (when manually marked as expired)
  IF NEW.status = 'expired' AND OLD.status = 'earned' THEN
    -- Insert notification
    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      type,
      metadata,
      read,
      read_at,
      created_at
    ) VALUES (
      NEW.user_id,
      '⚠️ Cashback Expired',
      'Your ' || NEW.discount_percentage || '% cashback reward has expired. Complete more rides to earn new rewards!',
      'cashback',
      jsonb_build_object(
        'reward_id', NEW.id,
        'program_id', NEW.program_id,
        'discount_percentage', NEW.discount_percentage,
        'deeplink', '/rider/cashback'
      ),
      false,
      NULL,
      NOW()
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Recreate triggers
CREATE TRIGGER notify_cashback_reward_earned
AFTER INSERT ON public.user_cashback_rewards
FOR EACH ROW
EXECUTE FUNCTION handle_cashback_reward_notification();

CREATE TRIGGER notify_cashback_reward_used
AFTER UPDATE ON public.user_cashback_rewards
FOR EACH ROW
EXECUTE FUNCTION handle_cashback_reward_used_notification();

CREATE TRIGGER notify_cashback_reward_updated
AFTER UPDATE ON public.user_cashback_rewards
FOR EACH ROW
EXECUTE FUNCTION handle_cashback_reward_status_update();

-- Step 6: Create function to check and mark expired cashback for a specific user
-- This will be called from the API when the user loads the cashback screen
CREATE OR REPLACE FUNCTION check_and_mark_expired_cashback(p_user_id uuid)
RETURNS void AS $$
DECLARE
  reward RECORD;
BEGIN
  -- Mark expired rewards for this user
  FOR reward IN
    SELECT id, user_id, discount_percentage
    FROM public.user_cashback_rewards
    WHERE user_id = p_user_id
    AND status = 'earned'
    AND expires_at < now()
  LOOP
    UPDATE public.user_cashback_rewards
    SET status = 'expired', updated_at = now()
    WHERE id = reward.id;

    -- Insert notification
    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      type,
      metadata,
      read,
      read_at,
      created_at
    ) VALUES (
      reward.user_id,
      '⚠️ Cashback Expired',
      'Your ' || reward.discount_percentage || '% cashback reward has expired. Complete more rides to earn new rewards!',
      'cashback',
      jsonb_build_object(
        'reward_id', reward.id,
        'discount_percentage', reward.discount_percentage,
        'deeplink', '/rider/cashback'
      ),
      false,
      NULL,
      NOW()
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_and_mark_expired_cashback IS 'Function to check and mark expired cashback for a specific user. Called from API when user loads cashback screen.';

-- Success message
SELECT '✅ Notification column names fixed and cron jobs removed. Expiry check now runs on API call.' as status;
