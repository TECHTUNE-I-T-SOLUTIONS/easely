-- Keep driver availability in sync with remittance policy:
-- - Today's pending remittance should only show reminders/countdown.
-- - Driver availability is forced offline only when a settlement is overdue.
-- - Paying overdue remittance allows auto-online unless the driver manually switched off.

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS manual_availability_off boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.drivers.manual_availability_off IS
  'True when the driver deliberately switches availability off. Auto-online may only run when this is false and no overdue remittance exists.';

CREATE OR REPLACE FUNCTION public.driver_settlement_availability_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.settlement_status = 'overdue'
     OR (
       NEW.settlement_status = 'pending'
       AND NEW.payment_due_date IS NOT NULL
       AND NEW.payment_due_date <= now()
     )
  THEN
    UPDATE public.drivers
    SET availability_status = 'offline',
        updated_at = now()
    WHERE id = NEW.driver_id
      AND availability_status <> 'offline';
  END IF;

  RETURN NEW;
END;
$$;

-- The API uses manual_availability_off to preserve a driver's deliberate offline
-- choice while still auto-restoring availability when overdue remittance is clear.
