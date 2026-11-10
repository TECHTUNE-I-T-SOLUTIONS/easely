import { supabaseAdmin } from "@/lib/supabase"
import { cancelExpiredOpenRides } from "@/lib/ride-expiry"
import { requireVerifiedDriver } from "@/lib/driver-verification"
import { scheduleRideAcceptedNotifications } from "@/lib/ride-accepted-notifications"

export type RideAcceptanceSource = "app" | "sms"

interface AcceptRideInput {
  rideId: string
  driverUserId: string
  source: RideAcceptanceSource
  /** Driver ETA in minutes; persisted with the accept so notifications can use it. */
  etaMinutes?: number | null
}

interface AcceptRideResult {
  success: boolean
  status: number
  code: "accepted" | "ride_not_found" | "driver_not_found" | "driver_not_verified" | "ride_unavailable" | "ride_expired" | "internal_error"
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

    const verification = await requireVerifiedDriver(input.driverUserId)
    if (!verification.allowed) {
      return {
        success: false,
        status: verification.status,
        code: verification.code || "internal_error",
        message: verification.message || "Driver is not eligible to accept rides",
      }
    }

    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id, user_id, vehicle_type, plate_number")
      .eq("user_id", input.driverUserId)
      .single()

    if (driverError || !driver) {
      console.error("[RideAcceptance] Driver not found:", driverError)
      return { success: false, status: 404, code: "driver_not_found", message: "Driver profile not found" }
    }

    console.log("[RideAcceptance] Driver found:", driver.id)

    const now = new Date().toISOString()
    const expired = await cancelExpiredOpenRides([input.rideId])
    if (expired.length > 0) {
      return {
        success: false,
        status: 410,
        code: "ride_expired",
        message: "This ride expired because no driver accepted it before the scheduled day ended and has been cancelled.",
      }
    }

    const etaMinutes =
      Number.isFinite(Number(input.etaMinutes)) && Number(input.etaMinutes) > 0
        ? Math.round(Number(input.etaMinutes))
        : null

    // Update ride with driver acceptance
    // Only update if ride is in pending or dispatched state and has no driver assigned
    const { data: updatedRide, error: updateError } = await supabaseAdmin
      .from("rides")
      .update({
        driver_id: driver.id,           // Assign driver
        status: "accepted",              // Set status to accepted
        updated_at: now,                 // Update timestamp
        ...(etaMinutes ? { eta_minutes: etaMinutes } : {}),
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

    await supabaseAdmin.from("ride_dispatch_logs").insert([
      {
        ride_id: input.rideId,
        driver_id: driver.id,
        dispatch_method: input.source,
        response: "accepted",
        created_at: now,
      },
    ])

    // Rider + driver push, "ride taken" broadcast to other drivers, SMS to both
    // parties, receipt emails, admin alert and the native live-tracking card are all
    // dispatched by the shared notifier *after* this response is sent. They were
    // previously awaited inline here, which is why accepting felt slow; skipping them
    // on the fast path is why they never fired at all.
    scheduleRideAcceptedNotifications({
      ride: updatedRide as any,
      driverId: driver.id,
      driverUserId: input.driverUserId,
      etaMinutes: etaMinutes ?? (updatedRide as any).eta_minutes ?? null,
      source: input.source,
    })

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
