import { supabaseAdmin } from "@/lib/supabase"
import { sendPushNotification } from "@/lib/push-service"

export function getRideExpiry(ride: any): Date | null {
  const raw = ride?.pickup_time || ride?.scheduled_at || ride?.booking_time || ride?.created_at
  if (!raw) return null

  const scheduled = new Date(raw)
  if (Number.isNaN(scheduled.getTime())) return null

  const end = new Date(scheduled)
  end.setHours(23, 59, 59, 999)
  return end
}

export function isRideExpired(ride: any, now = new Date()) {
  const expiry = getRideExpiry(ride)
  return !!expiry && expiry.getTime() < now.getTime()
}

export async function cancelExpiredOpenRides(rideIds?: string[]) {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client not initialized")
  }

  let query = supabaseAdmin
    .from("rides")
    .select("id, rider_id, status, pickup_time, pickup_zone, destination_zone")
    .in("status", ["pending", "dispatched", "accepted", "in_progress"])

  if (rideIds?.length) {
    query = query.in("id", rideIds)
  }

  const { data: rides, error } = await query
  if (error) throw error

  const expired = (rides || []).filter((ride) => isRideExpired(ride))
  if (!expired.length) return []

  const expiredIds = expired.map((ride) => ride.id)
  const now = new Date().toISOString()

  const { error: updateError } = await supabaseAdmin
    .from("rides")
    .update({
      status: "cancelled",
      cancellation_reason: "No available drivers accepted or completed this ride before the scheduled day ended.",
      updated_at: now,
    })
    .in("id", expiredIds)
    .in("status", ["pending", "dispatched", "accepted", "in_progress"])

  if (updateError) throw updateError

  const riderIds = Array.from(new Set(expired.map((ride) => ride.rider_id).filter(Boolean)))
  if (riderIds.length) {
    await sendPushNotification(riderIds, {
      title: "Ride Cancelled",
      body: "Your scheduled ride was cancelled because no driver was available in time. Please book again.",
      type: "ride_update",
      data: {
        rideIds: expiredIds,
        deeplink: expiredIds.length === 1 ? `/rider/ride-details?rideId=${expiredIds[0]}` : "/rider/rides-history",
        event_type: "ride_cancelled",
        reason: "no_driver_before_day_end",
      },
    }).catch((pushError) => {
      console.error("[RideExpiry] Failed to notify riders:", pushError)
    })
  }

  return expired
}
