-- Fix Notifications Trigger Column Error
-- This file fixes notification trigger functions that might be using the wrong column name
-- The notifications table uses 'message' column, not 'body'

-- Step 1: Drop all existing notification trigger functions that might be using wrong column
DROP FUNCTION IF EXISTS notify_cashback_reward_earned CASCADE;
DROP FUNCTION IF EXISTS notify_cashback_reward_used CASCADE;
DROP FUNCTION IF EXISTS notify_spin_wheel_result CASCADE;
DROP FUNCTION IF EXISTS notify_overdue_settlement CASCADE;
DROP FUNCTION IF EXISTS notify_payment_confirmed CASCADE;
DROP FUNCTION IF EXISTS notify_ride_created CASCADE;
DROP FUNCTION IF EXISTS notify_ride_accepted CASCADE;
DROP FUNCTION IF EXISTS notify_ride_completed CASCADE;
DROP FUNCTION IF EXISTS notify_ride_cancelled CASCADE;

-- Step 2: Recreate trigger functions with correct column name (message)

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

-- Function to notify when settlement becomes overdue
CREATE OR REPLACE FUNCTION notify_overdue_settlement()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.settlement_status = 'overdue' AND OLD.settlement_status != 'overdue' THEN
    INSERT INTO notifications (
      user_id,
      title,
      message,
      type,
      channel,
      related_table,
      related_id,
      action_url,
      data
    ) SELECT
      d.user_id,
      'Payment Due',
      'Your settlement fees for ' || NEW.settlement_date::text || ' are now overdue. Please pay to maintain your driver status.',
      'payment',
      'in_app',
      'driver_daily_settlement',
      NEW.id,
      '/driver/payments',
      jsonb_build_object(
        'settlement_id', NEW.id::text,
        'amount_due', NEW.total_platform_fees::text,
        'settlement_date', NEW.settlement_date::text
      )
    FROM drivers d
    WHERE d.id = NEW.driver_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to notify when payment is confirmed
CREATE OR REPLACE FUNCTION notify_payment_confirmed()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    INSERT INTO notifications (
      user_id,
      title,
      message,
      type,
      channel,
      related_table,
      related_id,
      action_url,
      data
    ) SELECT
      d.user_id,
      'Payment Confirmed',
      'Your settlement payment for ' || NEW.settlement_date::text || ' has been confirmed. Amount: ₦' || NEW.amount_paid::text,
      'payment',
      'in_app',
      'driver_daily_settlement',
      NEW.id,
      '/driver/payments',
      jsonb_build_object(
        'settlement_id', NEW.id::text,
        'amount_paid', NEW.amount_paid::text,
        'settlement_date', NEW.settlement_date::text
      )
    FROM drivers d
    WHERE d.id = NEW.driver_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Drop existing triggers
DROP TRIGGER IF EXISTS on_cashback_reward_earned ON user_cashback_rewards;
DROP TRIGGER IF EXISTS on_cashback_reward_used ON user_cashback_rewards;
DROP TRIGGER IF EXISTS on_spin_wheel_result ON spin_wheel_results;
DROP TRIGGER IF EXISTS settlement_overdue_notify_trigger ON driver_daily_settlement;
DROP TRIGGER IF EXISTS payment_confirmed_notify_trigger ON driver_daily_settlement;

-- Step 5: Recreate triggers with fixed functions
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

CREATE TRIGGER settlement_overdue_notify_trigger
AFTER UPDATE ON driver_daily_settlement
FOR EACH ROW
EXECUTE FUNCTION notify_overdue_settlement();

CREATE TRIGGER payment_confirmed_notify_trigger
AFTER UPDATE ON driver_daily_settlement
FOR EACH ROW
EXECUTE FUNCTION notify_payment_confirmed();

-- Step 6: Add comments for documentation
COMMENT ON FUNCTION notify_cashback_reward_earned() IS 'Creates notification when cashback reward is earned. Uses message column.';
COMMENT ON FUNCTION notify_cashback_reward_used() IS 'Creates notification when cashback reward is used. Uses message column.';
COMMENT ON FUNCTION notify_spin_wheel_result() IS 'Creates notification when spin wheel result is won. Uses message column.';
COMMENT ON FUNCTION notify_overdue_settlement() IS 'Creates notification when settlement becomes overdue. Uses message column.';
COMMENT ON FUNCTION notify_payment_confirmed() IS 'Creates notification when payment is confirmed. Uses message column.';
