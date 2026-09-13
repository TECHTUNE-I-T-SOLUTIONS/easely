-- Migration for Dynamic Base Fare and Cashback System
-- This migration adds tables for the new cashback program and ensures dynamic base fare functionality

-- 1. Update pricing_settings table to ensure it's properly configured for dynamic base fare
-- Note: The pricing_settings table already exists with base_fare field, but we'll add some enhancements

-- Add currency field to pricing_settings if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'pricing_settings' AND column_name = 'currency'
    ) THEN
        ALTER TABLE public.pricing_settings ADD COLUMN currency character varying DEFAULT 'NGN';
    END IF;
END $$;

-- Add effective date fields for fare changes
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'pricing_settings' AND column_name = 'effective_from'
    ) THEN
        ALTER TABLE public.pricing_settings ADD COLUMN effective_from timestamp with time zone DEFAULT now();
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'pricing_settings' AND column_name = 'effective_until'
    ) THEN
        ALTER TABLE public.pricing_settings ADD COLUMN effective_until timestamp with time zone;
    END IF;
END $$;

-- 2. Create cashback program tables

-- Cashback programs configuration table
CREATE TABLE IF NOT EXISTS public.cashback_programs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name character varying NOT NULL,
  description text,
  program_type character varying NOT NULL CHECK (program_type IN ('first_ride', 'spin_wheel', 'referral', 'special')),
  discount_percentage numeric NOT NULL CHECK (discount_percentage > 0 AND discount_percentage <= 100),
  max_discount_amount numeric,
  min_order_amount numeric DEFAULT 0,
  valid_after_rides integer DEFAULT 0,
  valid_for_rides_count integer DEFAULT 1,
  expiry_days integer,
  is_active boolean NOT NULL DEFAULT true,
  priority integer DEFAULT 0,
  start_date timestamp with time zone,
  end_date timestamp with time zone,
  terms text,
  image_url text,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT cashback_programs_pkey PRIMARY KEY (id),
  CONSTRAINT cashback_programs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id),
  CONSTRAINT cashback_programs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id)
);

-- User cashback rewards table
CREATE TABLE IF NOT EXISTS public.user_cashback_rewards (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  program_id uuid NOT NULL,
  ride_id uuid,
  discount_percentage numeric NOT NULL,
  discount_amount numeric NOT NULL,
  original_fare_amount numeric NOT NULL,
  final_fare_amount numeric NOT NULL,
  status character varying NOT NULL DEFAULT 'earned' CHECK (status IN ('earned', 'used', 'expired', 'cancelled')),
  earned_at timestamp with time zone DEFAULT now(),
  used_at timestamp with time zone,
  expires_at timestamp with time zone,
  related_ride_id uuid,
  metadata jsonb DEFAULT '{}',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_cashback_rewards_pkey PRIMARY KEY (id),
  CONSTRAINT user_cashback_rewards_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT user_cashback_rewards_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.cashback_programs(id),
  CONSTRAINT user_cashback_rewards_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES public.rides(id),
  CONSTRAINT user_cashback_rewards_related_ride_id_fkey FOREIGN KEY (related_ride_id) REFERENCES public.rides(id)
);

-- Spin wheel results table
-- Updated: Removed free_ride, only 1-5% actual payouts but wheel shows up to 10%
CREATE TABLE IF NOT EXISTS public.spin_wheel_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  program_id uuid NOT NULL,
  spin_result character varying NOT NULL CHECK (spin_result IN ('1_percent', '2_percent', '3_percent', '4_percent', '5_percent', 'try_again')),
  displayed_result character varying NOT NULL CHECK (displayed_result IN ('1_percent', '2_percent', '3_percent', '4_percent', '5_percent', '6_percent', '7_percent', '8_percent', '9_percent', '10_percent', 'try_again')),
  discount_percentage numeric NOT NULL CHECK (discount_percentage >= 1 AND discount_percentage <= 5),
  discount_amount numeric,
  status character varying NOT NULL DEFAULT 'won' CHECK (status IN ('won', 'used', 'expired', 'cancelled')),
  won_at timestamp with time zone DEFAULT now(),
  used_at timestamp with time zone,
  expires_at timestamp with time zone,
  ride_id uuid,
  metadata jsonb DEFAULT '{}',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT spin_wheel_results_pkey PRIMARY KEY (id),
  CONSTRAINT spin_wheel_results_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT spin_wheel_results_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.cashback_programs(id),
  CONSTRAINT spin_wheel_results_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES public.rides(id)
);

