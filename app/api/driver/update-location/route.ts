import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { getSessionFromRequest } from "@/lib/auth"

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id || session.user.role !== "driver") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { rideId, latitude, longitude, accuracy, speed, heading } = body

    if (!rideId || latitude === undefined || longitude === undefined) {
      return NextResponse.json(
        { error: "rideId, latitude, and longitude are required" },
        { status: 400 }
      )
    }

    // Get driver ID
    const { data: driver } = await supabase
      .from("drivers")
      .select("id")
      .eq("user_id", session.user.id)
      .single()

    if (!driver) {
      return NextResponse.json(
        { error: "Driver profile not found" },
        { status: 404 }
      )
    }

    // Verify driver is assigned to this ride
    const { data: ride } = await supabase
      .from("rides")
      .select("id, status, metadata")
      .eq("id", rideId)
      .eq("driver_id", driver.id)
      .single()

    if (!ride) {
      return NextResponse.json(
        { error: "Ride not found or not assigned to you" },
        { status: 404 }
      )
    }

    const nowIso = new Date().toISOString()
    const updatedLocation = {
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      accuracy: accuracy ? parseFloat(accuracy) : null,
      speed: speed ? parseFloat(speed) : null,
      heading: heading ? parseFloat(heading) : null,
      timestamp: nowIso,
    }

    // Insert into driver_locations
    const { error: locationError } = await supabase
      .from("driver_locations")
      .insert({
        id: crypto.randomUUID(),
        driver_id: driver.id,
        ride_id: rideId,
        latitude: updatedLocation.latitude,
        longitude: updatedLocation.longitude,
        accuracy: updatedLocation.accuracy,
        speed: updatedLocation.speed,
        heading: updatedLocation.heading,
        timestamp: nowIso,
      })

    // Update rides metadata so Postgres Realtime fires for rides table
    const existingMeta = (ride.metadata && typeof ride.metadata === 'object') ? ride.metadata : {}
    await supabase
      .from("rides")
      .update({
        metadata: {
          ...existingMeta,
          driver_location: updatedLocation,
        },
        updated_at: nowIso,
      })
      .eq("id", rideId)

    if (locationError) {
      console.error("Location update error:", locationError)
      return NextResponse.json(
        { error: "Failed to update location" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: "Location updated successfully",
      location: {
        driver_id: driver.id,
        ride_id: rideId,
        latitude,
        longitude,
        accuracy,
        speed,
        heading,
        timestamp: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error("API error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
