import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { acceptRideFirstCome } from "@/lib/ride-acceptance";
import { getDriverRemittanceSummary } from "@/lib/driver-settlement";
import { supabaseAdmin } from "@/lib/supabase";
import { notifyAdmins } from "@/lib/admin-notifications";
import { sendPushNotification } from "@/lib/push-service";
import { sendNativeLiveTrackingNotification } from "@/lib/live-tracking-native";

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);

    if (!session?.user?.id || session.user.role !== "driver") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { rideId, eta_minutes } = body;

    if (!rideId) {
      return NextResponse.json(
        { error: "Ride ID is required" },
        { status: 400 }
      );
    }

    const { data: driver } = await supabaseAdmin!
      .from("drivers")
      .select("id")
      .eq("user_id", session.user.id)
      .single();

    if (!driver?.id) {
      return NextResponse.json(
        { error: "Driver profile not found" },
        { status: 404 }
      );
    }

    const remittance = await getDriverRemittanceSummary(driver.id);

    if (remittance.blocked) {
      return NextResponse.json(
        {
          error: "Outstanding settlements must be paid before accepting rides",
          code: "settlement_overdue",
          totalOverdue: remittance.overdueTotal,
          totalOutstanding: remittance.overdueTotal,
          totalTodayDue: remittance.todayTotal,
          totalDueNow: remittance.grandTotal,
          remittanceSummary: {
            overdueTotal: remittance.overdueTotal,
            todayTotal: remittance.todayTotal,
            grandTotal: remittance.grandTotal,
            timezone: "Africa/Lagos",
            serverTime: new Date().toISOString(),
          },
        },
        { status: 403 }
      );
    }

    // Check if driver already has an active ride
    const { data: activeRides, error: activeRidesError } = await supabaseAdmin!
      .from("rides")
      .select("id, status")
      .eq("driver_id", driver.id)
      .in("status", ["accepted", "in_progress"]);

    if (!activeRidesError && activeRides && activeRides.length > 0) {
      return NextResponse.json(
        {
          error: "You already have an active ride. Please complete your current ride before accepting a new one.",
          code: "has_active_ride",
          activeRideId: activeRides[0].id,
        },
        { status: 403 }
      );
    }

    const acceptance = await acceptRideFirstCome({
      rideId,
      driverUserId: session.user.id,
      source: "app",
    });

    if (!acceptance.success) {
      return NextResponse.json(
        {
          error: acceptance.message,
          code: acceptance.code,
        },
        { status: acceptance.status }
      );
    }

    // Send push notification to rider
    try {
      const ride = acceptance.ride;
      const { data: driverUser } = await supabaseAdmin!
        .from("users")
        .select("first_name, last_name, phone_number")
        .eq("id", session.user.id)
        .single();

      const driverName = driverUser
        ? `${driverUser.first_name} ${driverUser.last_name}`
        : "A driver";

      // Get driver's vehicle plate
      const { data: driverDetails } = await supabaseAdmin!
        .from("drivers")
        .select("plate_number")
        .eq("user_id", session.user.id)
        .single();

      const vehiclePlate = driverDetails?.plate_number || '';

      // Send standard notification
      await sendPushNotification([ride.rider_id], {
        title: "✅ Driver Accepted",
        body: `${driverName} accepted your ride request. Heading to pickup location.`,
        type: "ride_accepted",
        categoryId: "ride_accepted_action",
        data: {
          rideId: ride.id,
          deeplink: `/rider/active-ride?rideId=${ride.id}`,
          driverId: driver.id,
          driverName,
          pickupZone: ride.pickup_zone,
          destinationZone: ride.destination_zone,
        },
      });

      // Also send native live tracking notification with emoji-based visuals
      // Extract coordinates from ride data if available
      const pickupCoords = extractCoordinates(ride.pickup_description);
      const destCoords = extractCoordinates(ride.destination_description);

      if (pickupCoords && destCoords) {
        await sendNativeLiveTrackingNotification({
          rideId: ride.id,
          riderId: ride.rider_id,
          driverName,
          driverLocation: { lat: 0, lng: 0 }, // Will be updated on first location update
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
          etaMinutes: eta_minutes || 10,
          distanceKm: 5, // Will be updated on first location update
          status: 'accepted',
          vehiclePlate,
        });
      }

      console.log("[AcceptRide] Push notification sent to rider", {
        rideId,
        riderId: ride.rider_id,
      });

    } catch (pushError) {
      console.error("[AcceptRide] Failed to send notification:", pushError);
    }

    try {
      const ride = acceptance.ride;
      const { data: driverUser } = await supabaseAdmin!
        .from("users")
        .select("first_name, last_name")
        .eq("id", session.user.id)
        .single();
      const driverName = driverUser ? `${driverUser.first_name} ${driverUser.last_name}` : "A driver";

      await notifyAdmins({
        allAdmins: true,
        department: "ops",
        title: "Ride accepted",
        body: `${driverName} accepted a ride from ${ride.pickup_zone} to ${ride.destination_zone}.`,
        type: "ride_accepted",
        actionUrl: `/admin/rides?ride=${ride.id}`,
        metadata: { rideId: ride.id, riderId: ride.rider_id, driverUserId: session.user.id, driverId: driver.id },
        sourceEventId: `ride_accepted:${ride.id}:${session.user.id}`,
      });
    } catch (notifyError) {
      console.error("[AcceptRide] Admin notification failed:", notifyError);
    }

    const etaMinutes = Number.isFinite(Number(eta_minutes)) && Number(eta_minutes) > 0
      ? Math.round(Number(eta_minutes))
      : null;

    let rideResponse = acceptance.ride;

    if (etaMinutes && rideResponse?.id) {
      const { data: etaRide, error: etaUpdateError } = await supabaseAdmin!
        .from("rides")
        .update({
          eta_minutes: etaMinutes,
          updated_at: new Date().toISOString(),
        })
        .eq("id", rideResponse.id)
        .select("*")
        .single();

      if (!etaUpdateError && etaRide) {
        rideResponse = etaRide;
      } else if (etaUpdateError) {
        console.error("[AcceptRide] Failed to persist eta_minutes:", etaUpdateError);
      }
    }

    return NextResponse.json({
      success: true,
      ride: rideResponse,
      eta_minutes: rideResponse?.eta_minutes ?? etaMinutes ?? null,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
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
