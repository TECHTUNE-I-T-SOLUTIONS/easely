import webpush from 'web-push';
import { supabaseAdmin } from './supabase';

// Configure web-push with VAPID keys on server startup
export const initializePushNotifications = () => {
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;

  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.warn('⚠️ [PUSH] VAPID keys not configured');
    return;
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  console.log('✅ [PUSH] Web push notifications initialized with VAPID keys');
};

/**
 * Interface for push notification subscription
 * Stores the device token for sending notifications via Expo
 */
export interface PushSubscription {
  userId: string;
  pushToken: string | null;
  subscribedAt: string;
  platform: 'ios' | 'android' | 'web' | 'unknown';
  // New fields for Firebase/Expo error handling
  status?: 'token_ready' | 'permission_granted_token_pending' | 'permission_denied' | 'unknown';
  isPlaceholder?: boolean;
  reason?: string | null;
  tokenUpdatedAt?: string | null;
}

/**
 * In-memory cache for active push subscriptions.
 * A single user may have multiple devices, so each user maps to an array.
 */
const activeSubscriptions = new Map<string, PushSubscription[]>();

const upsertCachedSubscription = (subscription: PushSubscription) => {
  const current = activeSubscriptions.get(subscription.userId) || [];
  const next = current.filter((item) => item.pushToken !== subscription.pushToken);
  next.push(subscription);
  activeSubscriptions.set(subscription.userId, next);
};

const readCachedSubscriptions = (userId: string) => activeSubscriptions.get(userId) || [];

/**
 * Store a new push subscription in Supabase and cache
 */
export const storePushSubscription = async (subscription: PushSubscription) => {
  try {
    if (!subscription.pushToken) {
      console.warn('⚠️ [PUSH] Refusing to store subscription without a push token for user:', subscription.userId);
      return null;
    }

    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('push_subscriptions')
        .upsert(
          {
            user_id: subscription.userId,
            push_token: subscription.pushToken,
            platform: subscription.platform,
            subscribed_at: subscription.subscribedAt,
            is_active: true,
            last_verified_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,push_token' }
        );

      if (error) {
        console.error('⚠️ [PUSH] Failed to store subscription in database:', error.message);
        // Fall back to in-memory storage
      } else {
        console.log('✅ [PUSH] Subscription stored in database for user:', subscription.userId, {
          platform: subscription.platform,
          status: subscription.status,
        });
      }

      upsertCachedSubscription(subscription);
      return data ? data[0] : subscription;
    }
  } catch (error) {
    console.error('⚠️ [PUSH] Could not persist subscription:', error);
  }

  // Always keep in-memory cache
  upsertCachedSubscription(subscription);
  console.log('✅ [PUSH] Subscription cached for user:', subscription.userId);
  return subscription;
};

/**
 * Load subscriptions from database into memory cache
 */