-- User cashback statistics table
CREATE TABLE IF NOT EXISTS public.user_cashback_stats (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  total_rides_completed integer DEFAULT 0,
  total_cashback_earned numeric DEFAULT 0,
  total_cashback_used numeric DEFAULT 0,
  available_cashback_balance numeric DEFAULT 0,
  first_ride_bonus_earned boolean DEFAULT false,
  spin_wheel_plays_count integer DEFAULT 0,
  last_cashback_earned_at timestamp with time zone,
  last_spin_wheel_play_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_cashback_stats_pkey PRIMARY KEY (id),
  CONSTRAINT user_cashback_stats_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

-- 3. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_cashback_rewards_user_id ON public.user_cashback_rewards(user_id);
CREATE INDEX IF NOT EXISTS idx_user_cashback_rewards_status ON public.user_cashback_rewards(status);
CREATE INDEX IF NOT EXISTS idx_user_cashback_rewards_expires_at ON public.user_cashback_rewards(expires_at);
CREATE INDEX IF NOT EXISTS idx_spin_wheel_results_user_id ON public.spin_wheel_results(user_id);
CREATE INDEX IF NOT EXISTS idx_spin_wheel_results_status ON public.spin_wheel_results(status);
CREATE INDEX IF NOT EXISTS idx_cashback_programs_is_active ON public.cashback_programs(is_active);
CREATE INDEX IF NOT EXISTS idx_cashback_programs_program_type ON public.cashback_programs(program_type);

-- 4. Insert default cashback programs
INSERT INTO public.cashback_programs (name, description, program_type, discount_percentage, max_discount_amount, min_order_amount, valid_after_rides, valid_for_rides_count, expiry_days, is_active, priority, start_date) 
VALUES 
  ('First Ride Bonus', 'Get 10% off your first ride', 'first_ride', 10, 500, 0, 0, 1, 30, true, 1, now()),
  ('Spin Wheel Reward', 'Spin the wheel to win 1-5% off your next ride (only playable once)', 'spin_wheel', 5, 300, 0, 1, 1, 7, true, 2, now())
ON CONFLICT DO NOTHING;

-- 5. Create trigger to update user_cashback_stats
CREATE OR REPLACE FUNCTION update_user_cashback_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.user_cashback_stats (user_id, total_cashback_earned, available_cashback_balance, last_cashback_earned_at)
    VALUES (NEW.user_id, NEW.discount_amount, NEW.discount_amount, NEW.earned_at)
    ON CONFLICT (user_id) DO UPDATE SET
      total_cashback_earned = user_cashback_stats.total_cashback_earned + NEW.discount_amount,
      available_cashback_balance = user_cashback_stats.available_cashback_balance + NEW.discount_amount,
      last_cashback_earned_at = NEW.earned_at,
      updated_at = now();
    
    IF NEW.program_id IN (SELECT id FROM public.cashback_programs WHERE program_type = 'first_ride') THEN
      UPDATE public.user_cashback_stats SET first_ride_bonus_earned = true WHERE user_id = NEW.user_id;
    END IF;
    
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'earned' AND NEW.status = 'used' THEN
    UPDATE public.user_cashback_stats SET
      total_cashback_used = user_cashback_stats.total_cashback_used + NEW.discount_amount,
      available_cashback_balance = user_cashback_stats.available_cashback_balance - NEW.discount_amount,
      updated_at = now()
    WHERE user_id = NEW.user_id;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_user_cashback_stats ON public.user_cashback_rewards;
CREATE TRIGGER trigger_update_user_cashback_stats
AFTER INSERT OR UPDATE ON public.user_cashback_rewards
FOR EACH ROW EXECUTE FUNCTION update_user_cashback_stats();

-- 6. Create trigger to update ride count in user_cashback_stats
CREATE OR REPLACE FUNCTION update_ride_count_for_cashback()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    INSERT INTO public.user_cashback_stats (user_id, total_rides_completed)
    VALUES (NEW.rider_id, 1)
    ON CONFLICT (user_id) DO UPDATE SET
      total_rides_completed = user_cashback_stats.total_rides_completed + 1,
      updated_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_ride_count_for_cashback ON public.rides;
CREATE TRIGGER trigger_update_ride_count_for_cashback
AFTER UPDATE ON public.rides
FOR EACH ROW EXECUTE FUNCTION update_ride_count_for_cashback();

-- 7. Add RLS policies
ALTER TABLE public.cashback_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_cashback_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spin_wheel_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_cashback_stats ENABLE ROW LEVEL SECURITY;

-- Policy for cashback_programs - admins can read, super admins can write
CREATE POLICY "Admins can view cashback programs" ON public.cashback_programs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.admins 
      WHERE admins.user_id = auth.uid() 
      AND admins.admin_level IN ('super', 'ops', 'finance')
    )
    OR
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE users.id = auth.uid() 
      AND users.role = 'super_admin'
    )
  );

