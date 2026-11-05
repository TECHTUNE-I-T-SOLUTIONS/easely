-- Fix ACTUAL Cashback Notification Triggers
-- This fixes the REAL functions that are being used by the triggers
-- Run this in Supabase SQL Editor to fix the trigger error

-- Drop the actual functions that are being used
DROP FUNCTION IF EXISTS handle_cashback_reward_notification CASCADE;
DROP FUNCTION IF EXISTS handle_cashback_reward_status_update CASCADE;
DROP FUNCTION IF EXISTS handle_cashback_reward_used_notification CASCADE;
DROP FUNCTION IF EXISTS notify_cashback_expiring_soon CASCADE;
DROP FUNCTION IF EXISTS notify_cashback_used CASCADE;
DROP FUNCTION IF EXISTS update_user_cashback_stats CASCADE;

-- Recreate all functions with correct column names (message instead of body)

-- Function to handle cashback reward notification (on insert)
CREATE OR REPLACE FUNCTION handle_cashback_reward_notification()
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

-- Function to handle cashback reward status update
CREATE OR REPLACE FUNCTION handle_cashback_reward_status_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'used' AND OLD.status = 'earned' THEN
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
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to handle cashback reward used notification
CREATE OR REPLACE FUNCTION handle_cashback_reward_used_notification()
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

-- Function to notify when cashback is expiring soon
CREATE OR REPLACE FUNCTION notify_cashback_expiring_soon()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if cashback is expiring within 3 days
  IF NEW.expires_at AND NEW.expires_at <= NOW() + INTERVAL '3 days' AND NEW.status = 'earned' THEN
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
      '⏰ Cashback Expiring Soon',
      'Your ' || NEW.discount_percentage || '% cashback expires in ' || EXTRACT(DAY FROM NEW.expires_at - NOW()) || ' days. Use it before it expires!',
      'cashback',
      'push',
      false,
      jsonb_build_object(
        'rewardId', NEW.id,
        'programId', NEW.program_id,
        'discountPercentage', NEW.discount_percentage,
        'expiresAt', NEW.expires_at
      ),
      NOW(),
      '/rider/cashback',
      'cashback_reward',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to notify when cashback is used
CREATE OR REPLACE FUNCTION notify_cashback_used()
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

-- Function to update user cashback stats
CREATE OR REPLACE FUNCTION update_user_cashback_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- This function updates the user_cashback_stats table
  -- It doesn't create notifications, so no 'body' column issue here
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON FUNCTION handle_cashback_reward_notification() IS 'Creates notification when cashback reward is earned. Uses message column instead of body.';
COMMENT ON FUNCTION handle_cashback_reward_status_update() IS 'Creates notification when cashback reward status changes. Uses message column instead of body.';
COMMENT ON FUNCTION handle_cashback_reward_used_notification() IS 'Creates notification when cashback reward is used. Uses message column instead of body.';
COMMENT ON FUNCTION notify_cashback_expiring_soon() IS 'Creates notification when cashback is expiring soon. Uses message column instead of body.';
COMMENT ON FUNCTION notify_cashback_used() IS 'Creates notification when cashback is used. Uses message column instead of body.';
