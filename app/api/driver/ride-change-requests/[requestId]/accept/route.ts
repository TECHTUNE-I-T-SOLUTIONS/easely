import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { acceptDriverChange } from "@/lib/ride-driver-change";

type Params = { params: Promise<{ requestId: string }> };

/**
 * POST — take over a ride another driver has handed over.
 * Race-safe: the request row is claimed with a conditional update, so two
 * drivers tapping at the same moment cannot both win.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { requestId } = await params;
  try {
    const session = await getSessionFromRequest(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await acceptDriverChange({
      requestId,
      driverUserId: session.user.id,
    });

    return NextResponse.json(
      {
        success: result.success,
        message: result.message,
        code: result.code,
        rideId: result.ride?.id ?? null,
        request: result.request ?? null,
      },
      { status: result.status }
    );
  } catch (error: any) {
    console.error("[DRIVER_CHANGE_ACCEPT] error:", error?.message);
    return NextResponse.json({ error: "Failed to take over the ride" }, { status: 500 });
  }
}
