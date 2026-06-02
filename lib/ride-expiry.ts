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
    .select("id, rider_id, driver_id, status, pickup_time, pickup_zone, destination_zone")
    .in("status", ["pending", "dispatched", "accepted", "in_progress"])

  if (rideIds?.length) {
    query = query.in("id", rideIds)
  }

  const { data: rides, error } = await query
  if (error) throw error

  const expired = (rides || []).filter((ride) => isRideExpired(ride))
  if (!expired.length) return []

  const expiredOpen = expired.filter((ride) => ["pending", "dispatched"].includes(ride.status))
  const expiredActive = expired.filter((ride) => ["accepted", "in_progress"].includes(ride.status))
  const cancelledIds = expiredOpen.map((ride) => ride.id)
  const completedIds = expiredActive.map((ride) => ride.id)
  const now = new Date().toISOString()

  if (cancelledIds.length) {
    const { error: cancelError } = await supabaseAdmin
      .from("rides")
      .update({
        status: "cancelled",
        cancellation_reason: "No available drivers accepted this ride before the scheduled day ended.",
        updated_at: now,
      })
      .in("id", cancelledIds)
      .in("status", ["pending", "dispatched"])

    if (cancelError) throw cancelError
  }

  if (completedIds.length) {
    const { error: completeError } = await supabaseAdmin
      .from("rides")
      .update({
        status: "completed",
        dropoff_time: now,
        completed_at: now,
        updated_at: now,
      })
      .in("id", completedIds)
      .in("status", ["accepted", "in_progress"])

    if (completeError) throw completeError
  }

  const cancelledRiderIds = Array.from(new Set(expiredOpen.map((ride) => ride.rider_id).filter(Boolean)))
  if (cancelledRiderIds.length) {
    await sendPushNotification(cancelledRiderIds, {
      title: "Ride Cancelled",
      body: "Your ride was cancelled because no driver accepted it before the scheduled day ended. Please book again when you are ready.",
      type: "ride_cancelled",
      data: {
        rideIds: cancelledIds,
        deeplink: cancelledIds.length === 1 ? `/rider/ride-details?rideId=${cancelledIds[0]}` : "/rider/rides-history",
        event_type: "ride_cancelled",
        reason: "no_driver_before_day_end",
      },
    }).catch((pushError) => {
      console.error("[RideExpiry] Failed to notify riders:", pushError)
    })
  }

  const completedRiderIds = Array.from(new Set(expiredActive.map((ride) => ride.rider_id).filter(Boolean)))
  if (completedRiderIds.length) {
    await sendPushNotification(completedRiderIds, {
      title: "Ride Completed",
      body: "Your ride was automatically marked completed because the scheduled day ended.",
      type: "ride_update",
      data: {
        rideIds: completedIds,
        deeplink: completedIds.length === 1 ? `/rider/ride-details?rideId=${completedIds[0]}` : "/rider/rides-history",
        event_type: "ride_completed",
        reason: "accepted_ride_day_end",
      },
    }).catch((pushError) => {
      console.error("[RideExpiry] Failed to notify riders about completed rides:", pushError)
    })
  }

  const completedDriverIds = Array.from(new Set(expiredActive.map((ride) => ride.driver_id).filter(Boolean)))
  if (completedDriverIds.length) {
    const { data: driverUsers, error: driverUsersError } = await supabaseAdmin
      .from("drivers")
      .select("id, user_id")
      .in("id", completedDriverIds)

    if (driverUsersError) {
      console.error("[RideExpiry] Failed to resolve completed ride driver users:", driverUsersError)
    } else {
      const driverUserIds = Array.from(new Set((driverUsers || []).map((driver: any) => driver.user_id).filter(Boolean)))
      if (driverUserIds.length) {
        await sendPushNotification(driverUserIds, {
          title: "Ride Completed",
          body: "An accepted ride was automatically marked completed because the scheduled day ended.",
          type: "ride_update",
          data: {
            rideIds: completedIds,
            deeplink: completedIds.length === 1 ? `/driver/ride-details?rideId=${completedIds[0]}` : "/driver/rides",
            event_type: "ride_completed",
            reason: "accepted_ride_day_end",
          },
        }).catch((pushError) => {
          console.error("[RideExpiry] Failed to notify drivers about completed rides:", pushError)
        })
      }
    }
  }

  return expired
}
