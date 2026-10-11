-- Create FAQ table
CREATE TABLE IF NOT EXISTS public.faqs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  question text NOT NULL,
  answer text NOT NULL,
  category character varying(100) NOT NULL,
  audience character varying(50) NOT NULL DEFAULT 'all',
  order_index integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT faqs_pkey PRIMARY KEY (id),
  CONSTRAINT faqs_audience_check CHECK (audience IN ('rider', 'driver', 'all'))
);

-- Create indexes for FAQ
CREATE INDEX IF NOT EXISTS idx_faqs_category ON public.faqs USING btree (category);
CREATE INDEX IF NOT EXISTS idx_faqs_audience ON public.faqs USING btree (audience);
CREATE INDEX IF NOT EXISTS idx_faqs_active ON public.faqs USING btree (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_faqs_search ON public.faqs USING gin (to_tsvector('english', question || ' ' || answer));

-- Add trigger for updated_at
CREATE TRIGGER faqs_updated_at BEFORE UPDATE ON faqs FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS Policies for FAQs
ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;

-- Allow public to read FAQs
CREATE POLICY "Allow public read access to FAQs" ON public.faqs
  FOR SELECT
  TO public
  USING (is_active = true);

-- Allow authenticated users to read all FAQs
CREATE POLICY "Allow authenticated read access to FAQs" ON public.faqs
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow service role to manage FAQs
CREATE POLICY "Allow service role full access to FAQs" ON public.faqs
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Seed comprehensive FAQs for Riders
INSERT INTO public.faqs (question, answer, category, audience, order_index) VALUES
-- Booking Related
('How do I book a ride?', 'To book a ride: 1. Open the app and tap "Book Ride" 2. Enter your pickup location (you can use your current location, search by address, or select from recent locations) 3. Enter your destination 4. Choose your pickup time (now or schedule for later) 5. Review the fare and details 6. Tap "Confirm Booking" to complete.', 'Booking', 'rider', 1),
('Can I schedule a ride for later?', 'Yes! When booking a ride, you can select "Choose Custom Time" to schedule your pickup for a specific date and time. You can book up to 7 days in advance.', 'Booking', 'rider', 2),
('How is the fare calculated?', 'Fares are calculated based on distance and time using our pricing configuration. The app shows you the estimated fare before you confirm your booking. The final fare may vary slightly if the route changes during the trip.', 'Booking', 'rider', 3),
('What payment methods are accepted?', 'Riders pay drivers directly in cash or via transfer. The fare amount shown in the app is what you pay to the driver. We do not process card payments in-app for rider trips.', 'Booking', 'rider', 4),
('Can I modify my pickup or destination after booking?', 'Once a driver has accepted your ride, you cannot modify the pickup or destination. If you need to change locations, you should cancel the current booking and create a new one. Note that cancellation fees may apply if a driver has already accepted.', 'Booking', 'rider', 5),

-- Cancellation Policy
('What is the cancellation policy?', 'You can cancel your ride for free as long as no driver has accepted it. Once a driver accepts, you have a 5-minute free cancellation window. After 5 minutes, a 30% cancellation fee of the ride fare applies. If a driver fails to arrive within 15 minutes without communication, you can cancel without any fee and receive a 10% credit.', 'Cancellation', 'rider', 1),
('Why was I charged a cancellation fee?', 'A 30% cancellation fee applies if you cancel after a driver has accepted your ride and more than 5 minutes have passed since acceptance. This fee compensates the driver for their time and commitment.', 'Cancellation', 'rider', 2),
('How do I cancel a ride?', 'To cancel: 1. Go to your active ride in the app 2. Tap the "Cancel Ride" button 3. Confirm the cancellation. The app will show you if a fee applies before you confirm.', 'Cancellation', 'rider', 3),
('What if my driver doesn''t show up?', 'If your driver doesn''t arrive within 15 minutes of accepting your ride without communicating with you, you can cancel without any fee. The app will show a prompt asking if the driver communicated. If they didn''t, the ride will be re-dispatched to other drivers and the driver will be penalized.', 'Cancellation', 'rider', 4),

-- Driver Related
('How do I know my driver details?', 'Once a driver accepts your ride, you''ll see their name, photo, vehicle type, plate number, and rating in the app. You can also call them directly from the active ride screen.', 'Driver', 'rider', 1),
('What if my driver asks for extra payment?', 'Drivers should only charge the fare shown in the app. If a driver asks for extra payment, please report this to support immediately with your ride details. This is a violation of our policies.', 'Driver', 'rider', 2),
('Can I request a specific driver?', 'No, you cannot request a specific driver. The system automatically assigns the nearest available driver to ensure efficient service.', 'Driver', 'rider', 3),
('How do I rate my driver?', 'After your ride is completed, you''ll be prompted to rate your driver from 1 to 5 stars. You can also leave a written review. Your feedback helps us maintain quality service.', 'Driver', 'rider', 4),

-- Safety
('Is it safe to use Charter Keke?', 'Yes, all drivers on our platform are verified and their credentials are checked. We also track rides in real-time and provide shareable live location features. If you ever feel unsafe, use the SOS feature in the app.', 'Safety', 'rider', 1),
('What should I do if I feel unsafe during a ride?', 'If you feel unsafe: 1. Use the SOS feature in the app which shares your location and ride details 2. Call emergency services if needed 3. End the ride safely 4. Report the incident to support immediately.', 'Safety', 'rider', 2),
('How does the SOS feature work?', 'The SOS feature captures your current location, device information, and active ride details. This information is sent to our support team for immediate review and assistance.', 'Safety', 'rider', 3),
('Are drivers background checked?', 'Yes, all drivers undergo verification including license checks, vehicle inspection, and identity verification before they can accept rides.', 'Safety', 'rider', 4),

-- Account & Profile
('How do I change my phone number?', 'To change your phone number, go to Profile > Settings > Edit Profile. You''ll need to verify the new number with an OTP code.', 'Account', 'rider', 1),
('How do I delete my account?', 'To delete your account, go to Profile > Privacy/Security > Delete Account. Note that this action is permanent and cannot be undone. Any pending rides or issues should be resolved before deletion.', 'Account', 'rider', 2),
('What if I forget my password?', 'You can reset your password from the login screen by tapping "Forgot Password". Enter your phone number or email, and we''ll send you a reset link or code.', 'Account', 'rider', 3),
('How do I update my profile picture?', 'Go to Profile > Edit Profile > tap on your profile picture > select a photo from your gallery or take a new one.', 'Account', 'rider', 4),

-- Rewards & Cashback
('What is cashback?', 'Cashback is a reward program where you earn a percentage of your ride fare back as credit. You can apply cashback to reduce your fare when booking rides.', 'Rewards', 'rider', 1),
('How do I earn cashback?', 'You can earn cashback through promotions, completing rides, and special offers. Check the Cashback Rewards section in the app for available rewards.', 'Rewards', 'rider', 2),
('How do I apply cashback to a booking?', 'When reviewing your booking details before confirmation, you''ll see available cashback rewards. Tap on a reward to apply it, and the discounted fare will be shown.', 'Rewards', 'rider', 3),
('Does cashback expire?', 'Some cashback rewards may have expiration dates. Check the details of each reward in the Cashback Rewards section.', 'Rewards', 'rider', 4),

-- Ride History
('How do I view my past rides?', 'Go to the Rides section in the app to view your ride history. You can filter by status (active, completed, cancelled) and view details of each ride.', 'Ride History', 'rider', 1),
('Can I rebook a previous ride?', 'Yes! In your ride history, tap on a completed ride and select "Book Again" to quickly book the same route.', 'Ride History', 'rider', 2),
('How long is my ride history kept?', 'Your ride history is kept indefinitely in our system for your reference and for resolving any disputes.', 'Ride History', 'rider', 3),

-- Support
('How do I contact support?', 'You can contact support through the in-app chat feature or by emailing support@charterkeke.com. For urgent issues, use the SOS feature.', 'Support', 'rider', 1),
('What information should I provide when reporting an issue?', 'When reporting an issue, please provide: your ride ID (if applicable), date and time of the ride, pickup and destination locations, and a detailed description of the issue.', 'Support', 'rider', 2),
('How quickly does support respond?', 'Our support team typically responds within 24 hours. For urgent safety issues, response times are faster.', 'Support', 'rider', 3),

-- Lost Items
('I left something in the keke. What do I do?', 'If you left an item in a vehicle, contact support immediately with your ride details. We can help you contact the driver. Note that a ₦1,000 delivery fee may apply for returned items.', 'Lost Items', 'rider', 1),
('How do I claim a lost item?', 'Contact support with your ride ID and a description of the item. We''ll coordinate with the driver to return your item.', 'Lost Items', 'rider', 2),

-- Pricing
('Why is my fare different from the estimate?', 'The estimated fare is based on the optimal route. Actual fare may vary if: the route changes due to traffic or your request, there are multiple stops, or the trip takes longer than estimated.', 'Pricing', 'rider', 1),
('Are there surge pricing or higher rates during peak times?', 'No, we do not use surge pricing. Our fares are consistent regardless of time or demand.', 'Pricing', 'rider', 2),
('What if I think I was overcharged?', 'If you believe you were overcharged, contact support with your ride ID and details. We''ll review the trip and resolve any discrepancies.', 'Pricing', 'rider', 3);

-- Seed comprehensive FAQs for Drivers
INSERT INTO public.faqs (question, answer, category, audience, order_index) VALUES
-- Getting Started
('How do I become a driver?', 'To become a driver: 1. Download the Charter Keke driver app 2. Register with your personal details 3. Upload your vehicle documents, license, and identity verification 4. Wait for admin approval 5. Once approved, go online to start accepting rides.', 'Getting Started', 'driver', 1),
('What documents do I need to verify?', 'You need: a valid driver''s license, vehicle registration documents, proof of identity (NIN or ID card), and vehicle insurance. All documents must be current and valid.', 'Getting Started', 'driver', 2),
('How long does verification take?', 'Verification typically takes 1-3 business days. You can check your status in the app. If it takes longer, contact support.', 'Getting Started', 'driver', 3),
('What if my verification is rejected?', 'If verification is rejected, you''ll receive feedback on what needs to be corrected. Update your documents and resubmit for review.', 'Getting Started', 'driver', 4),

-- Earnings & Payments
('How do I get paid?', 'Passengers pay you directly in cash or transfer. You then pay the platform fee (remittance) to Charter Keke through the Wallet section in the app.', 'Earnings', 'driver', 1),
('What is the platform fee?', 'The platform fee is 15% of your total earnings. This is paid to Charter Keke for using the platform. You can view and pay your remittance in the Wallet section.', 'Earnings', 'driver', 2),
('When do I need to pay my remittance?', 'Remittance is due on a regular schedule (check your Wallet for your specific due date). Late payments may lock your ability to accept new rides.', 'Earnings', 'driver', 3),
('How do I pay my remittance?', 'Go to Wallet > Pay Remittance > select payment method > confirm payment. You can pay via bank transfer or other available methods.', 'Earnings', 'driver', 4),
('What happens if I don''t pay on time?', 'If you don''t pay your remittance on time, your account may be locked and you won''t be able to accept new rides until payment is made. Late payments may incur additional fees.', 'Earnings', 'driver', 5),
('Can I see my earnings history?', 'Yes, go to Wallet > Earnings to view your complete earnings history, including completed rides, total earnings, and remittance payments.', 'Earnings', 'driver', 6),

-- Accepting Rides
('How do I accept rides?', 'When you''re online, you''ll receive ride requests via push notification and SMS. Tap on the request to view details, then tap "Accept" to take the ride. You have a limited time to respond.', 'Accepting Rides', 'driver', 1),
('What if I miss a ride request?', 'If you miss a ride request, it will be offered to another driver. Frequent missed requests may affect your ratings and standing on the platform.', 'Accepting Rides', 'driver', 2),
('Can I reject ride requests?', 'Yes, you can reject ride requests if you''re unable to take them. However, frequent rejections may affect your ability to receive future requests.', 'Accepting Rides', 'driver', 3),
('How do I go online/offline?', 'Toggle your online status from the home screen or profile section. When online, you''ll receive ride requests. When offline, you won''t receive any requests.', 'Accepting Rides', 'driver', 4),

-- During the Ride
('What if I can''t find the pickup location?', 'Use the in-app map and GPS to navigate. If you still can''t find it, call the rider to clarify the location. The app provides the rider''s phone number for this purpose.', 'During Ride', 'driver', 1),
('How long should I wait for the rider?', 'You should wait up to 5 minutes free of charge at the pickup location. After 5 minutes, waiting time fees accrue at ₦50 per minute up to a maximum of 10 minutes before you can cancel as a no-show.', 'During Ride', 'driver', 2),
('What if the rider doesn''t show up?', 'If the rider doesn''t show up within 10 minutes of your arrival, you can cancel the ride as a rider no-show. Contact support if there are any disputes.', 'During Ride', 'driver', 3),
('Can I change the route during the ride?', 'Only change the route if the rider explicitly requests it. Unauthorized route changes may lead to disputes and penalties.', 'During Ride', 'driver', 4),
('What if the rider wants to change the destination?', 'If the rider wants to change the destination, inform them that the fare may change based on the new distance. Continue the ride to the new destination as requested.', 'During Ride', 'driver', 5),

-- Cancellation
('What is the driver cancellation policy?', 'If you cancel after accepting a ride, you may receive a lower rating. Frequent cancellations without valid reason may lead to account penalties or suspension.', 'Cancellation', 'driver', 1),
('When can I cancel a ride?', 'You can cancel if: the rider doesn''t show up within 10 minutes, the rider is abusive or unsafe, or there''s a legitimate emergency. Document the reason in the app.', 'Cancellation', 'driver', 2),
('What if the rider cancels?', 'If the rider cancels within 5 minutes of acceptance, there''s no penalty. If they cancel after 5 minutes, they pay a 30% fee and you''ll be notified so you can accept other rides.', 'Cancellation', 'driver', 3),
('What is the 15-minute arrival window?', 'You must arrive at the pickup location within 15 minutes of accepting a ride. If you fail to arrive without communicating, the rider can cancel without fee and you''ll be penalized 10% on your next remittance.', 'Cancellation', 'driver', 4),

-- Location & GPS
('Do I need to keep GPS on?', 'Yes, you must keep your GPS and data connection enabled at all times when online. This allows the app to track your location for ride matching and rider safety.', 'Location', 'driver', 1),
('What if my GPS isn''t working?', 'If your GPS isn''t working, you won''t be able to accept rides. Fix your GPS settings and ensure you have a stable data connection before going online.', 'Location', 'driver', 2),
('Why is my location important?', 'Your location is used to match you with nearby riders and to provide real-time tracking to riders for their safety and peace of mind.', 'Location', 'driver', 3),

-- Ratings
('How are ratings calculated?', 'Ratings are based on rider feedback after each ride. Maintain a high rating by providing good service, being punctual, and having a clean vehicle.', 'Ratings', 'driver', 1),
('What if I get a low rating?', 'If you receive a low rating, review the feedback and improve your service. Consistently low ratings may lead to account review and potential suspension.', 'Ratings', 'driver', 2),
('What is the minimum rating required?', 'Drivers should maintain a minimum rating of 4.0 stars. Ratings below this may trigger account review.', 'Ratings', 'driver', 3),

-- Vehicle
('What vehicle types are accepted?', 'We accept tricycles (Keke) that are in good condition, properly registered, and insured. Vehicle specifications may vary by zone.', 'Vehicle', 'driver', 1),
('How do I update my vehicle information?', 'Go to Profile > Vehicle > Edit to update your vehicle type, plate number, or upload new vehicle pictures.', 'Vehicle', 'driver', 2),
('What if my vehicle breaks down?', 'If your vehicle breaks down during a ride: 1. Communicate with the rider immediately 2. Contact support to report the issue 3. Ensure the rider reaches their destination safely.', 'Vehicle', 'driver', 3),

-- Safety
('What if I feel unsafe with a rider?', 'If you feel unsafe: 1. End the ride at a safe location 2. Contact support immediately 3. Use the SOS feature if needed 4. Document the incident.', 'Safety', 'driver', 1),
('Am I insured?', 'Drivers must maintain their own vehicle insurance. Charter Keke does not provide insurance coverage for drivers or vehicles.', 'Safety', 'driver', 2),
('What if I''m in an accident?', 'If you''re in an accident: 1. Ensure everyone is safe 2. Contact emergency services if needed 3. Inform support and the rider 4. Follow normal accident reporting procedures.', 'Safety', 'driver', 3),

-- Account
('How do I update my profile?', 'Go to Profile > Edit Profile to update your personal information, photo, and contact details.', 'Account', 'driver', 1),
('How do I change my bank details?', 'Go to Wallet > Bank Account to update your bank account information for remittance payments.', 'Account', 'driver', 2),
('Can I have multiple accounts?', 'No, each driver can only have one account. Multiple accounts are a violation of our terms and may lead to suspension.', 'Account', 'driver', 3),

-- Penalties
('What is the lateness penalty?', 'If you fail to arrive within 15 minutes of accepting a ride without communicating, you''ll be penalized 10% of the ride fare added to your next remittance (15% + 10% = 25% total).', 'Penalties', 'driver', 1),
('How do I avoid penalties?', 'To avoid penalties: arrive at pickup within 15 minutes, communicate if delayed, keep GPS and data on, and provide good service.', 'Penalties', 'driver', 2),
('How do I check if I have penalties?', 'Check your Wallet section for any pending penalties or additional remittance amounts.', 'Penalties', 'driver', 3),

-- Operating Zones
('What are operating zones?', 'Operating zones are the areas where you can accept rides. You can set your preferred zones in your profile settings.', 'Operating Zones', 'driver', 1),
('How do I change my operating zones?', 'Go to Profile > Operating Zones to add or remove zones. You can only accept rides in your selected zones.', 'Operating Zones', 'driver', 2),
('Can I operate in multiple zones?', 'Yes, you can operate in multiple zones if they''re within a reasonable distance of each other.', 'Operating Zones', 'driver', 3);

-- Seed general FAQs for both riders and drivers
INSERT INTO public.faqs (question, answer, category, audience, order_index) VALUES
('What is Charter Keke?', 'Charter Keke is a technology platform that connects riders with licensed tricycle (Keke) drivers for safe, reliable, and affordable transportation.', 'General', 'all', 1),
('How do I download the app?', 'You can download the Charter Keke app from the Google Play Store for Android or the Apple App Store for iOS.', 'General', 'all', 2),
('Is the app free to use?', 'Yes, the app is free to download and use. Riders pay only for their rides, and drivers pay a platform fee on their earnings.', 'General', 'all', 3),
('What cities is Charter Keke available in?', 'Charter Keke is currently available in Lagos, Nigeria. We are expanding to other cities soon.', 'General', 'all', 4),
('How do I report a bug or technical issue?', 'To report a bug or technical issue, contact support with details of what happened, your device model, and app version. Screenshots are helpful.', 'General', 'all', 5),
('Is my data secure?', 'Yes, we take data security seriously. Your personal and payment information is encrypted and protected according to industry standards.', 'General', 'all', 6),
('Can I use the app without internet?', 'No, you need an active internet connection to use the app for booking, ride tracking, and real-time updates.', 'General', 'all', 7);
