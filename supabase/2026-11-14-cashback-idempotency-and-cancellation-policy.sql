-- ============================================================================
-- 2026-11-14
-- 1. Make the first-ride cashback bonus strictly one-per-rider
-- 2. Track driver-initiated cancellations and lock repeat offenders for review
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. FIRST RIDE BONUS — one per rider, forever
-- ----------------------------------------------------------------------------
-- The API now checks any existing first_ride reward (earned/used/expired) before
-- inserting. This trigger closes the remaining race window: even two concurrent
-- requests can only ever create a single first_ride reward per rider.
CREATE OR REPLACE FUNCTION public.enforce_single_first_ride_reward()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_program_type text;
  v_existing_id uuid;
BEGIN
  SELECT program_type INTO v_program_type
  FROM public.cashback_programs
  WHERE id = NEW.program_id;

  IF v_program_type IS DISTINCT FROM 'first_ride' THEN
    RETURN NEW;
  END IF;

  SELECT r.id INTO v_existing_id
  FROM public.user_cashback_rewards r
  JOIN public.cashback_programs p ON p.id = r.program_id
  WHERE r.user_id = NEW.user_id
    AND p.program_type = 'first_ride'
    AND r.id <> NEW.id
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'first_ride_bonus_already_claimed'
      USING ERRCODE = 'unique_violation',
            DETAIL = format('Rider %s already has first ride reward %s', NEW.user_id, v_existing_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_single_first_ride_reward ON public.user_cashback_rewards;
CREATE TRIGGER enforce_single_first_ride_reward
  BEFORE INSERT ON public.user_cashback_rewards
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_single_first_ride_reward();

-- Helpful index for the idempotency lookups the API performs on every open.
CREATE INDEX IF NOT EXISTS idx_user_cashback_rewards_user_earned_at
  ON public.user_cashback_rewards (user_id, earned_at DESC);

-- ----------------------------------------------------------------------------
-- 2. RIDER CANCELLATIONS AGAINST A DRIVER + INVESTIGATION QUEUE
-- ----------------------------------------------------------------------------

-- Drivers CANNOT cancel a ride they have accepted (the API refuses it outright).
-- What this table records is the reverse: an already-accepted ride that a RIDER
-- cancelled. One row per ride, so a cancellation can never be counted twice.
-- day_key is the Lagos calendar day, used for the "more than twice in a day"
-- rule without doing timezone arithmetic at query time.
CREATE TABLE IF NOT EXISTS public.driver_ride_cancellations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  ride_id uuid NOT NULL,
  rider_id uuid,
  day_key date NOT NULL DEFAULT ((now() AT TIME ZONE 'Africa/Lagos')::date),
  cancelled_by text NOT NULL DEFAULT 'rider'
    CHECK (cancelled_by IN ('rider', 'admin', 'system')),
  ride_status_at_cancel text,
  reason text,
  fee_charged numeric NOT NULL DEFAULT 0,
  cancelled_at timestamp with time zone NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT driver_ride_cancellations_pkey PRIMARY KEY (id),
  CONSTRAINT driver_ride_cancellations_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE,
  CONSTRAINT driver_ride_cancellations_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES public.rides(id) ON DELETE CASCADE,
  CONSTRAINT driver_ride_cancellations_rider_id_fkey FOREIGN KEY (rider_id) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT driver_ride_cancellations_ride_unique UNIQUE (ride_id)
);

CREATE INDEX IF NOT EXISTS idx_driver_ride_cancellations_driver_day
  ON public.driver_ride_cancellations (driver_id, day_key, cancelled_by);

CREATE INDEX IF NOT EXISTS idx_driver_ride_cancellations_ride
  ON public.driver_ride_cancellations (ride_id);

