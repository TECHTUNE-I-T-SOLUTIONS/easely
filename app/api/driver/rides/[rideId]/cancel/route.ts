import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { DRIVER_DAILY_CANCEL_LIMIT, lagosDayKey } from "@/lib/cancellation-policy";

type Params = { params: Promise<{ rideId: string }> };

/**
 * Drivers cannot cancel a ride they have accepted.
 *
 * Once a driver accepts, the rider is relying on them. If the driver genuinely
 * cannot complete the trip, they must contact support so the ride can be
 * reassigned without it counting against the rider. This endpoint therefore
 * refuses every cancellation and only reports the driver's standing.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { rideId } = await params;

  try {
    const session = await getSessionFromRequest(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.warn("[DRIVER_CANCEL] Blocked driver-initiated cancellation", {
      rideId,
      userId: session.user.id,
    });

    return NextResponse.json(
      {
        error:
          "Drivers cannot cancel a ride once accepted. If you cannot complete this trip, contact support so it can be reassigned.",
        code: "driver_cancel_not_allowed",
        rideId,
      },
      { status: 403 }
    );
  } catch (error: any) {
    console.error("[DRIVER_CANCEL] Unexpected error:", error?.message);
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
  }
}

/**
 * GET — how many of this driver's accepted rides have been cancelled by riders
 * today, and whether that has put the account under review.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { rideId } = await params;
  try {
    const session = await getSessionFromRequest(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: driver } = await supabaseAdmin!
      .from("drivers")
      .select("*")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (!driver?.id) {
      return NextResponse.json({ error: "Driver profile not found" }, { status: 404 });
    }

    const dayKey = lagosDayKey();
    const { count } = await supabaseAdmin
      .from("driver_ride_cancellations")
      .select("id", { count: "exact", head: true })
      .eq("driver_id", driver.id)
      .eq("day_key", dayKey);

    const response = NextResponse.json({
      rideId,
      day: dayKey,
      riderCancellationsToday: count || 0,
      reviewThreshold: DRIVER_DAILY_CANCEL_LIMIT,
      accountUnderReview: driver.lock_status === "under_review",
      lockStatus: driver.lock_status ?? null,
      lockReason: driver.lock_reason ?? null,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error: any) {
    console.error("[DRIVER_CANCEL][GET] error:", error?.message);
    return NextResponse.json({ error: "Failed to load cancellation status" }, { status: 500 });
  }
}
