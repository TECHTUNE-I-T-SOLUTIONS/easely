import { NextRequest, NextResponse } from "next/server"
import { supabase, supabaseAdmin } from "@/lib/supabase"
import { getSessionFromRequest } from "@/lib/auth"
import { notifyAdmins } from "@/lib/admin-notifications"
import { emitRideCompleted, emitRideUpdate } from "@/lib/push-emitters"
import { sendPushNotification } from "@/lib/push-service"
import { cancelExpiredOpenRides, isRideExpired } from "@/lib/ride-expiry"
import { requireVerifiedDriver } from "@/lib/driver-verification"

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { rideId, status, eta_minutes } = body

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

    const parsedEtaMinutes = Number.isFinite(Number(eta_minutes)) && Number(eta_minutes) > 0
      ? Math.round(Number(eta_minutes))
      : null

    const verification = await requireVerifiedDriver(session.user.id)
    if (!verification.allowed) {
      return NextResponse.json(
        { error: verification.message, code: verification.code, driver: verification.driver },
        { status: verification.status }
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
          error: "This ride already passed its scheduled day and has been resolved.",
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
    if (status === "in_progress" && ride.status === "in_progress") {
      return NextResponse.json({
        success: true,
        ride,
        alreadyUpdated: true,
        message: "Ride is already in progress",
      })
    }

    if (status === "completed" && ride.status === "completed") {
      return NextResponse.json({
        success: true,
        ride,
        alreadyUpdated: true,
        message: "Ride is already completed",
      })
    }

    if (status === "in_progress" && ride.status !== "accepted") {
      console.error("[UpdateRideStatus] Invalid status transition", {
        currentStatus: ride.status,
        requestedStatus: status,
      })
      return NextResponse.json(
        { error: "Ride must be accepted first", currentStatus: ride.status, ride },
        { status: 409 }
      )
    }

    if (status === "completed" && ride.status !== "in_progress") {
      console.error("[UpdateRideStatus] Invalid status transition", {
        currentStatus: ride.status,
        requestedStatus: status,
      })
      return NextResponse.json(
        { error: "Ride must be in progress", currentStatus: ride.status, ride },
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

    if (parsedEtaMinutes && status !== "completed") {
      updateData.eta_minutes = parsedEtaMinutes
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

    if (status === "completed") {
      try {
        const completedDistanceKm = Number(updatedRide.distance_km || ride.distance_km || 0)
        const completedMinutes = Number(
          updatedRide.duration_minutes ||
          updateData.duration_minutes ||
          updatedRide.eta_minutes ||
          ride.eta_minutes ||
          0
        )
        const safeDistanceKm = completedDistanceKm > 0 ? completedDistanceKm : 0
        const safeMinutes = completedMinutes > 0 ? completedMinutes : 0
        const completedRouteKey = `${String(ride.pickup_zone || "").trim().toLowerCase()}->${String(ride.destination_zone || "").trim().toLowerCase()}`
        const { data: existingMetric } = await supabaseAdmin!
          .from("route_metrics")
          .select("id, ride_count, avg_minutes_per_km")
          .eq("route_key", completedRouteKey)
          .maybeSingle()

        const previousCount = Number(existingMetric?.ride_count || 0)
        const previousAverage = Number(existingMetric?.avg_minutes_per_km || 0)
        const newAverage =
          safeDistanceKm > 0 && safeMinutes > 0
            ? previousCount > 0
              ? ((previousAverage * previousCount) + (safeMinutes / safeDistanceKm)) / (previousCount + 1)
              : safeMinutes / safeDistanceKm
            : previousAverage || 6

        const { error: metricsError } = await supabaseAdmin!
          .from("route_metrics")
          .upsert({
            route_key: completedRouteKey,
            pickup_label: ride.pickup_zone || null,
            destination_label: ride.destination_zone || null,
            ride_count: previousCount + 1,
            avg_minutes_per_km: Number.isFinite(newAverage) ? Number(newAverage.toFixed(2)) : 6,
            last_estimated_minutes: Number(ride.eta_minutes || null),
            last_actual_minutes: safeMinutes || null,
            last_distance_km: safeDistanceKm || null,
            updated_at: new Date().toISOString(),
          }, { onConflict: "route_key" })

        if (metricsError) {
          console.error("[UpdateRideStatus] Failed to persist route metrics:", metricsError)
        }
      } catch (metricsError) {
        console.error("[UpdateRideStatus] Route metrics learning write failed:", metricsError)
      }
    }

    // Send push notifications based on status
    try {
      if (status === "in_progress") {
        // Trip has STARTED (rider is on board and moving to the destination).
        // NOTE: "Driver arrived" is a separate, notification-only event handled by
        // POST /api/driver/notify-arrival. Do NOT send an arrival push here or the
        // rider gets a contradictory "arrived / on the way" message.
        const { data: driverUser } = await supabaseAdmin!
          .from("users")
          .select("first_name, last_name, phone_number")
          .eq("id", session.user.id)
          .single()

        const driverName = driverUser
          ? `${driverUser.first_name} ${driverUser.last_name}`
          : "Your Driver"

        // WebSocket / realtime status updates
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
          `Your trip is now in progress from ${ride.pickup_zone} to ${ride.destination_zone}.`
        )

        // Push notification to rider
        await sendPushNotification([ride.rider_id], {
          title: "🚕 Trip Started",
          body: `You're on your way from ${ride.pickup_zone} to ${ride.destination_zone}.`,
          type: "trip_started",
          data: {
            rideId,
            status: "in_progress",
            driverName,
            pickup: ride.pickup_zone,
            destination: ride.destination_zone,
            deeplink: `/rider/active-ride?rideId=${rideId}`,
          },
        })

        // Push notification to driver
        await sendPushNotification([session.user.id], {
          title: "🚕 Trip Started",
          body: `Trip ${rideId.slice(0, 8)} started. Heading to ${ride.destination_zone}`,
          type: "trip_started",
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

    await notifyAdmins({
      allAdmins: true,
      department: "ops",
      title: status === "completed" ? "Ride completed" : "Ride started",
      body: `Ride ${rideId.slice(0, 8)} is now ${status.replace("_", " ")} from ${ride.pickup_zone} to ${ride.destination_zone}.`,
      type: status === "completed" ? "ride_completed" : "ride_started",
      actionUrl: `/admin/rides?ride=${rideId}`,
      metadata: { rideId, riderId: ride.rider_id, driverUserId: session.user.id, status },
      sourceEventId: `ride_status:${rideId}:${status}`,
    }).catch((notifyError) => console.error("[UpdateRideStatus] Admin notification failed:", notifyError))

    return NextResponse.json({
      success: true,
      ride: updatedRide,
      eta_minutes: updatedRide.eta_minutes ?? parsedEtaMinutes ?? null,
    })
  } catch (error) {
    console.error("Update ride status error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
