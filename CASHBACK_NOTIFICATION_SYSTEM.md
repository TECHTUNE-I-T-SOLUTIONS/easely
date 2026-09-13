# Cashback Notification System

## Overview
Added comprehensive notification system for cashback rewards including database triggers, push notifications, and scheduled job functions.

## SQL Database Triggers

### 1. Cashback Reward Earned Notification
**Trigger**: `trigger_notify_cashback_reward_earned`
**Event**: After INSERT on `user_cashback_rewards`
**Functionality**: Creates notification when user earns cashback
- First ride bonus: "🎉 First Ride Bonus Earned!"
- Spin wheel: "🎰 Spin Wheel Reward Won!"
- General: "💰 Cashback Reward Earned!"

### 2. Spin Wheel Result Notification
**Trigger**: `trigger_notify_spin_wheel_result`
**Event**: After INSERT on `spin_wheel_results`
**Functionality**: Creates notification when user wins spin wheel
- Only sends if status is 'won' (not 'try_again')
- Includes displayed result and actual discount percentage

### 3. Cashback Expiring Soon Notification
**Trigger**: `trigger_notify_cashback_expiring_soon`
**Event**: After UPDATE on `user_cashback_rewards`
**Functionality**: Notifies user when reward expires within 24 hours
- Checks if expires within 24 hours
- Only sends once per reward (tracked by `expiry_notification_sent`)

### 4. Cashback Used Notification
**Trigger**: `trigger_notify_cashback_used`
**Event**: After UPDATE on `user_cashback_rewards`
**Functionality**: Notifies user when cashback is applied to a ride
- Shows discount percentage and amount saved

## Scheduled Job Functions

### 1. Check Expiring Cashback Rewards
**Function**: `check_expiring_cashback_rewards()`
**Purpose**: Batch check for rewards expiring in 24 hours
**Usage**: Should be called hourly by cron job
**Functionality**:
- Finds rewards expiring in 24 hours
- Sends push notifications
- Marks `expiry_notification_sent = true`

### 2. Mark Expired Cashback Rewards
**Function**: `mark_expired_cashback_rewards()`
**Purpose**: Mark expired rewards and notify users
**Usage**: Should be called daily by cron job
**Functionality**:
- Finds expired rewards (status='earned', expires_at < now)
- Updates status to 'expired'
- Sends expiry notification

## Push Notification System

### Created File: `lib/cashback-notifications.ts`

**Functions**:
1. `sendCashbackRewardNotification()` - Sends push when cashback earned
2. `sendSpinWheelNotification()` - Sends push for spin wheel results
3. `sendExpiringCashbackNotification()` - Sends push for expiring rewards
4. `sendExpiredCashbackNotification()` - Sends push for expired rewards
5. `sendCashbackUsedNotification()` - Sends push when cashback used
6. `setupCashbackNotificationListeners()` - Sets up Supabase realtime subscriptions
7. `checkExpiringCashbackRewards()` - Batch check for expiring rewards
8. `markExpiredCashbackRewards()` - Batch mark expired rewards

### Integration Points

**User Cashback API** (`app/api/user/cashback/route.ts`):
- Sends push notification when cashback reward created
- Sends push notification when spin wheel won
- Sends push notification when cashback used

**Admin Cashback API** (`app/api/admin/cashback/route.ts`):
- Added PATCH endpoint for manual trigger of scheduled jobs
- `action: "check_expiring"` - Manually run expiry check
- `action: "mark_expired"` - Manually mark expired rewards

## Notification Types

All notifications include:
- **Title**: Emoji + action description
- **Body**: Detailed information about the reward
- **Type**: 'cashback'
- **Metadata**: JSON with reward details
- **Deeplink**: Links to cashback screen

### Notification Examples

**First Ride Bonus**:
```
Title: 🎉 First Ride Bonus Earned!
Body: Congratulations! You earned 10% off your first ride. Use it on your next booking!
```

**Spin Wheel Win**:
```
Title: 🎰 Spin Wheel Reward Won!
Body: You won 3% off your next ride! Use it before it expires.
```

**Expiring Soon**:
```
Title: ⏰ Cashback Expiring Soon!
Body: Your 5% cashback reward expires in less than 24 hours. Use it before it's gone!
```

**Expired**:
```
Title: ⚠️ Cashback Expired
Body: Your 5% cashback reward has expired. Complete more rides to earn new rewards!
```

**Applied**:
```
Title: ✅ Cashback Applied
Body: Your 5% cashback has been applied to your ride. You saved ₦150!
```

## Cron Job Setup

### Recommended Schedule

**Hourly Job** (for expiring rewards):
```bash
# Run every hour at minute 0
0 * * * * curl -X POST https://your-api.com/api/admin/cashback?action=check_expiring
```

**Daily Job** (for expired rewards):
```bash
# Run daily at midnight
0 0 * * * curl -X POST https://your-api.com/api/admin/cashback?action=mark_expired
```

### Alternative: Use pg_cron Extension

If using Supabase with pg_cron extension:
```sql
-- Run every hour
SELECT cron.schedule(
  'check-expiring-cashback',
  '0 * * * *',
  'SELECT check_expiring_cashback_rewards()'
);

-- Run daily at midnight
SELECT cron.schedule(
  'mark-expired-cashback',
  '0 0 * * *',
  'SELECT mark_expired_cashback_rewards()'
);
```

## Testing

### Manual Testing

1. **Test reward earned notification**:
   - Create a cashback reward via API
   - Check notifications table for new entry
   - Verify push notification sent (if user has push token)

2. **Test spin wheel notification**:
   - Spin the wheel via mobile app
   - Check for notification on win
   - Verify displayed vs actual percentage

3. **Test expiry notification**:
   - Create reward with expires_at = now() + 23 hours
   - Run `check_expiring_cashback_rewards()`
   - Verify notification sent

4. **Test expired notification**:
   - Create reward with expires_at = now() - 1 hour
   - Run `mark_expired_cashback_rewards()`
   - Verify status updated to 'expired'
   - Verify notification sent

## Files Modified

1. `supabase/cashback_and_fare_migration.sql` - Added triggers and functions
2. `lib/cashback-notifications.ts` - Created new notification system
3. `app/api/user/cashback/route.ts` - Integrated push notifications
4. `app/api/admin/cashback/route.ts` - Added manual trigger endpoints

## Next Steps

1. Run the SQL migration to create triggers
2. Set up cron jobs for scheduled functions
3. Test notification system end-to-end
4. Monitor notification delivery rates
5. Adjust notification frequency if needed
6. Add notification preferences in user settings (optional)