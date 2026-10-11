import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getSessionFromRequest } from "@/lib/auth"
import { sendLiveTrackingNotification } from "@/lib/push-service-enhanced"

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id || session.user.role !== "driver") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { latitude, longitude, rideId } = body

    if (!latitude || !longitude) {
      return NextResponse.json(
        { error: "Missing latitude or longitude" },
        { status: 400 }
      )
    }

    // Update driver's last known location in the database
    // We can store this in the driver's record or in a separate location tracking table
    const { error: updateError } = await supabaseAdmin
      .from("drivers")
      .update({
        last_known_location: {
          latitude,
          longitude,
          updated_at: new Date().toISOString(),
        },
      })
      .eq("user_id", session.user.id)

    if (updateError) {
      console.error("[DriverLocation] Failed to update driver location:", updateError)
      return NextResponse.json(
        { error: "Failed to update location" },
        { status: 500 }
      )
    }

    // If there's an active ride, update the ride metadata with driver location
    // and send live tracking notification to rider
    if (rideId) {
      const { data: ride } = await supabaseAdmin
        .from("rides")
        .select("*, users!inner(*), drivers!inner(*)")
        .eq("id", rideId)
        .eq("driver_id", session.user.id)
        .single()

      if (ride && (ride.status === "accepted" || ride.status === "in_progress")) {
        // Update ride metadata with driver location
        await supabaseAdmin
          .from("rides")
          .update({
            metadata: {
              ...(ride.metadata || {}),
              driver_location: {
                latitude,
                longitude,
                updated_at: new Date().toISOString(),
              },
            },
          })
          .eq("id", rideId)

        // Extract pickup and destination coordinates from ride
        const pickupCoords = extractCoordinates(ride.pickup_description)
        const destCoords = extractCoordinates(ride.destination_description)

        if (pickupCoords && destCoords) {
          // Calculate ETA (simplified - you'd use a routing API in production)
          const distanceKm = calculateDistance(
            { lat: latitude, lng: longitude },
            ride.status === "accepted" ? { lat: pickupCoords.latitude, lng: pickupCoords.longitude } : { lat: destCoords.latitude, lng: destCoords.longitude }
          )
          const etaMinutes = Math.ceil(distanceKm * 2) // Simplified: 2 min per km

          // Send live tracking notification to rider
          await sendLiveTrackingNotification({
            rideId,
            riderId: ride.rider_id,
            driverLocation: { lat: latitude, lng: longitude },
            pickupLocation: {
              lat: pickupCoords.latitude,
              lng: pickupCoords.longitude,
              address: ride.pickup_zone,
            },
            destinationLocation: {
              lat: destCoords.latitude,
              lng: destCoords.longitude,
              address: ride.destination_zone,
            },
            etaMinutes,
            distanceKm,
            status: ride.status as 'accepted' | 'in_progress' | 'arrived',
          })
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: "Location updated successfully",
    })
  } catch (error) {
    console.error("[DriverLocation] Error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

// Helper function to extract coordinates from description string
function extractCoordinates(description?: string): { latitude: number; longitude: number } | null {
  if (!description) return null
  const latMatch = description.match(/Lat:\s*([-\d.]+)/)
  const lngMatch = description.match(/Lng:\s*([-\d.]+)/)
  if (latMatch && lngMatch) {
    return {
      latitude: parseFloat(latMatch[1]),
      longitude: parseFloat(lngMatch[1]),
    }
  }
  return null
}

// Helper function to calculate distance between two coordinates (Haversine formula)
function calculateDistance(
  coord1: { lat: number; lng: number },
  coord2: { lat: number; lng: number }
): number {
  const R = 6371 // Earth's radius in km
  const dLat = toRad(coord2.lat - coord1.lat)
  const dLon = toRad(coord2.lng - coord1.lng)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(coord1.lat)) *
      Math.cos(toRad(coord2.lat)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180
}
