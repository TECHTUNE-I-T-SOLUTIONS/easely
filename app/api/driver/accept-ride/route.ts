import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { acceptRideFirstCome } from "@/lib/ride-acceptance";
import { getDriverRemittanceSummary } from "@/lib/driver-settlement";
import { supabaseAdmin } from "@/lib/supabase";
import { scheduleRideAcceptedNotifications } from "@/lib/ride-accepted-notifications";

// The rider/driver SMS, receipt emails and push run in `after()`, which shares this
// route's time budget. The driver's response is already sent, so give the
// notification work room instead of the platform's short default.
export const maxDuration = 60;

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
      // select("*") so a database without the lock columns yet still resolves
      // the driver instead of failing the whole accept.
      .select("*")
      .eq("user_id", session.user.id)
      .single();

    if (!driver?.id) {
      return NextResponse.json(
        { error: "Driver profile not found" },
        { status: 404 }
      );
    }

    // Accounts locked for integrity review (e.g. too many cancellations in a day)
    // cannot take new rides until an admin clears them.
    if (driver.lock_status && driver.lock_status !== "active") {
      return NextResponse.json(
        {
          error:
            driver.lock_status === "suspended"
              ? "Your account is suspended. Please contact support."
              : "Your account is under review and cannot accept rides right now.",
          code: "account_locked",
          lockStatus: driver.lock_status,
          lockReason: driver.lock_reason ?? null,
        },
        { status: 403 }
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
      // Re-accepting the ride you already hold is a retry, not a conflict: fall
      // through so the notification bundle still gets dispatched for it.
      const sameRide = activeRides.find((ride) => ride.id === rideId);

      if (!sameRide) {
        return NextResponse.json(
          {
            error: "You already have an active ride. Please complete your current ride before accepting a new one.",
            code: "has_active_ride",
            activeRideId: activeRides[0].id,
          },
          { status: 403 }
        );
      }
    }

    const etaMinutes =
      Number.isFinite(Number(eta_minutes)) && Number(eta_minutes) > 0
        ? Math.round(Number(eta_minutes))
        : null;

    // If the ride was already accepted by this driver via the fast Supabase path,
    // skip the first-come DB update — but still dispatch the full notification
    // bundle. Notification dispatch is idempotent, so a client retry, the SMS
    // webhook or this route racing on the same ride can never double-text anyone.
    const { data: existingRide } = await supabaseAdmin!
      .from("rides")
      .select("*")
      .eq("id", rideId)
      .maybeSingle();

    const alreadyAcceptedByThisDriver =
      existingRide?.driver_id === driver.id &&
      ["accepted", "in_progress"].includes(String(existingRide?.status || ""));

    let ride: any;

    if (alreadyAcceptedByThisDriver) {
      let resolvedRide = existingRide;
      if (etaMinutes && existingRide?.id) {
        const { data: etaRide, error: etaUpdateError } = await supabaseAdmin!
          .from("rides")
          .update({ eta_minutes: etaMinutes, updated_at: new Date().toISOString() })
          .eq("id", existingRide.id)
          .select("*")
          .single();

        if (etaUpdateError) {
          console.error("[AcceptRide] Failed to persist eta_minutes:", etaUpdateError);
        } else if (etaRide) {
          resolvedRide = etaRide;
        }
      }

      ride = resolvedRide;

      scheduleRideAcceptedNotifications({
        ride,
        driverId: driver.id,
        driverUserId: session.user.id,
        etaMinutes: etaMinutes ?? ride?.eta_minutes ?? null,
        source: "app",
      });
    } else {
      const acceptance = await acceptRideFirstCome({
        rideId,
        driverUserId: session.user.id,
        source: "app",
        etaMinutes,
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

      // acceptRideFirstCome already persisted the ETA and scheduled the rider/driver
      // SMS, email and push notifications — nothing else to dispatch here.
      ride = acceptance.ride;
    }

    // Set driver status to 'busy' after accepting a ride
    try {
      await supabaseAdmin!
        .from("drivers")
        .update({
          availability_status: "busy",
          updated_at: new Date().toISOString(),
        })
        .eq("id", driver.id);
      console.log("[AcceptRide] Driver status set to 'busy'", { driverId: driver.id });
    } catch (statusError) {
      console.error("[AcceptRide] Failed to set driver status to 'busy':", statusError);
      // Don't fail the request if status update fails - ride is already accepted
    }

    return NextResponse.json({
      success: true,
      ride,
      eta_minutes: ride?.eta_minutes ?? etaMinutes ?? null,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
