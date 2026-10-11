-- Add metadata column to rides table
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
