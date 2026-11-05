-- Find all functions and triggers referencing the 'body' column in notifications table
-- Run this in Supabase SQL Editor to identify which triggers/functions need to be fixed

-- Find all triggers on user_cashback_rewards table
SELECT 
  t.tgname AS trigger_name,
  pg_get_triggerdef(t.oid) AS trigger_definition
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
WHERE c.relname = 'user_cashback_rewards'
ORDER BY t.tgname;

-- Find all triggers on spin_wheel_results table
SELECT 
  t.tgname AS trigger_name,
  pg_get_triggerdef(t.oid) AS trigger_definition
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
WHERE c.relname = 'spin_wheel_results'
ORDER BY t.tgname;

-- List all functions that could be related to notifications
SELECT 
  p.proname AS function_name,
  n.nspname AS schema_name
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname LIKE '%notify%'
  OR p.proname LIKE '%notification%'
ORDER BY p.proname;
