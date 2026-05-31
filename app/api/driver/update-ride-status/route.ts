import { NextRequest, NextResponse } from "next/server"
import { supabase, supabaseAdmin } from "@/lib/supabase"
import { getSessionFromRequest } from "@/lib/auth"
import { emitDriverArrived, emitRideCompleted, emitRideUpdate } from "@/lib/push-emitters"
import { sendPushNotification } from "@/lib/push-service"
import { cancelExpiredOpenRides, isRideExpired } from "@/lib/ride-expiry"

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { rideId, status } = body

    if (!rideId || !status) {
      return NextResponse.json(
        { error: "Ride ID and status are required" },
        { status: 400 }
      )
    }

    if (!["in_progress", "completed"].includes(status)) {
      return NextResponse.json(
        { error: "Invalid status" },
        { status: 400 }
      )
    }

    // Get driver
    const { data: driver, error: driverError } = await supabaseAdmin!
      .from("drivers")
      .select("id")
      .eq("user_id", session.user.id)
      .single()

    if (driverError || !driver) {
      console.error("[UpdateRideStatus] Driver not found:", driverError)
      return NextResponse.json(
        { error: "Driver profile not found" },
        { status: 404 }
      )
    }

    // Get ride
    const { data: ride, error: rideError } = await supabaseAdmin!
      .from("rides")
      .select("*")
      .eq("id", rideId)
      .single()

    if (rideError || !ride) {
      console.error("[UpdateRideStatus] Ride not found:", rideError)
      return NextResponse.json({ error: "Ride not found" }, { status: 404 })
    }

    if (isRideExpired(ride)) {
      await cancelExpiredOpenRides([rideId])
      return NextResponse.json(
        {
          error: "This ride expired at the end of its scheduled booking day and has been cancelled.",
          code: "ride_expired",
        },
        { status: 410 }
      )
    }

    // Verify driver is the one who accepted the ride
    if (ride.driver_id !== driver.id) {
      console.error("[UpdateRideStatus] Driver not authorized for this ride", {
        driverId: driver.id,
        rideDriverId: ride.driver_id,
      })
      return NextResponse.json(
        { error: "You are not assigned to this ride", code: "ride_not_assigned" },
        { status: 403 }
      )
    }

    // Verify ride status is valid for update
    if (status === "in_progress" && ride.status !== "accepted") {
      console.error("[UpdateRideStatus] Invalid status transition", {
        currentStatus: ride.status,
        requestedStatus: status,
      })
      return NextResponse.json(
        { error: "Ride must be accepted first" },
        { status: 409 }
      )
    }

    if (status === "completed" && ride.status !== "in_progress") {
      console.error("[UpdateRideStatus] Invalid status transition", {
        currentStatus: ride.status,
        requestedStatus: status,
      })
      return NextResponse.json(
        { error: "Ride must be in progress" },
        { status: 409 }
      )
    }

    // Ensure required fields exist for settlement calculation
    if (status === "completed") {
      // Set default values if not already set to ensure trigger can process settlement
      const fare = ride.fare_amount || 0;
      const platformFee = ride.platform_fee || Math.round(fare * 0.1); // 10% default
      const driverEarnings = ride.driver_earnings || (fare - platformFee);
      
      console.log("[UpdateRideStatus] Ride completion settlement data", {
        rideId,
        fare,
        platformFee,
        driverEarnings,
      });
    }

    // Update ride status
    const updateData: any = { 
      status,
      updated_at: new Date().toISOString(),
    }
    
    if (status === "in_progress") {
      updateData.pickup_time = new Date().toISOString()
    } else if (status === "completed") {
      const now = new Date().toISOString()
      updateData.dropoff_time = now
      updateData.completed_at = now  // For ride history/analytics (not used by settlement trigger)
      
      // Calculate duration if pickup_time exists
      if (ride.pickup_time) {
        const pickupTime = new Date(ride.pickup_time).getTime()
        const dropoffTime = new Date(now).getTime()
        const durationMinutes = Math.round((dropoffTime - pickupTime) / (1000 * 60))
        updateData.duration_minutes = Math.max(0, durationMinutes)
      }
      
      // Ensure settlement fields are set so trigger can use them (if any completion logic needed)
      if (!ride.fare_amount) updateData.fare_amount = 0;
      if (!ride.platform_fee) updateData.platform_fee = 0;
      if (!ride.driver_earnings) updateData.driver_earnings = 0;
      if (!ride.fare_amount) updateData.fare_amount = 0;
      if (!ride.platform_fee) updateData.platform_fee = 0;
      if (!ride.driver_earnings) updateData.driver_earnings = 0;
    }

    const { data: updatedRide, error: updateError } = await supabaseAdmin!
      .from("rides")
      .update(updateData)
      .eq("id", rideId)
      .select()
      .single()

    if (updateError || !updatedRide) {
      console.error("[UpdateRideStatus] Failed to update ride:", updateError)
      return NextResponse.json(
        { error: "Failed to update ride status" },
        { status: 500 }
      )
    }

    // Send push notifications based on status
    try {
      if (status === "in_progress") {
        // Driver arrived at pickup
        const { data: driverUser } = await supabaseAdmin!
          .from("users")
          .select("first_name, last_name, phone_number")
          .eq("id", session.user.id)
          .single()

        const driverName = driverUser 
          ? `${driverUser.first_name} ${driverUser.last_name}` 
          : "Your Driver"

        // WebSocket notifications
        await emitDriverArrived(
          ride.rider_id,
          rideId,
          driverName,
          "Keke Tricycle"
        )

        await emitRideUpdate(
          session.user.id,
          rideId,
          "status",
          `You started trip ${rideId.slice(0, 8)} from ${ride.pickup_zone} to ${ride.destination_zone}.`
        )

        await emitRideUpdate(
          ride.rider_id,
          rideId,
          "status",
          `Your ride is now in progress from ${ride.pickup_zone} to ${ride.destination_zone}.`
        )

        // Push notification to rider
        await sendPushNotification([ride.rider_id], {
          title: "🚗 Driver Arrived",
          body: `${driverName} is on the way to pick you up`,
          type: "ride_update",
          data: {
            rideId,
            status: "in_progress",
            driverName,
            pickup: ride.pickup_zone,
            destination: ride.destination_zone,
          },
        })

        // Push notification to driver
        await sendPushNotification([session.user.id], {
          title: "🚗 Trip Started",
          body: `Trip ${rideId.slice(0, 8)} started. Heading to ${ride.pickup_zone}`,
          type: "ride_update",
          data: {
            rideId,
            status: "in_progress",
            pickup: ride.pickup_zone,
            destination: ride.destination_zone,
          },
        })
      } else if (status === "completed") {
        // Ride completed - send completion notification to rider
        await emitRideCompleted(
          ride.rider_id,
          session.user.id,
          rideId,
          updatedRide.fare || 0,
          updatedRide.rating
        )

        await emitRideUpdate(
          session.user.id,
          rideId,
          "status",
          `Trip ${rideId.slice(0, 8)} completed successfully. Final fare: ₦${updatedRide.fare || 0}.`
        )

        // Push notification to rider
        await sendPushNotification([ride.rider_id], {
          title: "✅ Ride Completed",
          body: `Trip completed. Fare: ₦${updatedRide.fare || 0}`,
          type: "ride_update",
          data: {
            rideId,
            status: "completed",
            fare: updatedRide.fare || 0,
          },
        })

        // Push notification to driver
        await sendPushNotification([session.user.id], {
          title: "✅ Ride Complete",
          body: `Trip ${rideId.slice(0, 8)} completed. Total fare: ₦${updatedRide.fare || 0}`,
          type: "ride_update",
          data: {
            rideId,
            status: "completed",
            fare: updatedRide.fare || 0,
          },
        })
      }
    } catch (notificationError) {
      console.error("Failed to send status notifications:", notificationError)
      // Don't fail the entire request if notifications fail
    }

    return NextResponse.json({
      success: true,
      ride: updatedRide,
    })
  } catch (error) {
    console.error("Update ride status error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
