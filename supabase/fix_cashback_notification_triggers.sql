-- Fix Cashback Notification Triggers
-- This file fixes the notification column name from 'body' to 'message' in all cashback-related triggers

-- Drop existing trigger functions
DROP FUNCTION IF EXISTS notify_cashback_reward_earned CASCADE;
DROP FUNCTION IF EXISTS notify_cashback_reward_used CASCADE;
DROP FUNCTION IF EXISTS notify_spin_wheel_result CASCADE;

-- Recreate trigger functions with correct column names (message instead of body)

-- Function to notify when cashback reward is earned
CREATE OR REPLACE FUNCTION notify_cashback_reward_earned()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO notifications (
    user_id,
    title,
    message,
    type,
    channel,
    read,
    data,
    created_at,
    deeplink,
    entity_type,
    entity_id
  )
  VALUES (
    NEW.user_id,
    '💰 Cashback Reward Earned!',
    'You earned ' || NEW.discount_percentage || '% cashback. Use it on your next ride!',
    'cashback',
    'push',
    false,
    jsonb_build_object(
      'rewardId', NEW.id,
      'programId', NEW.program_id,
      'discountPercentage', NEW.discount_percentage,
      'discountAmount', NEW.discount_amount,
      'expiresAt', NEW.expires_at
    ),
    NOW(),
    '/rider/cashback',
    'cashback_reward',
    NEW.id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to notify when cashback reward is used
CREATE OR REPLACE FUNCTION notify_cashback_reward_used()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO notifications (
    user_id,
    title,
    message,
    type,
    channel,
    read,
    data,
    created_at,
    deeplink,
    entity_type,
    entity_id
  )
  VALUES (
    NEW.user_id,
    '✅ Cashback Applied',
    'Your ' || NEW.discount_percentage || '% cashback has been applied to your ride. You saved ₦' || NEW.discount_amount || '!',
    'cashback',
    'push',
    false,
    jsonb_build_object(
      'rewardId', NEW.id,
      'programId', NEW.program_id,
      'discountPercentage', NEW.discount_percentage,
      'discountAmount', NEW.discount_amount,
      'rideId', NEW.ride_id
    ),
    NOW(),
    '/rider/rides-history',
    'cashback_reward',
    NEW.id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to notify when spin wheel result is created
CREATE OR REPLACE FUNCTION notify_spin_wheel_result()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'won' AND NEW.discount_percentage > 0 THEN
    INSERT INTO notifications (
      user_id,
      title,
      message,
      type,
      channel,
      read,
      data,
      created_at,
      deeplink,
      entity_type,
      entity_id
    )
    VALUES (
      NEW.user_id,
      '🎰 Spin Wheel Result!',
      'You won ' || NEW.discount_percentage || '% off your next ride! Check your cashback rewards.',
      'cashback',
      'push',
      false,
      jsonb_build_object(
        'spinResultId', NEW.id,
        'programId', NEW.program_id,
        'discountPercentage', NEW.discount_percentage,
        'displayedResult', NEW.displayed_result
      ),
      NOW(),
      '/rider/cashback',
      'spin_wheel_result',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing triggers on tables
DROP TRIGGER IF EXISTS on_cashback_reward_earned ON user_cashback_rewards;
DROP TRIGGER IF EXISTS on_cashback_reward_used ON user_cashback_rewards;
DROP TRIGGER IF EXISTS on_spin_wheel_result ON spin_wheel_results;

-- Recreate triggers with fixed functions
CREATE TRIGGER on_cashback_reward_earned
  AFTER INSERT ON user_cashback_rewards
  FOR EACH ROW
  EXECUTE FUNCTION notify_cashback_reward_earned();

CREATE TRIGGER on_cashback_reward_used
  AFTER UPDATE ON user_cashback_rewards
  FOR EACH ROW
  WHEN (OLD.status = 'earned' AND NEW.status = 'used')
  EXECUTE FUNCTION notify_cashback_reward_used();

CREATE TRIGGER on_spin_wheel_result
  AFTER INSERT ON spin_wheel_results
  FOR EACH ROW
  EXECUTE FUNCTION notify_spin_wheel_result();

-- Add comment for documentation
COMMENT ON FUNCTION notify_cashback_reward_earned() IS 'Creates notification when cashback reward is earned. Uses message column instead of body.';
COMMENT ON FUNCTION notify_cashback_reward_used() IS 'Creates notification when cashback reward is used. Uses message column instead of body.';
COMMENT ON FUNCTION notify_spin_wheel_result() IS 'Creates notification when spin wheel result is won. Uses message column instead of body.';
