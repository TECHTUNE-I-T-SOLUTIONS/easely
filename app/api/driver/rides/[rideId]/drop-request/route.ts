import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import {
  requestDriverChange,
  cancelDriverChangeRequest,
  expireStaleChangeRequests,
} from "@/lib/ride-driver-change";

type Params = { params: Promise<{ rideId: string }> };

/**
 * POST — the driver asks for this ride to be handed to another driver.
 * Only allowed inside the free window after acceptance; drivers never cancel.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { rideId } = await params;
  try {
    const session = await getSessionFromRequest(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let reason = "";
    try {
      const body = await request.json();
      reason = typeof body?.reason === "string" ? body.reason : "";
    } catch {
      /* empty body is fine */
    }

    const result = await requestDriverChange({
      rideId,
      driverUserId: session.user.id,
      reason,
    });

    return NextResponse.json(
      {
        success: result.success,
        message: result.message,
        code: result.code,
        request: result.request ?? null,
      },
      { status: result.status }
    );
  } catch (error: any) {
    console.error("[DRIVER_DROP_REQUEST] error:", error?.message);
    return NextResponse.json({ error: "Failed to request a handover" }, { status: 500 });
  }
}

/** DELETE — withdraw the driver's own pending handover request. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { rideId } = await params;
  try {
    const session = await getSessionFromRequest(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await cancelDriverChangeRequest({ rideId, driverUserId: session.user.id });
    return NextResponse.json(
      { success: result.success, message: result.message, code: result.code },
      { status: result.status }
    );
  } catch (error: any) {
    console.error("[DRIVER_DROP_REQUEST][DELETE] error:", error?.message);
    return NextResponse.json({ error: "Failed to withdraw the request" }, { status: 500 });
  }
}

/** GET — does this ride already have an open handover request? */
export async function GET(request: NextRequest, { params }: Params) {
  const { rideId } = await params;
  try {
    const session = await getSessionFromRequest(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await expireStaleChangeRequests();

    const { data } = await supabaseAdmin!
      .from("ride_driver_change_requests")
      .select("id, status, reason, requested_at, expires_at")
      .eq("ride_id", rideId)
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const body = NextResponse.json({
      rideId,
      hasOpenRequest: data?.status === "open",
      request: data ?? null,
    });
    body.headers.set("Cache-Control", "no-store");
    return body;
  } catch (error: any) {
    console.error("[DRIVER_DROP_REQUEST][GET] error:", error?.message);
    return NextResponse.json({ error: "Failed to load the request" }, { status: 500 });
  }
}
