import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { sendPushNotification } from "@/lib/push-service"

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

      // Send confirmation notification to the driver
      await sendPushNotification([driverId], {
        title: "Ride Accepted",
        body: "You have accepted the ride. View details to proceed.",
        type: "ride_accepted",
        data: {
          rideId: ride.id,
          action: "accepted",
          deeplink: `/driver/ride-details/${ride.id}`,
        },
        imageUrl: "https://example.com/ride-accepted-icon.png",
        actions: [
          {
            id: "view_details",
            title: "View Details",
            action: "view_ride_details",
          },
        ],
      })

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