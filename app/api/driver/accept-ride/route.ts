import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { acceptRideFirstCome } from "@/lib/ride-acceptance";
import { getDriverRemittanceSummary } from "@/lib/driver-settlement";
import { supabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/push-service";

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);

    if (!session?.user?.id || session.user.role !== "driver") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { rideId } = body;

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

      await sendPushNotification([ride.rider_id], {
        title: "✅ Driver Accepted",
        body: `${driverName} accepted your ride request`,
        type: "ride_accepted",
        data: {
          rideId: ride.id,
          deeplink: `/rider/active-ride?rideId=${ride.id}`,
          driverId: driver.id,
          driverName,
          pickupZone: ride.pickup_zone,
          destinationZone: ride.destination_zone,
        },
      });
      console.log("[AcceptRide] Push notification sent to rider", {
        rideId,
        riderId: ride.rider_id,
      });
    } catch (pushError) {
      console.error("[AcceptRide] Failed to send push notification:", pushError);
    }

    return NextResponse.json({
      success: true,
      ride: acceptance.ride,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