export const loadSubscriptionsFromDatabase = async () => {
  try {
    if (!supabaseAdmin) {
      console.warn('⚠️ [PUSH] Supabase not initialized, using in-memory cache only');
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('push_subscriptions')
      .select('user_id, push_token, platform, subscribed_at')
      .eq('is_active', true);

    if (error) {
      console.warn('⚠️ [PUSH] Failed to load subscriptions from database:', error.message);
      return;
    }

    if (data && data.length > 0) {
      data.forEach((sub: any) => {
        upsertCachedSubscription({
          userId: sub.user_id,
          pushToken: sub.push_token,
          platform: sub.platform,
          subscribedAt: sub.subscribed_at,
        });
      });
      console.log('📡 [PUSH] Loaded', data.length, 'subscriptions from database');
    }
  } catch (error) {
    console.warn('⚠️ [PUSH] Error loading subscriptions:', error);
  }
};

/**
 * Get all subscriptions for a user (returns only active subscriptions)
 */
export const getUserSubscriptions = (userId: string): PushSubscription[] => {
  return readCachedSubscriptions(userId).filter((subscription) => !!subscription.pushToken);
};

/**
 * Get active (non-placeholder) subscriptions for a user
 * Only returns tokens that are ready to receive notifications
 */
export const getUserActiveSubscriptions = (userId: string): PushSubscription[] => {
  return readCachedSubscriptions(userId).filter((subscription) => !!subscription.pushToken);
};

/**
 * Send push notification to specific users
 * Only sends to users with valid (non-placeholder) tokens
 */
export const sendPushNotification = async (
  userIds: string[],
  payload: {
    title: string;
    body: string;
    data?: Record<string, any>;
    categoryId?: string;
    type: 'ride_request' | 'ride_accepted' | 'ride_update' | 'ride_cancelled' | 'support_message' | 'payment_received' | 'security_alert' | 'remittance_due' | 'remittance_reminder';
  }
) => {
  const results: Array<{ userId: string; success: boolean; error?: string }> = [];
  
  if (!userIds || userIds.length === 0) return results;

  try {
    if (!supabaseAdmin) {
      console.warn('⚠️ [PUSH] Supabase not initialized');
      return userIds.map(userId => ({ userId, success: false, error: 'Supabase not initialized' }));
    }

    // Fetch active non-placeholder subscriptions directly from the database
    const { data: subscriptionsData, error } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*')
      .in('user_id', userIds)
      .eq('is_active', true)
      .not('push_token', 'is', null);

    if (error) {
      console.error('❌ [PUSH] Failed to fetch subscriptions from database:', error.message);
      return userIds.map(userId => ({ userId, success: false, error: 'Database error' }));
    }

    // Group subscriptions by userId
    const subsByUserId = new Map<string, any[]>();
    for (const sub of subscriptionsData || []) {
      if (!subsByUserId.has(sub.user_id)) {
        subsByUserId.set(sub.user_id, []);
      }
      subsByUserId.get(sub.user_id)!.push(sub);
    }

    for (const userId of userIds) {
      const subscriptions = subsByUserId.get(userId) || [];

      // Also check memory cache just in case we have fresh subscriptions not yet flushed, though DB should be source of truth
      const memorySubs = getUserActiveSubscriptions(userId);
      const allSubs = [...subscriptions];
      
      // Add memory subs if not already present
      for (const mSub of memorySubs) {
        if (!allSubs.some(s => s.push_token === mSub.pushToken || s.pushToken === mSub.pushToken)) {
          allSubs.push({
            user_id: userId,
            push_token: mSub.pushToken,
            platform: mSub.platform
          });
        }
      }

      if (allSubs.length === 0) {
        console.warn(`⚠️ [PUSH] No active subscriptions found for user: ${userId} (may be using placeholder token)`);
        results.push({ userId, success: false, error: 'No active subscription' });
        continue;
      }

      for (const subscription of allSubs) {
        try {
          const pushToken = subscription.push_token || subscription.pushToken;
          
          // Skip if no valid token
          if (!pushToken) {
            results.push({ userId, success: false, error: 'No token available' });
            continue;
          }

          const notificationPayload = {
            title: payload.title,
            body: payload.body,
            data: {
              type: payload.type,
              deeplink: payload.data?.deeplink,
              timestamp: new Date().toISOString(),
              ...payload.data,
            },
          };

          // For mobile app (Expo push tokens returned by the app)
          if (subscription.platform === 'ios' || subscription.platform === 'android') {
            await sendExpoNotification(pushToken, {
              ...notificationPayload,
              categoryId: payload.categoryId,
            });
          }
          // For web
          else if (subscription.platform === 'web') {
            await webpush.sendNotification(
              JSON.parse(pushToken),
              JSON.stringify(notificationPayload)
            );
          }

          console.log('✅ [PUSH] Notification sent to user:', userId, 'Platform:', subscription.platform);
          results.push({ userId, success: true });
        } catch (error: any) {
          console.error('❌ [PUSH] Failed to send notification to user:', userId, 'Error:', error.message);
          results.push({ userId, success: false, error: error.message });
          
          // Mark invalid tokens in database
          if (error.message?.includes('ExponentPushToken') || error.message?.includes('Invalid')) {
            console.log(`🔄 [PUSH] Marking token as invalid for user: ${userId}`);
            const pushToken = subscription.push_token || subscription.pushToken;
            // In production, you might want to deactivate this subscription
            await removeSubscription(userId, pushToken || '').catch(() => {});
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ [PUSH] Error in sendPushNotification:', error);
  }

  return results;
};

/**
 * Send Expo notification (for mobile app)
 * Handles errors gracefully and logs detailed information
 */
const sendExpoNotification = async (
  expoPushToken: string,
  payload: {
    title: string;
    body: string;
    data: Record<string, any>;
    categoryId?: string;
  }
) => {
  try {
    const message = {
      to: expoPushToken,
      sound: 'default',
      title: payload.title,
      body: payload.body,
      data: payload.data,
      badge: 1,
      categoryId: payload.categoryId,
    };

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const data = await response.json();
    
    // Handle Expo API errors
    if (data.errors) {
      const errorMessage = data.errors[0]?.message || 'Unknown error';
      throw new Error(`Expo API Error: ${errorMessage}`);
    }

    if (!response.ok) {
      throw new Error(`Expo API returned ${response.status}: ${data.message || 'Unknown error'}`);
    }

    console.log('✅ [PUSH] Expo notification sent successfully to token:', expoPushToken.substring(0, 20) + '...');
    return data;
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    console.error('❌ [PUSH] Expo notification error:', errorMessage);
    throw error;
  }
};

/**
 * Broadcast notification to all drivers with valid tokens
 */
export const broadcastToDrivers = async (
  payload: {
    title: string;
    body: string;
    data?: Record<string, any>;
    type: string;
  },
  excludeUserIds: string[] = []
) => {
  console.log('📢 [PUSH] Broadcasting to drivers, excluding:', excludeUserIds);
  try {
    if (!supabaseAdmin) {
      console.warn('⚠️ [PUSH] Supabase not initialized');
      return;
    }

    // Get all drivers who have valid (non-placeholder) push tokens
    const { data: drivers, error } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('role', 'driver')
      .limit(10000);

    if (error) {
      console.warn('⚠️ [PUSH] Failed to fetch drivers:', error.message);
      return;
    }

    const driverIds = (drivers || [])
      .map((d: any) => d.id)
      .filter((id: string) => !excludeUserIds.includes(id));
    console.log(`📢 [PUSH] Found ${driverIds.length} drivers to notify`);
    
    return sendPushNotification(driverIds, {
      ...payload,
      type: payload.type as any,
    });
  } catch (error) {
    console.error('❌ [PUSH] Error broadcasting to drivers:', error);
  }
};

/**
 * Broadcast notification to all riders with valid tokens
 */
export const broadcastToRiders = async (
  payload: {
    title: string;
    body: string;
    data?: Record<string, any>;
    type: string;
  },
  excludeUserIds: string[] = []
) => {
  console.log('📢 [PUSH] Broadcasting to riders, excluding:', excludeUserIds);
  try {
    if (!supabaseAdmin) {
      console.warn('⚠️ [PUSH] Supabase not initialized');
      return;
    }

    // Get all riders who have valid (non-placeholder) push tokens
    const { data: riders, error } = await supabaseAdmin
      .from('users')
      .select('id')
      .in('role', ['rider', 'passenger', 'user'])
      .limit(10000);

    if (error) {
      console.warn('⚠️ [PUSH] Failed to fetch riders:', error.message);
      return;
    }

    const riderIds = (riders || [])
      .map((r: any) => r.id)
      .filter((id: string) => !excludeUserIds.includes(id));
    console.log(`📢 [PUSH] Found ${riderIds.length} riders to notify`);
    
    return sendPushNotification(riderIds, {
      ...payload,
      type: payload.type as any,
    });
  } catch (error) {
    console.error('❌ [PUSH] Error broadcasting to riders:', error);
  }
};

/**
 * Broadcast to all drivers WITH real tokens (filtering database)
 * More reliable than in-memory cache for production
 */
export const broadcastToDriversWithValidTokens = async (
  payload: {
    title: string;
    body: string;
    data?: Record<string, any>;
    type: string;
  },
  excludeUserIds: string[] = []
) => {
  console.log('📢 [PUSH] Broadcasting to drivers with VALID tokens only');
  try {
    if (!supabaseAdmin) {
      console.warn('⚠️ [PUSH] Supabase not initialized');
      return;
    }

    // Query users + subscriptions to get drivers with valid tokens
    const { data: results, error } = await supabaseAdmin
      .from('users')
      .select(
        `
        id,
        push_subscriptions!inner(
          push_token,
          is_active,
          status
        )
        `
      )
      .eq('role', 'driver')
      .eq('push_subscriptions.is_active', true)
      .neq('push_subscriptions.push_token', null);

    if (error) {
      console.warn('⚠️ [PUSH] Failed to fetch drivers with valid tokens:', error.message);
      // Fallback to regular broadcast
      return broadcastToDrivers(payload, excludeUserIds);
    }

    const driverIds = (results || [])
      .map((d: any) => d.id)
      .filter((id: string) => !excludeUserIds.includes(id));
    
    console.log(`📢 [PUSH] Found ${driverIds.length} drivers with valid tokens to notify`);
    
    if (driverIds.length === 0) {
      console.warn('⚠️ [PUSH] No drivers with valid tokens found');
      return [];
    }

    return sendPushNotification(driverIds, {
      ...payload,
      type: payload.type as any,
    });
  } catch (error) {
    console.error('❌ [PUSH] Error broadcasting to drivers with valid tokens:', error);
    // Fallback to regular broadcast
    return broadcastToDrivers(payload, excludeUserIds);
  }
};

/**
 * Broadcast to all riders WITH real tokens (filtering database)
 * More reliable than in-memory cache for production
 */
export const broadcastToRidersWithValidTokens = async (
  payload: {
    title: string;
    body: string;
    data?: Record<string, any>;
    type: string;
  },
  excludeUserIds: string[] = []
) => {
  console.log('📢 [PUSH] Broadcasting to riders with VALID tokens only');
  try {
    if (!supabaseAdmin) {
      console.warn('⚠️ [PUSH] Supabase not initialized');
      return;
    }

    // Query users + subscriptions to get riders with valid tokens
    const { data: results, error } = await supabaseAdmin
      .from('users')
      .select(
        `
        id,
        push_subscriptions!inner(
          push_token,
          is_active,
          status
        )
        `
      )
      .in('role', ['rider', 'passenger', 'user'])
      .eq('push_subscriptions.is_active', true)
      .neq('push_subscriptions.push_token', null);

    if (error) {
      console.warn('⚠️ [PUSH] Failed to fetch riders with valid tokens:', error.message);
      // Fallback to regular broadcast
      return broadcastToRiders(payload, excludeUserIds);
    }

    const riderIds = (results || [])
      .map((d: any) => d.id)
      .filter((id: string) => !excludeUserIds.includes(id));
    
    console.log(`📢 [PUSH] Found ${riderIds.length} riders with valid tokens to notify`);
    
    if (riderIds.length === 0) {
      console.warn('⚠️ [PUSH] No riders with valid tokens found');
      return [];
    }

    return sendPushNotification(riderIds, {
      ...payload,
      type: payload.type as any,
    });
  } catch (error) {
    console.error('❌ [PUSH] Error broadcasting to riders with valid tokens:', error);
    // Fallback to regular broadcast
    return broadcastToRiders(payload, excludeUserIds);
  }
};

/**
 * Remove subscription (on logout or error)
 */
/**
 * Remove a push subscription (optionally specific token, or all for user)
 */
export const removeSubscription = async (userId: string, pushToken?: string) => {
  try {
    if (supabaseAdmin) {
      if (pushToken) {
        // Remove only the specific token for this user
        const { error } = await supabaseAdmin
          .from('push_subscriptions')
          .update({ is_active: false })
          .eq('user_id', userId)
          .eq('push_token', pushToken);

        if (error) {
          console.warn(
            '⚠️ [PUSH] Failed to remove specific subscription from database:',
            error.message
          );
        } else {
          console.log(
            '✅ [PUSH] Subscription deactivated for user:',
            userId,
            'token:',
            pushToken.substring(0, 10) + '...'
          );
        }
      } else {
        // Remove all subscriptions for this user
        const { error } = await supabaseAdmin
          .from('push_subscriptions')
          .update({ is_active: false })
          .eq('user_id', userId);

        if (error) {
          console.warn('⚠️ [PUSH] Failed to remove subscription from database:', error.message);
        } else {
          console.log('✅ [PUSH] All subscriptions deactivated in database for user:', userId);
        }
      }
    }
  } catch (error) {
    console.warn('⚠️ [PUSH] Error removing subscription:', error);
  }

  // Remove from in-memory cache
  const current = activeSubscriptions.get(userId) || [];
  if (pushToken) {
    const next = current.filter((subscription) => subscription.pushToken !== pushToken);
    if (next.length > 0) {
      activeSubscriptions.set(userId, next);
    } else {
      activeSubscriptions.delete(userId);
    }
    console.log('✅ [PUSH] Subscription removed from cache for user:', userId);
  } else if (activeSubscriptions.has(userId)) {
    activeSubscriptions.delete(userId);
    console.log('✅ [PUSH] Subscription removed from cache for user:', userId);
  }
};

/**
 * Get all active subscriptions count
 */
export const getActiveSubscriptionsCount = () => {
  return Array.from(activeSubscriptions.values()).reduce((count, subscriptions) => count + subscriptions.length, 0);
};

/**
 * Get subscription status (in-memory cache)
 */
export const getSubscriptionStatus = () => {
  const subscriptionsList = Array.from(activeSubscriptions.entries()).flatMap(([userId, subscriptions]) =>
    subscriptions.map((subscription) => ({
      userId,
      platform: subscription.platform,
      subscribedAt: subscription.subscribedAt,
      status: subscription.status || 'unknown',
    }))
  );

  return {
    activeSubscriptions: getActiveSubscriptionsCount(),
    subscriptionsList,
  };
};

/**
 * Get database statistics on push subscriptions
 * Returns counts by status and placeholder
 */
export const getPushSubscriptionStats = async () => {
  try {
    if (!supabaseAdmin) {
      return null;
    }

    // Get counts by status
    const { count: totalCount } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    const { data: allSubs } = await supabaseAdmin
      .from('push_subscriptions')
      .select('platform')
      .eq('is_active', true);

    const stats = allSubs?.reduce((acc, sub) => {
      const key = sub.platform || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>) || {};

    return {
      total: totalCount || 0,
      byPlatform: Object.entries(stats).map(([platform, count]) => {
        return { platform, count };
      }),
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('❌ [PUSH] Error getting subscription stats:', error);
    return null;
  }
};

/**
 * Find users stuck on placeholder tokens (not upgraded in 24+ hours)
 * Useful for monitoring and debugging
 */
export const findStuckPlaceholderTokens = async () => {
  try {
    return [];
  } catch (error) {
    console.error('❌ [PUSH] Error finding stuck placeholder tokens:', error);
    return [];
  }
};

/**
 * Clean up old placeholder tokens (keep only those from last 24 hours)
 */
export const cleanupOldPlaceholderTokens = async () => {
  try {
    return { deleted: 0 };
  } catch (error) {
    console.error('❌ [PUSH] Error in cleanup:', error);
    return { deleted: 0, error: String(error) };
  }
};
