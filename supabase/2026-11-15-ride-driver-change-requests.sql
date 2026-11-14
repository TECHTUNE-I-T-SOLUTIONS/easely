-- ============================================================================
-- Ride driver change requests ("drop this ride, let another driver take it")
-- ============================================================================
-- A driver who has accepted a ride cannot cancel it. Instead, inside the same
-- free-cancellation window the rider has (5 minutes from acceptance), they may
-- REQUEST that the ride be handed to another driver. The request is broadcast
-- to every other online driver; the first one to accept takes the ride over and
-- everything attributed to the previous driver (remittance, earnings, ride
-- counts) moves with it, because all of that is derived from rides.driver_id.
--
-- Admins can also approve or reject a request directly from the admin app.
--
-- Idempotent and re-runnable.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.ride_driver_change_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL,
  current_driver_id uuid NOT NULL,
  requested_by_user_id uuid,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'accepted', 'cancelled', 'expired', 'rejected', 'admin_reassigned')),
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  -- The request dies when the rider's free-cancellation window closes.
  expires_at timestamp with time zone NOT NULL,
  accepted_by_driver_id uuid,
  accepted_at timestamp with time zone,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  admin_note text,
  broadcast_count integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ride_driver_change_requests_pkey PRIMARY KEY (id),
  CONSTRAINT ride_driver_change_requests_ride_id_fkey
    FOREIGN KEY (ride_id) REFERENCES public.rides(id) ON DELETE CASCADE,
  CONSTRAINT ride_driver_change_requests_current_driver_id_fkey
    FOREIGN KEY (current_driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE,
  CONSTRAINT ride_driver_change_requests_accepted_by_driver_id_fkey
    FOREIGN KEY (accepted_by_driver_id) REFERENCES public.drivers(id) ON DELETE SET NULL,
  CONSTRAINT ride_driver_change_requests_requested_by_user_id_fkey
    FOREIGN KEY (requested_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT ride_driver_change_requests_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL
);

-- Only one live request per ride. A partial unique index lets a ride be
-- re-requested later (after a rejection or expiry) without tripping the rule.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ride_driver_change_requests_one_open
  ON public.ride_driver_change_requests (ride_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_ride_driver_change_requests_status
  ON public.ride_driver_change_requests (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_ride_driver_change_requests_driver
  ON public.ride_driver_change_requests (current_driver_id, requested_at DESC);

ALTER TABLE public.ride_driver_change_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Drivers can read open change requests" ON public.ride_driver_change_requests;
CREATE POLICY "Drivers can read open change requests" ON public.ride_driver_change_requests
  FOR SELECT
  TO authenticated
  USING (
    status = 'open'
    OR current_driver_id IN (SELECT d.id FROM public.drivers d WHERE d.user_id = auth.uid())
    OR accepted_by_driver_id IN (SELECT d.id FROM public.drivers d WHERE d.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Service role full access to ride_driver_change_requests" ON public.ride_driver_change_requests;
CREATE POLICY "Service role full access to ride_driver_change_requests" ON public.ride_driver_change_requests
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Keep updated_at fresh.
CREATE OR REPLACE FUNCTION public.touch_ride_driver_change_requests_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ride_driver_change_requests_updated_at ON public.ride_driver_change_requests;
CREATE TRIGGER ride_driver_change_requests_updated_at
  BEFORE UPDATE ON public.ride_driver_change_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_ride_driver_change_requests_updated_at();

-- Expire stale requests so the driver home modal never shows a dead one.
CREATE OR REPLACE FUNCTION public.expire_stale_ride_driver_change_requests()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.ride_driver_change_requests
  SET status = 'expired', updated_at = now()
  WHERE status = 'open'
    AND expires_at < now();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

COMMIT;
