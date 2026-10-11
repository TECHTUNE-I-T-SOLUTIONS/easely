-- Add driver location tracking column
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS last_known_location jsonb DEFAULT NULL;

-- Add index for faster queries on driver location
CREATE INDEX IF NOT EXISTS idx_drivers_last_location ON public.drivers USING GIN (last_known_location jsonb_path_ops);