CREATE POLICY "Super admins can modify cashback programs" ON public.cashback_programs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.admins 
      WHERE admins.user_id = auth.uid() 
      AND admins.admin_level = 'super'
    )
    OR
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE users.id = auth.uid() 
      AND users.role = 'super_admin'
    )
  );

-- Policy for user_cashback_rewards - users can only see their own
CREATE POLICY "Users can view own cashback rewards" ON public.user_cashback_rewards
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admins can view all cashback rewards" ON public.user_cashback_rewards
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.admins 
      WHERE admins.user_id = auth.uid()
    )
  );

-- Policy for spin_wheel_results - users can only see their own
CREATE POLICY "Users can view own spin wheel results" ON public.spin_wheel_results
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admins can view all spin wheel results" ON public.spin_wheel_results
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.admins 
      WHERE admins.user_id = auth.uid()
    )
  );

-- Policy for user_cashback_stats - users can only see their own
CREATE POLICY "Users can view own cashback stats" ON public.user_cashback_stats
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admins can view all cashback stats" ON public.user_cashback_stats
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.admins 
      WHERE admins.user_id = auth.uid()
    )
  );

-- 8. Create view for active cashback programs
CREATE OR REPLACE VIEW active_cashback_programs AS
SELECT * FROM public.cashback_programs
WHERE is_active = true
AND (start_date IS NULL OR start_date <= now())
AND (end_date IS NULL OR end_date > now());

