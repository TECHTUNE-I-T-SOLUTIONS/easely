import { supabaseAdmin } from "./supabase"
import { sendPushNotification } from "./push-service"

/**
 * Check for unaccepted ride requests and send follow-up notifications
 * This should be run periodically (e.g., every 30 seconds) to handle rides
 * that haven't been accepted within a certain time window
 */
export async function checkUnacceptedRides() {
  try {
    // Find rides that are still pending or dispatched after 2 minutes
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    
    const { data: unacceptedRides, error } = await supabaseAdmin
      .from("rides")
      .select(`
        id,
        pickup_zone,
        pickup_description,
        destination_zone,
        destination_description,
        fare,
        estimated_distance,
        created_at,
        status,
        ride_dispatch_logs (
          driver_id,
          created_at
        )
      `)
      .in("status", ["pending", "dispatched"])
      .lt("created_at", twoMinutesAgo)
      .is("driver_id", null)
      .limit(50)

    if (error) {
      console.error("[RideFollowUp] Failed to fetch unaccepted rides:", error)
      return
    }

    if (!unacceptedRides || unacceptedRides.length === 0) {
      console.log("[RideFollowUp] No unaccepted rides found")
      return
    }

    console.log(`[RideFollowUp] Found ${unacceptedRides.length} unaccepted rides`)

    for (const ride of unacceptedRides) {
      // Get drivers who were already notified
      const notifiedDriverIds = (ride.ride_dispatch_logs || []).map((log: any) => log.driver_id)
      
      // Find new drivers to notify (exclude those already notified)
      const { data: newDrivers } = await supabaseAdmin
        .from("drivers")
        .select("id, user_id")
        .contains("operating_zones", [ride.pickup_zone])
        .eq("availability_status", "online")
        .eq("verified", true)
        .not("id", "in", `(${notifiedDriverIds.join(",")})`)
        .limit(5)

      if (newDrivers && newDrivers.length > 0) {
        const driverUserIds = newDrivers.map((driver: any) => driver.user_id)
        
        // Send follow-up notification to new drivers
        await sendPushNotification(driverUserIds, {
          title: "🚗 Ride Request Available",
          body: `Pickup: ${ride.pickup_description || ride.pickup_zone} | Fare: ₦${Number(ride.fare).toLocaleString()}`,
          type: "ride_request",
          categoryId: "ride_request_action",
          imageUrl: "https://example.com/ride-request-icon.png",
          actions: [
            {
              id: "accept_ride",
              title: "Accept",
              action: "accept",
            },
            {
              id: "reject_ride",
              title: "Reject",
              action: "reject",
            },
          ],
          data: {
            rideId: ride.id,
            pickup: ride.pickup_description || ride.pickup_zone,
            destination: ride.destination_description || ride.destination_zone,
            fare: ride.fare,
            distance: ride.estimated_distance,
            deeplink: `/driver/ride-details?rideId=${ride.id}`,
            action: "accept_ride",
            isFollowUp: true,
          },
        })

        // Log the dispatch
        for (const driver of newDrivers) {
          await supabaseAdmin
            .from("ride_dispatch_logs")
            .insert({
              ride_id: ride.id,
              driver_id: driver.id,
              dispatch_method: "push_follow_up",
              created_at: new Date().toISOString(),
            })
        }

        console.log(`[RideFollowUp] Follow-up sent to ${driverUserIds.length} new drivers for ride ${ride.id}`)
      } else {
        // No new drivers available, escalate to admin
        console.log(`[RideFollowUp] No new drivers available for ride ${ride.id}, escalating to admin`)
        
        // Could send notification to admin team here
        // For now, just log
      }

      // If ride has been pending for more than 5 minutes, cancel it
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      if (ride.created_at < fiveMinutesAgo) {
        await supabaseAdmin
          .from("rides")
          .update({
            status: "cancelled",
            cancellation_reason: "No drivers available",
            cancelled_at: new Date().toISOString(),
          })
          .eq("id", ride.id)

        console.log(`[RideFollowUp] Cancelled ride ${ride.id} due to no drivers available`)
      }
    }
  } catch (error) {
    console.error("[RideFollowUp] Error:", error)
  }
}

/**
 * Run the follow-up check (intended to be called by a cron job or scheduled task)
 */
export async function runRideFollowUp() {
  console.log("[RideFollowUp] Starting follow-up check")
  await checkUnacceptedRides()
  console.log("[RideFollowUp] Follow-up check completed")
}