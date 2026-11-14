import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { listOpenChangeRequests } from "@/lib/ride-driver-change";

/**
 * GET — open ride handovers this driver may take.
 * The driver home screen polls this to show the handover modal.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const requests = await listOpenChangeRequests(session.user.id);

    const response = NextResponse.json({ requests, count: requests.length });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error: any) {
    console.error("[DRIVER_CHANGE_LIST] error:", error?.message);
    return NextResponse.json({ requests: [], count: 0 }, { status: 200 });
  }
}
