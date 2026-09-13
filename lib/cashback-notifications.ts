import { supabaseAdmin } from "./supabase"
import { sendPushNotification } from "./push-service"

/**
 * Send push notification for cashback reward earned
 */
export async function sendCashbackRewardNotification(userId: string, reward: any) {
  try {
    let title = "💰 Cashback Reward Earned!"
    let body = `You earned ${reward.discount_percentage}% cashback. Use it on your next ride!`
    
    // Customize message based on program type
    if (reward.cashback_programs?.program_type === 'first_ride') {
      title = "🎉 First Ride Bonus Earned!"
      body = "Congratulations! You earned 10% off your first ride. Use it on your next booking!"
    } else if (reward.cashback_programs?.program_type === 'spin_wheel') {
      title = "🎰 Spin Wheel Reward Won!"
      body = `You won ${reward.discount_percentage}% off your next ride! Use it before it expires.`
    }

    await sendPushNotification([userId], {
      title,
      body,
      type: "cashback",
      categoryId: "cashback",
      imageUrl: "https://example.com/cashback-icon.png",
      data: {
        rewardId: reward.id,
        programId: reward.program_id,
        discountPercentage: reward.discount_percentage,
        discountAmount: reward.discount_amount,
        expiresAt: reward.expires_at,
        deeplink: "/rider/cashback",
      },
    })

    console.log(`[CashbackNotifications] Push notification sent to user ${userId} for reward ${reward.id}`)
  } catch (error) {
    console.error("[CashbackNotifications] Failed to send push notification:", error)
  }
}

/**
 * Send push notification for spin wheel result
 */
export async function sendSpinWheelNotification(userId: string, spinResult: any) {
  try {
    if (spinResult.status !== 'won' || spinResult.discount_percentage <= 0) {
      return // Don't send notification for try again
    }

    const title = "🎰 Spin Wheel Result!"
    const body = `You won ${spinResult.discount_percentage}% off your next ride! Check your cashback rewards.`

    await sendPushNotification([userId], {
      title,
      body,
      type: "cashback",
      categoryId: "cashback",
      imageUrl: "https://example.com/spin-wheel-icon.png",
      data: {
        spinResultId: spinResult.id,
        programId: spinResult.program_id,
        discountPercentage: spinResult.discount_percentage,
        displayedResult: spinResult.displayed_result,
        deeplink: "/rider/cashback",
      },
    })

    console.log(`[CashbackNotifications] Spin wheel push notification sent to user ${userId}`)
  } catch (error) {
    console.error("[CashbackNotifications] Failed to send spin wheel notification:", error)
  }
}

/**
 * Send push notification for expiring cashback
 */
export async function sendExpiringCashbackNotification(userId: string, reward: any) {
  try {
    const title = "⏰ Cashback Expiring Soon!"
    const body = `Your ${reward.discount_percentage}% cashback reward expires in less than 24 hours. Use it before it's gone!`

    await sendPushNotification([userId], {
      title,
      body,
      type: "cashback",
      categoryId: "cashback",
      data: {
        rewardId: reward.id,
        programId: reward.program_id,
        discountPercentage: reward.discount_percentage,
        expiresAt: reward.expires_at,
        deeplink: "/rider/cashback",
      },
    })

    console.log(`[CashbackNotifications] Expiry notification sent to user ${userId} for reward ${reward.id}`)
  } catch (error) {
    console.error("[CashbackNotifications] Failed to send expiry notification:", error)
  }
}

/**
 * Send push notification for expired cashback
 */
export async function sendExpiredCashbackNotification(userId: string, reward: any) {
  try {
    const title = "⚠️ Cashback Expired"
    const body = `Your ${reward.discount_percentage}% cashback reward has expired. Complete more rides to earn new rewards!`

    await sendPushNotification([userId], {
      title,
      body,
      type: "cashback",
      categoryId: "cashback",
      data: {
        rewardId: reward.id,
        programId: reward.program_id,
        discountPercentage: reward.discount_percentage,
        deeplink: "/rider/cashback",
      },
    })

    console.log(`[CashbackNotifications] Expired notification sent to user ${userId} for reward ${reward.id}`)
  } catch (error) {
    console.error("[CashbackNotifications] Failed to send expired notification:", error)
  }
}

/**
 * Send push notification for cashback used
 */
