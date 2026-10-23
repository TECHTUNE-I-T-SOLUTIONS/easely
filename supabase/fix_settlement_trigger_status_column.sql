-- Fix database trigger error: record "new" has no field "status"
-- This error occurs when a trigger on driver_daily_settlement references a non-existent 'status' column
-- The correct column name is 'settlement_status'

-- First, let's check for any triggers on driver_daily_settlement
SELECT 
  trigger_name,
  event_manipulation,
  action_statement,
  action_timing
FROM information_schema.triggers
WHERE event_object_table = 'driver_daily_settlement';

-- If you find triggers referencing 'status' instead of 'settlement_status', drop them
-- Example (uncomment if needed):
-- DROP TRIGGER IF EXISTS trigger_name ON driver_daily_settlement;

-- After fixing triggers, verify the table has the correct columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'driver_daily_settlement'
ORDER BY ordinal_position;
