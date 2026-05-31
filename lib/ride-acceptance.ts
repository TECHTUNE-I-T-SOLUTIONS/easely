import { supabaseAdmin } from "@/lib/supabase"
import { emitRideAccepted, emitRideTaken } from "@/lib/push-emitters"
import { sendRideAcceptanceSMS } from "@/lib/termii"
import { cancelExpiredOpenRides } from "@/lib/ride-expiry"

export type RideAcceptanceSource = "app" | "sms"

interface AcceptRideInput {
  rideId: string
  driverUserId: string
  source: RideAcceptanceSource
}

interface AcceptRideResult {
  success: boolean
  status: number
  code: "accepted" | "ride_not_found" | "driver_not_found" | "ride_unavailable" | "ride_expired" | "internal_error"
  message: string
  ride?: any
}

export async function acceptRideFirstCome(input: AcceptRideInput): Promise<AcceptRideResult> {
  try {
    console.log("[RideAcceptance] Attempting to accept ride:", input)

    if (!supabaseAdmin) {
      return {
        success: false,
        status: 500,
        code: "internal_error",
        message: "Database client not initialized",
      }
    }

    // Get driver profile
    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id, user_id")
      .eq("user_id", input.driverUserId)
      .single()

    if (driverError || !driver) {
      console.error("[RideAcceptance] Driver not found:", driverError)
      return {
        success: false,
        status: 404,
        code: "driver_not_found",
        message: "Driver profile not found",
      }
    }

    console.log("[RideAcceptance] Driver found:", driver.id)

    const now = new Date().toISOString()
    const expired = await cancelExpiredOpenRides([input.rideId])
    if (expired.length > 0) {
      return {
        success: false,
        status: 410,
        code: "ride_expired",
        message: "This ride expired at the end of its scheduled booking day and has been cancelled.",
      }
    }

    // Update ride with driver acceptance
    // Only update if ride is in pending or dispatched state and has no driver assigned
    const { data: updatedRide, error: updateError } = await supabaseAdmin
      .from("rides")
      .update({
        driver_id: driver.id,           // Assign driver
        status: "accepted",              // Set status to accepted
        updated_at: now,                 // Update timestamp
      })
      .eq("id", input.rideId)
      .in("status", ["pending", "dispatched"])  // Only accept if pending or dispatched
      .is("driver_id", null)              // Only if no driver assigned yet
      .select("*")
      .maybeSingle()

    if (updateError) {
      console.error("[RideAcceptance] Update error:", updateError)
      return {
        success: false,
        status: 500,
        code: "internal_error",
        message: "Failed to accept ride",
      }
    }

    if (!updatedRide) {
      // Check if ride exists at all
      const { data: existingRide } = await supabaseAdmin
        .from("rides")
        .select("id, status, driver_id")
        .eq("id", input.rideId)
        .maybeSingle()

      if (!existingRide) {
        console.error("[RideAcceptance] Ride not found:", input.rideId)
        return {
          success: false,
          status: 404,
          code: "ride_not_found",
          message: "Ride not found",
        }
      }

      console.error("[RideAcceptance] Ride unavailable - already taken or wrong status:", {
        rideId: input.rideId,
        status: existingRide.status,
        driver_id: existingRide.driver_id,
      })
      return {
        success: false,
        status: 409,
        code: "ride_unavailable",
        message: "Ride is no longer available",
      }
    }

    console.log("[RideAcceptance] ✅ Ride updated successfully:", {
      rideId: input.rideId,
      driverId: driver.id,
      status: updatedRide.status,
    })

    // Get driver user details for notifications
    const { data: driverUser } = await supabaseAdmin
      .from("users")
      .select("first_name, last_name, phone_number")
      .eq("id", input.driverUserId)
      .single()

    const driverName = driverUser
      ? `${driverUser.first_name || ""} ${driverUser.last_name || ""}`.trim() || "Driver"
      : "Driver"

    const driverPhone = driverUser?.phone_number || ""
    const fare = Number((updatedRide as any).fare_amount ?? (updatedRide as any).fare ?? 0)

    await supabaseAdmin.from("ride_dispatch_logs").insert([
      {
        ride_id: input.rideId,
        driver_id: driver.id,
        dispatch_method: input.source,
        response: "accepted",
        created_at: now,
      },
    ])

    try {
      await emitRideAccepted(
        updatedRide.rider_id,
        input.driverUserId,
        input.rideId,
        driverName,
        driverPhone,
        "Keke Tricycle",
        5,
        updatedRide.pickup_zone,
        updatedRide.destination_zone,
        fare
      )

      await emitRideTaken(input.rideId)

      // Send SMS notifications to both parties
      const smsTasks = []

      // Get rider details for SMS
      const { data: riderUser } = await supabaseAdmin
        .from("users")
        .select("first_name, phone_number")
        .eq("id", updatedRide.rider_id)
        .single()

      // Send SMS to driver confirming acceptance
      if (driverPhone) {
        smsTasks.push(
          sendRideAcceptanceSMS(driverPhone, input.rideId, riderUser?.first_name)
            .then(() => {
              console.log("[RideAcceptance] SMS sent to driver", {
                rideId: input.rideId,
                driverId: input.driverUserId,
              })
            })
            .catch((error) => {
              console.error("[RideAcceptance] Failed to send SMS to driver:", error)
            })
        )
      }

      // Send SMS to rider about driver acceptance
      if (riderUser?.phone_number) {
        const riderSMSMessage = `✅ DRIVER FOUND - CK-${input.rideId.slice(0, 8).toUpperCase()}

Your ride has been accepted!
Driver: ${driverName}

📍 They are heading to your pickup location.
🔔 You will receive updates soon.

Get ready for pickup!`
        smsTasks.push(
          (async () => {
            try {
              const { sendSMS } = await import("@/lib/termii")
              await sendSMS({
                to: riderUser.phone_number,
                message: riderSMSMessage,
                channel: "dnd",
                type: "plain",
              })
              console.log("[RideAcceptance] SMS sent to rider", {
                rideId: input.rideId,
                riderId: updatedRide.rider_id,
              })
            } catch (error) {
              console.error("[RideAcceptance] Failed to send SMS to rider:", error)
            }
          })()
        )
      }

      await Promise.allSettled(smsTasks)
    } catch (notificationError) {
      console.error("[RideAcceptance] notification error:", notificationError)
    }

    return {
      success: true,
      status: 200,
      code: "accepted",
      message: "Ride accepted successfully",
      ride: updatedRide,
    }
  } catch (error) {
    console.error("[RideAcceptance] unexpected error:", error)
    return {
      success: false,
      status: 500,
      code: "internal_error",
      message: "Internal server error",
    }
  }
}