export async function sendCashbackUsedNotification(userId: string, reward: any) {
  try {
    const title = "✅ Cashback Applied"
    const body = `Your ${reward.discount_percentage}% cashback has been applied to your ride. You saved ₦${reward.discount_amount}!`

    await sendPushNotification([userId], {
      title,
      body,
      type: "cashback",
      categoryId: "cashback",
      data: {
        rewardId: reward.id,
        programId: reward.program_id,
        discountPercentage: reward.discount_percentage,
        discountAmount: reward.discount_amount,
        rideId: reward.ride_id,
        deeplink: "/rider/rides-history",
      },
    })

    console.log(`[CashbackNotifications] Cashback used notification sent to user ${userId}`)
  } catch (error) {
    console.error("[CashbackNotifications] Failed to send cashback used notification:", error)
  }
}

/**
 * Setup Supabase realtime subscription for cashback notifications
 * This will trigger push notifications when database notifications are created
 */
export function setupCashbackNotificationListeners() {
  // Listen for new cashback rewards
  const cashbackRewardChannel = supabaseAdmin
    .channel('cashback-rewards-notifications')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'user_cashback_rewards',
      },
      async (payload) => {
        const reward = payload.new
        console.log('[CashbackNotifications] New cashback reward earned:', reward.id)
        
        // Fetch full reward with program details
        const { data: fullReward } = await supabaseAdmin
          .from('user_cashback_rewards')
          .select('*, cashback_programs(*)')
          .eq('id', reward.id)
          .single()
        
        if (fullReward) {
          await sendCashbackRewardNotification(reward.user_id, fullReward)
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'user_cashback_rewards',
        filter: 'status=eq.used',
      },
      async (payload) => {
        const reward = payload.new
        console.log('[CashbackNotifications] Cashback reward used:', reward.id)
        await sendCashbackUsedNotification(reward.user_id, reward)
      }
    )
    .subscribe()

  // Listen for spin wheel results
  const spinWheelChannel = supabaseAdmin
    .channel('spin-wheel-notifications')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'spin_wheel_results',
      },
      async (payload) => {
        const spinResult = payload.new
        console.log('[CashbackNotifications] New spin wheel result:', spinResult.id)
        await sendSpinWheelNotification(spinResult.user_id, spinResult)
      }
    )
    .subscribe()

  console.log('[CashbackNotifications] Realtime listeners setup complete')

  return {
    cashbackRewardChannel,
    spinWheelChannel,
  }
}

/**
 * Check for expiring cashback rewards and send notifications
 * This should be called periodically (e.g., every hour)
 */
export async function checkExpiringCashbackRewards() {
  try {
    // Find rewards expiring in 24 hours that haven't been notified
    const { data: expiringRewards, error } = await supabaseAdmin
      .from('user_cashback_rewards')
      .select('*')
      .eq('status', 'earned')
      .gt('expires_at', new Date().toISOString())
      .lte('expires_at', new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())
      .eq('expiry_notification_sent', false)

    if (error) {
      console.error('[CashbackNotifications] Failed to fetch expiring rewards:', error)
      return
    }

    for (const reward of expiringRewards || []) {
      await sendExpiringCashbackNotification(reward.user_id, reward)
      
      // Mark notification as sent
      await supabaseAdmin
        .from('user_cashback_rewards')
        .update({ expiry_notification_sent: true })
        .eq('id', reward.id)
    }

    console.log(`[CashbackNotifications] Sent ${expiringRewards?.length || 0} expiry notifications`)
  } catch (error) {
    console.error('[CashbackNotifications] Failed to check expiring rewards:', error)
  }
}

/**
 * Mark expired cashback rewards and notify users
 * This should be called periodically (e.g., daily)
 */
export async function markExpiredCashbackRewards() {
  try {
    // Find expired rewards
    const { data: expiredRewards, error } = await supabaseAdmin
      .from('user_cashback_rewards')
      .select('*')
      .eq('status', 'earned')
      .lt('expires_at', new Date().toISOString())

    if (error) {
      console.error('[CashbackNotifications] Failed to fetch expired rewards:', error)
      return
    }

    for (const reward of expiredRewards || []) {
      // Update status to expired
      await supabaseAdmin
        .from('user_cashback_rewards')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('id', reward.id)

      // Send notification
      await sendExpiredCashbackNotification(reward.user_id, reward)
    }

    console.log(`[CashbackNotifications] Marked ${expiredRewards?.length || 0} rewards as expired`)
  } catch (error) {
    console.error('[CashbackNotifications] Failed to mark expired rewards:', error)
  }
}