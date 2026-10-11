import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { sendLiveTrackingNotification } from "@/lib/push-service-enhanced"

export async function GET(request: NextRequest) {
  try {
    // This endpoint should be called by a cron job every 1-2 minutes
    // It will:
    // 1. Find all active rides (accepted or in_progress)
    // 2. Get the latest driver location for each ride
    // 3. Send live tracking notification to the rider

    console.log("[LiveTrackingPoll] Starting live tracking update poll")

    // Fetch all active rides with driver information
    const { data: activeRides, error: ridesError } = await supabaseAdmin
      .from("rides")
      .select(`
        id,
        rider_id,
        driver_id,
        status,
        pickup_zone,
        destination_zone,
        pickup_description,
        destination_description,
        metadata,
        drivers!inner(user_id)
      `)
      .in("status", ["accepted", "in_progress"])

    if (ridesError) {
      console.error("[LiveTrackingPoll] Failed to fetch active rides:", ridesError)
      return NextResponse.json({ error: "Failed to fetch active rides" }, { status: 500 })
    }

    if (!activeRides || activeRides.length === 0) {
      console.log("[LiveTrackingPoll] No active rides found")
      return NextResponse.json({ success: true, message: "No active rides to update" })
    }

    console.log(`[LiveTrackingPoll] Found ${activeRides.length} active rides`)

    let notificationsSent = 0
    const results: any[] = []

    for (const ride of activeRides) {
      try {
        // Get driver's last known location
        const driverUser = Array.isArray(ride.drivers) ? ride.drivers[0] : ride.drivers
        const driverUserId = driverUser?.user_id

        if (!driverUserId) {
          console.log(`[LiveTrackingPoll] No driver user_id for ride ${ride.id}`)
          continue
        }

        const { data: driver } = await supabaseAdmin
          .from("drivers")
          .select("last_known_location")
          .eq("user_id", driverUserId)
          .single()

        if (!driver?.last_known_location) {
          console.log(`[LiveTrackingPoll] No location for driver on ride ${ride.id}`)
          continue
        }

        const driverLocation = driver.last_known_location
        const timeSinceUpdate = Date.now() - new Date(driverLocation.updated_at).getTime()

        // Only send notification if location was updated in the last 5 minutes
        if (timeSinceUpdate > 5 * 60 * 1000) {
          console.log(`[LiveTrackingPoll] Skipping stale location for ride ${ride.id}`)
          continue
        }

        // Extract pickup and destination coordinates
        const pickupCoords = extractCoordinates(ride.pickup_description)
        const destCoords = extractCoordinates(ride.destination_description)

        if (!pickupCoords || !destCoords) {
          console.log(`[LiveTrackingPoll] Missing coordinates for ride ${ride.id}`)
          continue
        }

        // Calculate ETA (simplified - use routing API in production)
        const distanceKm = calculateDistance(
          { lat: driverLocation.latitude, lng: driverLocation.longitude },
          ride.status === "accepted"
            ? { lat: pickupCoords.latitude, lng: pickupCoords.longitude }
            : { lat: destCoords.latitude, lng: destCoords.longitude }
        )
        const etaMinutes = Math.ceil(distanceKm * 2) // Simplified: 2 min per km

        // Send live tracking notification
        await sendLiveTrackingNotification({
          rideId: ride.id,
          riderId: ride.rider_id,
          driverLocation: { lat: driverLocation.latitude, lng: driverLocation.longitude },
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

        notificationsSent++
        results.push({
          rideId: ride.id,
          riderId: ride.rider_id,
          status: ride.status,
          etaMinutes,
          distanceKm,
          success: true,
        })

        console.log(`[LiveTrackingPoll] Sent notification for ride ${ride.id}`)
      } catch (error) {
        console.error(`[LiveTrackingPoll] Failed to process ride ${ride.id}:`, error)
        results.push({
          rideId: ride.id,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        })
      }
    }

    console.log(`[LiveTrackingPoll] Completed. Sent ${notificationsSent} notifications`)

    return NextResponse.json({
      success: true,
      activeRides: activeRides.length,
      notificationsSent,
      results,
    })
  } catch (error) {
    console.error("[LiveTrackingPoll] Error:", error)
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
