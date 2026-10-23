-- Fix driver_daily_settlement triggers
-- The error "record 'new' has no field 'status'" is caused by triggers
-- on driver_daily_settlement calling functions that expect columns from
-- a different table (driver_payments instead of driver_daily_settlement)

-- Step 1: Drop the problematic triggers on driver_daily_settlement
DROP TRIGGER IF EXISTS payment_confirmed_notify_trigger ON public.driver_daily_settlement;
DROP TRIGGER IF EXISTS settlement_overdue_notify_trigger ON public.driver_daily_settlement;

-- Step 2: Recreate the settlement_overdue_notify_trigger with correct function
-- The notify_overdue_settlement function is correct, it just needs to be reattached
CREATE TRIGGER settlement_overdue_notify_trigger
AFTER UPDATE ON public.driver_daily_settlement
FOR EACH ROW
EXECUTE FUNCTION notify_overdue_settlement();

-- Step 3: The payment_confirmed_notify_trigger should NOT be on driver_daily_settlement
-- It should only be on the driver_payments table
-- If you need payment notifications on settlement updates, create a new function

-- Optional: Create a proper payment notification function for driver_daily_settlement
CREATE OR REPLACE FUNCTION notify_settlement_paid()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.settlement_status = 'paid' AND OLD.settlement_status != 'paid' THEN
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
      'Settlement Paid',
      'Your settlement for ' || NEW.settlement_date::text || ' has been marked as paid.',
      'payment',
      'in_app',
      'driver_daily_settlement',
      NEW.id,
      '/driver/payments',
      jsonb_build_object(
        'settlement_id', NEW.id::text,
        'settlement_date', NEW.settlement_date::text,
        'total_platform_fees', NEW.total_platform_fees::text
      )
    FROM drivers d
    WHERE d.id = NEW.driver_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Optional: Add the trigger if you want notifications when settlement is paid
-- CREATE TRIGGER settlement_paid_notify_trigger
-- AFTER UPDATE ON public.driver_daily_settlement
-- FOR EACH ROW
-- EXECUTE FUNCTION notify_settlement_paid();
