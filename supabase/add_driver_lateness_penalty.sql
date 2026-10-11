-- Add pending_lateness_penalty column to drivers table
-- This column stores the 10% penalty fee for drivers who fail to arrive within 15 minutes

ALTER TABLE public.drivers
ADD COLUMN IF NOT EXISTS pending_lateness_penalty numeric DEFAULT 0;

-- Add comment to document the purpose
COMMENT ON COLUMN public.drivers.pending_lateness_penalty IS 'Accumulated penalty fee (10% of fare) for drivers who fail to arrive within 15 minutes of accepting a ride. This is added to their next remittance (usual 15% + 10% penalty = 25% total).';
