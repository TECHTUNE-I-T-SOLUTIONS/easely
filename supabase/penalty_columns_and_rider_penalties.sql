-- Add pending_lateness_penalty column to drivers table
-- This column stores the 10% penalty fee for drivers who fail to arrive within 15 minutes
ALTER TABLE public.drivers
ADD COLUMN IF NOT EXISTS pending_lateness_penalty numeric DEFAULT 0;

-- Add comment to document the purpose
COMMENT ON COLUMN public.drivers.pending_lateness_penalty IS 'Accumulated penalty fee (10% of fare) for drivers who fail to arrive within 15 minutes of accepting a ride. This is added to their next remittance (usual 15% + 10% penalty = 25% total).';

-- Add pending_cancellation_penalty column to users table
-- This column stores the cancellation penalty amount for riders who cancel outside the free window
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS pending_cancellation_penalty numeric DEFAULT 0;

-- Add comment to document the purpose
COMMENT ON COLUMN public.users.pending_cancellation_penalty IS 'Accumulated cancellation penalty (30% of fare) for riders who cancel rides outside the free cancellation window. This is added to their next booking fare.';

-- Create rider_penalties table for tracking penalty history
CREATE TABLE IF NOT EXISTS public.rider_penalties (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ride_id uuid NOT NULL,
  penalty_type character varying(50) NOT NULL DEFAULT 'cancellation',
  penalty_amount numeric NOT NULL,
  penalty_percent numeric NOT NULL,
  ride_fare_amount numeric NOT NULL,
  status character varying(50) NOT NULL DEFAULT 'pending',
  applied_ride_id uuid,
  applied_at timestamp without time zone,
  confirmed_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT rider_penalties_pkey PRIMARY KEY (id),
  CONSTRAINT rider_penalties_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT rider_penalties_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE,
  CONSTRAINT rider_penalties_applied_ride_id_fkey FOREIGN KEY (applied_ride_id) REFERENCES rides(id) ON DELETE SET NULL,
  CONSTRAINT rider_penalties_status_check CHECK (status IN ('pending', 'applied', 'confirmed', 'waived')),
  CONSTRAINT rider_penalties_type_check CHECK (penalty_type IN ('cancellation', 'no_show', 'other'))
);

-- Create indexes for rider_penalties
CREATE INDEX IF NOT EXISTS idx_rider_penalties_user_id ON public.rider_penalties USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_rider_penalties_ride_id ON public.rider_penalties USING btree (ride_id);
CREATE INDEX IF NOT EXISTS idx_rider_penalties_status ON public.rider_penalties USING btree (status);
CREATE INDEX IF NOT EXISTS idx_rider_penalties_type ON public.rider_penalties USING btree (penalty_type);

-- RLS Policies for rider_penalties
ALTER TABLE public.rider_penalties ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own penalties
CREATE POLICY "Users can read own penalties" ON public.rider_penalties
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Allow service role full access
CREATE POLICY "Service role full access to rider_penalties" ON public.rider_penalties
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create driver_penalties table for tracking driver penalty history
CREATE TABLE IF NOT EXISTS public.driver_penalties (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  ride_id uuid NOT NULL,
  penalty_type character varying(50) NOT NULL DEFAULT 'lateness',
  penalty_amount numeric NOT NULL,
  penalty_percent numeric NOT NULL,
  ride_fare_amount numeric NOT NULL,
  status character varying(50) NOT NULL DEFAULT 'pending',
  remittance_id uuid,
  applied_at timestamp without time zone,
  confirmed_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT driver_penalties_pkey PRIMARY KEY (id),
  CONSTRAINT driver_penalties_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
  CONSTRAINT driver_penalties_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE,
  CONSTRAINT driver_penalties_status_check CHECK (status IN ('pending', 'applied', 'confirmed', 'waived')),
  CONSTRAINT driver_penalties_type_check CHECK (penalty_type IN ('lateness', 'no_show', 'cancellation', 'other'))
);

-- Create indexes for driver_penalties
CREATE INDEX IF NOT EXISTS idx_driver_penalties_driver_id ON public.driver_penalties USING btree (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_penalties_ride_id ON public.driver_penalties USING btree (ride_id);
CREATE INDEX IF NOT EXISTS idx_driver_penalties_status ON public.driver_penalties USING btree (status);
CREATE INDEX IF NOT EXISTS idx_driver_penalties_type ON public.driver_penalties USING btree (penalty_type);

-- Add trigger for updated_at
CREATE TRIGGER driver_penalties_updated_at BEFORE UPDATE ON driver_penalties FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS Policies for driver_penalties
ALTER TABLE public.driver_penalties ENABLE ROW LEVEL SECURITY;

-- Allow drivers to read their own penalties
CREATE POLICY "Drivers can read own penalties" ON public.driver_penalties
  FOR SELECT
  TO authenticated
  USING (
    driver_id IN (
      SELECT id FROM public.drivers WHERE user_id = auth.uid()
    )
  );

-- Allow service role full access
CREATE POLICY "Service role full access to driver_penalties" ON public.driver_penalties
  TO service_role
  USING (true)
  WITH CHECK (true);
