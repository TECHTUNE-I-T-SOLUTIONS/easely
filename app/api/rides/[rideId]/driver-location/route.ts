import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getSessionFromRequest } from "@/lib/auth"

interface RouteParams {
  params: Promise<{ rideId: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { rideId } = await params
    if (!rideId) {
      return NextResponse.json({ error: "Ride ID is required" }, { status: 400 })
    }

    // Verify ride exists and user/driver is involved
    const { data: ride, error: rideError } = await supabaseAdmin!
      .from("rides")
      .select("id, driver_id, rider_id, status, metadata")
      .eq("id", rideId)
      .single()

    if (rideError || !ride) {
      return NextResponse.json({ error: "Ride not found" }, { status: 404 })
    }

    // Check authorization: rider, driver, or admin
    const { data: driver } = await supabaseAdmin!
      .from("drivers")
      .select("id")
      .eq("user_id", session.user.id)
      .single()

    const isDriver = driver?.id === ride.driver_id
    const isRider = session.user.id === ride.rider_id
    const isAdmin = session.user.role === "admin" || session.user.role === "super_admin"

    if (!isDriver && !isRider && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // First check metadata for latest location
    if (ride.metadata && typeof ride.metadata === "object" && (ride.metadata as any).driver_location) {
      const loc = (ride.metadata as any).driver_location
      return NextResponse.json({
        success: true,
        location: loc,
      })
    }

    // Fall back to driver_locations table
    const { data: latestLocation } = await supabaseAdmin!
      .from("driver_locations")
      .select("*")
      .eq("ride_id", rideId)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle()

    return NextResponse.json({
      success: true,
      location: latestLocation || null,
    })
  } catch (error) {
    console.error("[Rides/:id/driver-location][GET] error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
