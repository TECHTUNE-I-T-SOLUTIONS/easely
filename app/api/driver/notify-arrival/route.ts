import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getSessionFromRequest } from "@/lib/auth"
import { emitDriverArrived } from "@/lib/push-emitters"
import { sendPushNotification } from "@/lib/push-service"
import { requireVerifiedDriver } from "@/lib/driver-verification"

/**
 * Driver "I've Arrived" event.
 *
 * This is a NOTIFICATION-ONLY endpoint. It does NOT change the ride status
 * (the DB only models accepted -> in_progress -> completed, and "arrived" is a
 * moment in time between "accepted" and "in_progress", not a persisted state).
 *
 * Fixes the previous conflation bug where the driver pressing "I've Arrived"
 * and "Start Ride" both mapped to the single `in_progress` transition, causing
 * the rider to receive a contradictory "Driver Arrived — is on the way" push.
 *
 * Flow:
 *   - Driver accepts        -> "Driver Accepted"  (accept-ride route)
 *   - Driver arrives        -> "Driver Arrived"   (THIS route, no status change)
 *   - Driver starts trip    -> "Trip Started"     (update-ride-status in_progress)
 *   - Driver completes trip -> "Ride Completed"   (update-ride-status completed)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { rideId } = body

    if (!rideId) {
      return NextResponse.json({ error: "Ride ID is required" }, { status: 400 })
    }

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
      .select("id, plate_number, vehicle_picture_url")
      .eq("user_id", session.user.id)
      .single()

    if (driverError || !driver) {
      return NextResponse.json({ error: "Driver profile not found" }, { status: 404 })
    }

    // Get ride
    const { data: ride, error: rideError } = await supabaseAdmin!
      .from("rides")
      .select("id, rider_id, driver_id, status, pickup_zone, destination_zone")
      .eq("id", rideId)
      .single()

    if (rideError || !ride) {
      return NextResponse.json({ error: "Ride not found" }, { status: 404 })
    }

    // Verify this driver owns the ride
    if (ride.driver_id !== driver.id) {
      return NextResponse.json(
        { error: "You are not assigned to this ride", code: "ride_not_assigned" },
        { status: 403 }
      )
    }

    // Arrival only makes sense once the ride is accepted and before it's in progress.
    if (ride.status !== "accepted") {
      return NextResponse.json(
        {
          error: "You can only mark arrival on an accepted ride",
          code: "invalid_status_for_arrival",
          currentStatus: ride.status,
        },
        { status: 409 }
      )
    }

    // Resolve driver display name
    const { data: driverUser } = await supabaseAdmin!
      .from("users")
      .select("first_name, last_name")
      .eq("id", session.user.id)
      .single()

    const driverName = driverUser
      ? `${driverUser.first_name} ${driverUser.last_name}`.trim()
      : "Your driver"

    const vehicleDetails = driver.plate_number
      ? `Keke Tricycle · ${driver.plate_number}`
      : "Keke Tricycle"

    // Realtime/WebSocket emitter (best-effort)
    await emitDriverArrived(ride.rider_id, rideId, driverName, vehicleDetails).catch((e) =>
      console.error("[NotifyArrival] emitDriverArrived failed:", e)
    )

    // Push notification to the rider ONLY (this is a rider-facing event)
    await sendPushNotification([ride.rider_id], {
      title: "📍 Driver Arrived",
      body: `${driverName} has arrived at ${ride.pickup_zone}. Please head to the pickup point.`,
      type: "driver_arrived",
      data: {
        rideId,
        status: ride.status,
        driverName,
        vehicleDetails,
        pickup: ride.pickup_zone,
        destination: ride.destination_zone,
        deeplink: `/rider/active-ride?rideId=${rideId}`,
      },
    }).catch((e) => console.error("[NotifyArrival] rider push failed:", e))

    return NextResponse.json({ success: true, rideId, event: "driver_arrived" })
  } catch (error) {
    console.error("Notify arrival error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
