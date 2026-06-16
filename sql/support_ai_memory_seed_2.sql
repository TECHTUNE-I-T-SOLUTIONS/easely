-- Additional support AI memory seeds for Charter Keke.
-- Run after support_ai_memory.sql.

insert into public.support_ai_memory (
  memory_type,
  title,
  content,
  category,
  audience,
  route,
  tags,
  source,
  confidence,
  metadata
)
values
  (
    'faq',
    'Driver wallet and remittance FAQ',
    'If a driver asks about wallet, remittance, or settlement, answer directly: open the driver Wallet screen, check the pending or overdue settlement, and follow the in-app payment steps if available. Riders should never see the driver settlement flow.',
    'payment_issue',
    'driver',
    '/driver/wallet',
    array['driver', 'wallet', 'remittance', 'settlement'],
    'seed',
    0.95,
    '{"priority":"high"}'::jsonb
  ),
  (
    'faq',
    'Driver remittance status check',
    'If the driver asks whether they have a pending remittance, look up the driver account context and summarize the latest settlement status, due date, and any overdue amount. If nothing is due, say there is no pending remittance right now.',
    'payment_issue',
    'driver',
    '/driver/wallet',
    array['driver', 'pending remittance', 'due', 'wallet'],
    'seed',
    0.95,
    '{"priority":"high"}'::jsonb
  ),
  (
    'faq',
    'Rider trip payment FAQ',
    'Rider trip payment happens directly to the driver in person, off-platform. If a rider asks where their ride payment went, explain that Charter Keke does not process rider trip payments in-app and direct them to the driver or support if there is a dispute.',
    'payment_issue',
    'rider',
    null,
    array['rider', 'payment', 'fare', 'cash'],
    'seed',
    0.96,
    '{"priority":"high"}'::jsonb
  ),
  (
    'faq',
    'Payment dispute clarification',
    'For payment disputes, separate the rider fare paid to the driver from the driver remittance owed to Charter Keke. Ask only for ride details when the issue is truly about a specific trip or overcharge.',
    'payment_issue',
    'all',
    null,
    array['payment dispute', 'fare', 'driver remittance'],
    'seed',
    0.94,
    '{"priority":"high"}'::jsonb
  ),
  (
    'faq',
    'Notification deep-link FAQ',
    'When a notification includes a deep link, the assistant should point the user to the relevant screen in the app for their role. Driver support should link to driver screens such as wallet, rides, or support; rider support should link to rider booking, rides history, active ride, or support as appropriate.',
    'support',
    'all',
    null,
    array['notification', 'deep link', 'route', 'navigation'],
    'seed',
    0.94,
    '{"priority":"high"}'::jsonb
  ),
  (
    'faq',
    'Role-aware deep link routing',
    'Only show routes that belong to the user role. If the user is a rider, do not expose driver-only screens. If the user is a driver, prefer driver wallet, rides, earnings, or support routes.',
    'support',
    'all',
    null,
    array['role', 'routing', 'deep link', 'privacy'],
    'seed',
    0.94,
    '{"priority":"high"}'::jsonb
  ),
  (
    'faq',
    'Crash triage escalation',
    'If the user reports a crash, gather the screen name, exact action, device model, OS version, and whether the crash happens every time. If the crash blocks a core flow like ride details, booking, login, or wallet, escalate to engineering immediately and keep the reply short.',
    'technical',
    'all',
    null,
    array['crash', 'triage', 'engineering', 'bug'],
    'seed',
    0.96,
    '{"priority":"high"}'::jsonb
  ),
  (
    'faq',
    'Support escalation rules',
    'Escalate to human support for account deletion, locked account, repeated OTP failure, unresolved ride disputes, unsafe behavior, driver verification delays, crashes that block usage, refund requests, or anything that requires manual account review.',
    'escalation',
    'all',
    null,
    array['escalation', 'support', 'human review'],
    'seed',
    0.96,
    '{"priority":"high"}'::jsonb
  )
on conflict do nothing;
