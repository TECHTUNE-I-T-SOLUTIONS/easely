-- Enable Supabase Realtime for all tables that don't have it yet
-- Run this in Supabase SQL Editor to enable realtime subscriptions

-- Enable realtime for users table
ALTER PUBLICATION supabase_realtime ADD TABLE public.users;

-- Enable realtime for drivers table
ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;

-- Enable realtime for rides table
ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;

-- Enable realtime for wallets table
ALTER PUBLICATION supabase_realtime ADD TABLE public.wallets;

-- Enable realtime for transactions table
ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;

-- Enable realtime for ride_dispatch_logs table
ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_dispatch_logs;

-- Enable realtime for referrals table
ALTER PUBLICATION supabase_realtime ADD TABLE public.referrals;

-- Enable realtime for ride_reviews table
ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_reviews;

-- Enable realtime for cashback_programs table
ALTER PUBLICATION supabase_realtime ADD TABLE public.cashback_programs;

-- Enable realtime for user_cashback_rewards table
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_cashback_rewards;

-- Enable realtime for rider_penalties table
ALTER PUBLICATION supabase_realtime ADD TABLE public.rider_penalties;

-- Enable realtime for notifications table
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Enable realtime for support_tickets table
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets;

-- Enable realtime for support_ticket_messages table
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_ticket_messages;

-- Enable realtime for driver_payments table
ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_payments;

-- Enable realtime for driver_settlements table
ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_settlements;

-- Enable realtime for route_metrics table
ALTER PUBLICATION supabase_realtime ADD TABLE public.route_metrics;

-- Enable realtime for admins table
ALTER PUBLICATION supabase_realtime ADD TABLE public.admins;

-- Note: Some tables may already have realtime enabled. The ALTER statements will
-- skip tables that are already in the publication.