-- 9. Create function to get available cashback for user
CREATE OR REPLACE FUNCTION get_user_available_cashback(p_user_id uuid)
RETURNS TABLE (
  reward_id uuid,
  program_id uuid,
  program_name character varying,
  program_type character varying,
  discount_percentage numeric,
  discount_amount numeric,
  expires_at timestamp with time zone
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ucr.id as reward_id,
    ucr.program_id,
    cp.name as program_name,
    cp.program_type,
    ucr.discount_percentage,
    ucr.discount_amount,
    ucr.expires_at
  FROM public.user_cashback_rewards ucr
  JOIN public.cashback_programs cp ON ucr.program_id = cp.id
  WHERE ucr.user_id = p_user_id
  AND ucr.status = 'earned'
  AND (ucr.expires_at IS NULL OR ucr.expires_at > now())
  ORDER BY ucr.expires_at ASC NULLS LAST;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. Create function to check user eligibility for cashback programs
CREATE OR REPLACE FUNCTION check_cashback_eligibility(p_user_id uuid, p_program_type character varying)
RETURNS TABLE (
  program_id uuid,
  program_name character varying,
  is_eligible boolean,
  reason text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cp.id as program_id,
    cp.name as program_name,
    CASE 
      WHEN cp.valid_after_rides <= COALESCE(ucs.total_rides_completed, 0) THEN true
      ELSE false
    END as is_eligible,
    CASE 
      WHEN cp.valid_after_rides <= COALESCE(ucs.total_rides_completed, 0) THEN 'Eligible'
      ELSE 'Complete ' || (cp.valid_after_rides - COALESCE(ucs.total_rides_completed, 0)) || ' more rides to unlock'
    END as reason
  FROM public.cashback_programs cp
  LEFT JOIN public.user_cashback_stats ucs ON ucs.user_id = p_user_id
  WHERE cp.program_type = p_program_type
  AND cp.is_active = true
  AND (cp.start_date IS NULL OR cp.start_date <= now())
  AND (cp.end_date IS NULL OR cp.end_date > now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 11. Add helpful comments
COMMENT ON TABLE public.cashback_programs IS 'Configuration for different cashback programs like first ride bonus, spin wheel rewards, etc.';
COMMENT ON TABLE public.user_cashback_rewards IS 'Individual cashback rewards earned by users';
COMMENT ON TABLE public.spin_wheel_results IS 'Results from spin wheel game played by users';
COMMENT ON TABLE public.user_cashback_stats IS 'Aggregated statistics about user cashback earnings and usage';
COMMENT ON FUNCTION get_user_available_cashback IS 'Returns all available (unused) cashback rewards for a specific user';
COMMENT ON FUNCTION check_cashback_eligibility IS 'Checks if a user is eligible for specific cashback programs';

-- 12. Create notification triggers for cashback rewards

-- Function to create notification when cashback reward is earned
CREATE OR REPLACE FUNCTION notify_cashback_reward_earned()
RETURNS TRIGGER AS $$
DECLARE
  program_name TEXT;
  notification_title TEXT;
  notification_body TEXT;
BEGIN
  -- Get program name
  SELECT name INTO program_name 
  FROM public.cashback_programs 
  WHERE id = NEW.program_id;
  
  -- Create notification title and body based on program type
  IF program_name LIKE '%First Ride%' THEN
    notification_title := '🎉 First Ride Bonus Earned!';
    notification_body := 'Congratulations! You earned 10% off your first ride. Use it on your next booking!';
  ELSIF program_name LIKE '%Spin Wheel%' THEN
    notification_title := '🎰 Spin Wheel Reward Won!';
    notification_body := 'You won ' || NEW.discount_percentage || '% off your next ride! Use it before it expires.';
  ELSE
    notification_title := '💰 Cashback Reward Earned!';
    notification_body := 'You earned ' || NEW.discount_percentage || '% cashback. Use it on your next ride!';
  END IF;
  
  -- Insert notification
  INSERT INTO public.notifications (
    user_id,
    title,
    message,
    type,
    metadata,
    read,
    read_at,
    created_at
  ) VALUES (
    NEW.user_id,
    notification_title,
    notification_body,
    'cashback',
    jsonb_build_object(
      'reward_id', NEW.id,
      'program_id', NEW.program_id,
      'discount_percentage', NEW.discount_percentage,
      'discount_amount', NEW.discount_amount,
      'expires_at', NEW.expires_at,
      'deeplink', '/rider/cashback'
    ),
    NULL,
    now()
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for cashback reward earned notification
DROP TRIGGER IF EXISTS trigger_notify_cashback_reward_earned ON public.user_cashback_rewards;
CREATE TRIGGER trigger_notify_cashback_reward_earned
AFTER INSERT ON public.user_cashback_rewards
FOR EACH ROW EXECUTE FUNCTION notify_cashback_reward_earned();

-- Function to create notification when spin wheel result is won
CREATE OR REPLACE FUNCTION notify_spin_wheel_result()
RETURNS TRIGGER AS $$
DECLARE
  notification_title TEXT;
  notification_body TEXT;
BEGIN
  -- Only notify if won (not try again)
  IF NEW.status = 'won' AND NEW.discount_percentage > 0 THEN
    notification_title := '🎰 Spin Wheel Result!';
    notification_body := 'You won ' || NEW.discount_percentage || '% off your next ride! Check your cashback rewards.';
    
    -- Insert notification
    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      type,
      metadata,
      read,
      read_at,
      created_at
    ) VALUES (
      NEW.user_id,
      notification_title,
      notification_body,
      'cashback',
      jsonb_build_object(
        'spin_result_id', NEW.id,
        'program_id', NEW.program_id,
        'discount_percentage', NEW.discount_percentage,
        'displayed_result', NEW.displayed_result,
        'deeplink', '/rider/cashback'
      ),
      NULL,
      now()
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for spin wheel result notification
DROP TRIGGER IF EXISTS trigger_notify_spin_wheel_result ON public.spin_wheel_results;
CREATE TRIGGER trigger_notify_spin_wheel_result
AFTER INSERT ON public.spin_wheel_results
FOR EACH ROW EXECUTE FUNCTION notify_spin_wheel_result();

-- Function to create notification when cashback reward is about to expire (24 hours before)
CREATE OR REPLACE FUNCTION notify_cashback_expiring_soon()
RETURNS TRIGGER AS $$
BEGIN
  -- Expiry notifications are now handled by API call on screen load
  -- This trigger is simplified to only handle status changes
  RETURN NEW;
END;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for cashback expiry notification
DROP TRIGGER IF EXISTS trigger_notify_cashback_expiring_soon ON public.user_cashback_rewards;
CREATE TRIGGER trigger_notify_cashback_expiring_soon
AFTER UPDATE ON public.user_cashback_rewards
FOR EACH ROW EXECUTE FUNCTION notify_cashback_expiring_soon();

-- Function to create notification when cashback reward is used
CREATE OR REPLACE FUNCTION notify_cashback_used()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert notification when cashback is used
  IF OLD.status = 'earned' AND NEW.status = 'used' THEN
    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      type,
      metadata,
      read,
      read_at,
      created_at
    ) VALUES (
      NEW.user_id,
      '✅ Cashback Applied',
      'Your ' || NEW.discount_percentage || '% cashback has been applied to your ride. You saved ₦' || NEW.discount_amount || '!',
      'cashback',
      jsonb_build_object(
        'reward_id', NEW.id,
        'program_id', NEW.program_id,
        'discount_percentage', NEW.discount_percentage,
        'discount_amount', NEW.discount_amount,
        'ride_id', NEW.ride_id,
        'deeplink', '/rider/rides-history'
      ),
      NULL,
      now()
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for cashback used notification
DROP TRIGGER IF EXISTS trigger_notify_cashback_used ON public.user_cashback_rewards;
CREATE TRIGGER trigger_notify_cashback_used
AFTER UPDATE ON public.user_cashback_rewards
FOR EACH ROW EXECUTE FUNCTION notify_cashback_used();

-- 13. Create a scheduled job function to check for expiring cashback rewards
-- This should be called by a cron job or pg_cron extension
CREATE OR REPLACE FUNCTION check_expiring_cashback_rewards()
RETURNS void AS $$
DECLARE
  reward RECORD;
BEGIN
  -- Find rewards expiring in 24 hours that haven't been notified
  FOR reward IN 
    SELECT id, user_id, discount_percentage, expires_at, program_id
    FROM public.user_cashback_rewards
    WHERE status = 'earned'
    AND expires_at IS NOT NULL
    AND expires_at <= now() + interval '24 hours'
    AND expires_at > now()
    AND expiry_notification_sent = false
  LOOP
    -- Insert notification
    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      type,
      metadata,
      read,
      read_at,
      created_at
    ) VALUES (
      reward.user_id,
      '⏰ Cashback Expiring Soon!',
      'Your ' || reward.discount_percentage || '% cashback reward expires in less than 24 hours. Use it before it''s gone!',
      'cashback',
      jsonb_build_object(
        'reward_id', reward.id,
        'program_id', reward.program_id,
        'discount_percentage', reward.discount_percentage,
        'expires_at', reward.expires_at,
        'deeplink', '/rider/cashback'
      ),
      NULL,
      now()
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Comment on the scheduled function
COMMENT ON FUNCTION check_expiring_cashback_rewards IS 'Scheduled function to check for expiring cashback rewards and send notifications. Should be run every hour by a cron job.';

-- 14. Create function to mark expired rewards and notify users
-- NOTE: This function is deprecated. Use check_and_mark_expired_cashback instead (called from API)
CREATE OR REPLACE FUNCTION mark_expired_cashback_rewards()
RETURNS void AS $$
DECLARE
  reward RECORD;
BEGIN
  -- Find expired rewards and mark them
  FOR reward IN
    SELECT id, user_id, discount_percentage, program_id
    FROM public.user_cashback_rewards
    WHERE status = 'earned'
    AND expires_at IS NOT NULL
    AND expires_at < now()
  LOOP
    -- Update status to expired
    UPDATE public.user_cashback_rewards
    SET status = 'expired', updated_at = now()
    WHERE id = reward.id;
    
    -- Insert notification
    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      type,
      metadata,
      read,
      read_at,
      created_at
    ) VALUES (
      reward.user_id,
      '⚠️ Cashback Expired',
      'Your ' || reward.discount_percentage || '% cashback reward has expired. Complete more rides to earn new rewards!',
      'cashback',
      jsonb_build_object(
        'reward_id', reward.id,
        'program_id', reward.program_id,
        'discount_percentage', reward.discount_percentage,
        'deeplink', '/rider/cashback'
      ),
      NULL,
      now()
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Comment on the expiry function
COMMENT ON FUNCTION mark_expired_cashback_rewards IS 'Function to mark expired cashback rewards and notify users. Should be run daily by a cron job.';