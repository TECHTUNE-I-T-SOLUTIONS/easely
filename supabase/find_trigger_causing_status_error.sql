-- Find all functions that might be causing the 'status' column error
-- The error "record 'new' has no field 'status'" suggests a trigger function
-- is trying to access NEW.status when the column is actually 'settlement_status'

-- Search for all functions that reference 'status' in their body
SELECT 
  routine_name,
  routine_type,
  routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_definition ILIKE '%status%';

-- Also check if there are any triggers on related tables that might call functions affecting driver_daily_settlement
SELECT 
  trigger_name,
  event_object_table,
  event_manipulation,
  action_statement,
  action_timing
FROM information_schema.triggers
WHERE action_statement ILIKE '%driver_daily_settlement%';

-- Check the actual column names in driver_daily_settlement
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'driver_daily_settlement'
ORDER BY ordinal_position;
