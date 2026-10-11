import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { sendLiveTrackingNotification } from "@/lib/push-service-enhanced"

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const {
      userId,
      driverLocation,
      pickupLocation,
      destinationLocation,
      etaMinutes,
      distanceKm,
      status,
    } = body

    if (!userId || !driverLocation || !pickupLocation || !destinationLocation) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // Send live tracking notification
    await sendLiveTrackingNotification({
      rideId: "test-ride-id",
      riderId: userId,
      driverLocation,
      pickupLocation,
      destinationLocation,
      etaMinutes,
      distanceKm,
      status,
    })

    return NextResponse.json({
      success: true,
      message: "Test notification sent successfully",
      notification: {
        title: status === "accepted" ? "🚗 Driver is on the way!" :
               status === "in_progress" ? "🎯 En route to destination" :
               "📍 Driver has arrived!",
        body: status === "accepted" ? `Your driver is ${distanceKm.toFixed(1)} km away. ETA: ${etaMinutes} min` :
               status === "in_progress" ? `Trip in progress. ETA: ${etaMinutes} min` :
               "Your driver is waiting at the pickup location",
        etaMinutes,
        distanceKm,
        status,
      },
    })
  } catch (error) {
    console.error("[TestLiveTracking] Error:", error)
    return NextResponse.json(
      { error: "Failed to send test notification" },
      { status: 500 }
    )
  }
}
