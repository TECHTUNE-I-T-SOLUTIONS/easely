-- Comprehensive Fix for All Notification Triggers
-- This will drop and recreate ALL notification-related triggers to use 'message' instead of 'body'
-- Run this in Supabase SQL Editor to fix all trigger issues at once

-- Step 1: Drop all existing notification-related trigger functions
DROP FUNCTION IF EXISTS notify_cashback_reward_earned CASCADE;
DROP FUNCTION IF EXISTS notify_cashback_reward_used CASCADE;
DROP FUNCTION IF EXISTS notify_spin_wheel_result CASCADE;
DROP FUNCTION IF EXISTS notify_new_ride CASCADE;
DROP FUNCTION IF EXISTS notify_ride_status_change CASCADE;
DROP FUNCTION IF EXISTS notify_ride_completed CASCADE;
DROP FUNCTION IF EXISTS notify_ride_cancelled CASCADE;
DROP FUNCTION IF EXISTS notify_driver_rating CASCADE;
DROP FUNCTION IF EXISTS notify_driver_assigned CASCADE;
DROP FUNCTION IF EXISTS notify_ride_dispatched CASCADE;

-- Step 2: Recreate all trigger functions with correct column names (message instead of body)

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

-- Step 3: Drop all existing triggers on the tables
DROP TRIGGER IF EXISTS on_cashback_reward_earned ON user_cashback_rewards;
DROP TRIGGER IF EXISTS on_cashback_reward_used ON user_cashback_rewards;
DROP TRIGGER IF EXISTS on_spin_wheel_result ON spin_wheel_results;
DROP TRIGGER IF EXISTS on_new_ride ON rides;
DROP TRIGGER IF EXISTS on_ride_status_change ON rides;
DROP TRIGGER IF EXISTS on_ride_completed ON rides;
DROP TRIGGER IF EXISTS on_ride_cancelled ON rides;
DROP TRIGGER IF EXISTS on_driver_rating ON rides;
DROP TRIGGER IF EXISTS on_driver_assigned ON rides;
DROP TRIGGER IF EXISTS on_ride_dispatched ON rides;

-- Step 4: Recreate triggers with fixed functions
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

-- Add comments for documentation
COMMENT ON FUNCTION notify_cashback_reward_earned() IS 'Creates notification when cashback reward is earned. Uses message column instead of body.';
COMMENT ON FUNCTION notify_cashback_reward_used() IS 'Creates notification when cashback reward is used. Uses message column instead of body.';
COMMENT ON FUNCTION notify_spin_wheel_result() IS 'Creates notification when spin wheel result is won. Uses message column instead of body.';
