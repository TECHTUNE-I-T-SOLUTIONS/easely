import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { sendPushNotification } from "@/lib/push-service"
import { scheduleRideAcceptedNotifications } from "@/lib/ride-accepted-notifications"

// Notifications are dispatched in `after()`, sharing this route's time budget.
export const maxDuration = 60

// POST - Handle push notification actions (accept/reject ride)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, rideId, driverId, userId } = body

    if (!action || !rideId || !driverId) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 })
    }

    // Verify the ride exists and is still pending
    const { data: ride, error: rideError } = await supabaseAdmin
      .from("rides")
      .select("*")
      .eq("id", rideId)
      .single()

    if (rideError || !ride) {
      return NextResponse.json({ error: "Ride not found" }, { status: 404 })
    }

    if (ride.status !== "pending") {
      return NextResponse.json({ error: "Ride is no longer available" }, { status: 400 })
    }

    if (action === "accept") {
      // Check if ride already has a driver
      if (ride.driver_id) {
        // Send notification to this driver that ride is already taken
        await sendPushNotification([driverId], {
          title: "Ride Already Accepted",
          body: "This ride has been accepted by another driver",
          type: "ride_update",
          data: {
            rideId: ride.id,
            action: "already_accepted",
          },
        })
        return NextResponse.json({ success: false, message: "Ride already accepted by another driver" })
      }

      // Accept the ride
      const { error: updateError } = await supabaseAdmin
        .from("rides")
        .update({
          driver_id: driverId,
          status: "accepted",
          accepted_at: new Date().toISOString(),
        })
        .eq("id", rideId)

      if (updateError) throw updateError

      // Log the dispatch
      await supabaseAdmin
        .from("ride_dispatch_logs")
        .insert({
          ride_id: rideId,
          driver_id: driverId,
          dispatch_method: "push",
          response: "accepted",
          response_time: 0,
        })

      // Riders must learn the ride was accepted no matter which surface the driver
      // tapped: this route dispatches the same SMS, email, push and live-tracking
      // bundle as the app's accept-ride route. Idempotent, so a duplicate tap is safe.
      try {
        const { data: driverProfile } = await supabaseAdmin
          .from("drivers")
          .select("user_id")
          .eq("id", driverId)
          .maybeSingle()

        const driverUserId = driverProfile?.user_id || userId

        if (driverUserId) {
          scheduleRideAcceptedNotifications({
            ride: { ...ride, driver_id: driverId, status: "accepted" },
            driverId,
            driverUserId,
            source: "app",
          })
        } else {
          console.warn("[DriverPushAction] Accepting driver has no user id, skipping notifications", {
            rideId,
            driverId,
          })
        }
      } catch (notifyError) {
        console.error("[DriverPushAction] Failed to schedule ride notifications:", notifyError)
      }

      // The shared bundle above already sends the driver's own "ride accepted"
      // confirmation to their user id. The old push here targeted drivers.id (which
      // sendPushNotification reads as a user id), so it never reached anyone.
      return NextResponse.json({ success: true, message: "Ride accepted successfully", rideId: ride.id })
    }

    if (action === "reject") {
      // Log the rejection
      await supabaseAdmin
        .from("ride_dispatch_logs")
        .insert({
          ride_id: rideId,
          driver_id: driverId,
          dispatch_method: "push",
          response: "rejected",
          response_time: 0,
        })

      return NextResponse.json({ success: true, message: "Ride rejected" })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (error: any) {
    console.error("[DriverPushAction] Error:", error)
    return NextResponse.json({ error: error.message || "Failed to process action" }, { status: 500 })
  }
}