ALTER TABLE public.driver_ride_cancellations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Drivers can read own ride cancellations" ON public.driver_ride_cancellations;
CREATE POLICY "Drivers can read own ride cancellations" ON public.driver_ride_cancellations
  FOR SELECT
  TO authenticated
  USING (
    driver_id IN (SELECT d.id FROM public.drivers d WHERE d.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Service role full access to driver_ride_cancellations" ON public.driver_ride_cancellations;
CREATE POLICY "Service role full access to driver_ride_cancellations" ON public.driver_ride_cancellations
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Lock state on the driver record. `active` = normal, `under_review` = held
-- pending an admin decision, `suspended` = admin took action. Only an admin
-- sets these; the automatic rider-cancellation flag never does.
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS lock_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS locked_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS lock_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drivers_lock_status_check'
  ) THEN
    ALTER TABLE public.drivers
      ADD CONSTRAINT drivers_lock_status_check
      CHECK (lock_status IN ('active', 'under_review', 'suspended'));
  END IF;
END;
$$;

-- Admin investigation queue. Opened automatically when a driver loses more than
-- DRIVER_DAILY_CANCEL_LIMIT (2) accepted rides to rider cancellations in one
-- Lagos day. Being flagged does NOT take the driver offline: a rider cancelling
-- is not the driver's fault, so this only asks a human to look. An admin can
-- then clear the case, set a fine, or suspend the account.
CREATE TABLE IF NOT EXISTS public.driver_investigations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  user_id uuid,
  day_key date NOT NULL DEFAULT ((now() AT TIME ZONE 'Africa/Lagos')::date),
  trigger_reason text NOT NULL DEFAULT 'rider_cancellations_exceeded_threshold',
  cancellation_count integer NOT NULL DEFAULT 0,
  threshold integer NOT NULL DEFAULT 2,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewing', 'cleared', 'fined', 'suspended')),
  fine_amount numeric NOT NULL DEFAULT 0,
  suspension_days integer,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  decision_note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT driver_investigations_pkey PRIMARY KEY (id),
  CONSTRAINT driver_investigations_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE,
  CONSTRAINT driver_investigations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT driver_investigations_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT driver_investigations_driver_day_unique UNIQUE (driver_id, day_key)
);

CREATE INDEX IF NOT EXISTS idx_driver_investigations_driver
  ON public.driver_investigations (driver_id, day_key DESC);
CREATE INDEX IF NOT EXISTS idx_driver_investigations_status
  ON public.driver_investigations (status);

ALTER TABLE public.driver_investigations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Drivers can read own investigations" ON public.driver_investigations;
CREATE POLICY "Drivers can read own investigations" ON public.driver_investigations
  FOR SELECT
  TO authenticated
  USING (
    driver_id IN (SELECT d.id FROM public.drivers d WHERE d.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Service role full access to driver_investigations" ON public.driver_investigations;
CREATE POLICY "Service role full access to driver_investigations" ON public.driver_investigations
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Keep updated_at fresh on the investigation rows.
CREATE OR REPLACE FUNCTION public.touch_driver_investigations_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS driver_investigations_updated_at ON public.driver_investigations;
CREATE TRIGGER driver_investigations_updated_at
  BEFORE UPDATE ON public.driver_investigations
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_driver_investigations_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Backfill: collapse any duplicate first_ride rewards down to the earliest one
--    (keeps history honest and prevents the trigger from tripping later).
-- ----------------------------------------------------------------------------
WITH ranked AS (
  SELECT r.id,
         ROW_NUMBER() OVER (PARTITION BY r.user_id ORDER BY r.earned_at ASC, r.id ASC) AS rn
  FROM public.user_cashback_rewards r
  JOIN public.cashback_programs p ON p.id = r.program_id
  WHERE p.program_type = 'first_ride'
    AND r.status NOT IN ('cancelled', 'expired')
)
-- 'expired' (not a new status value) keeps this compatible with whatever CHECK
-- constraint the rewards table already enforces in production.
UPDATE public.user_cashback_rewards r
SET status = 'expired',
    updated_at = now(),
    metadata = COALESCE(r.metadata, '{}'::jsonb) || jsonb_build_object(
      'duplicate_first_ride_bonus', true,
      'cancelled_reason', 'duplicate_first_ride_bonus_cleanup'
    )
FROM ranked
WHERE r.id = ranked.id
  AND ranked.rn > 1;

COMMIT;
