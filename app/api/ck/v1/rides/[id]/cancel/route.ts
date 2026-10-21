import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { validateCkApiKey, withRateLimitHeaders } from "@/lib/ck-auth-middleware";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { auth, error } = await validateCkApiKey(request, "rides.create");
  if (error || !auth) return error!;

  const { id } = await context.params;

  if (!id) {
    return NextResponse.json(
      { error: "missing_id", message: "Ride ID is required." },
      { status: 400 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const reason = body?.reason || "Cancelled by API partner";

    const { data: ride, error: fetchError } = await supabaseAdmin
      .from("rides")
      .select("id, status, metadata")
      .eq("id", id)
      .single();

    if (fetchError || !ride) {
      return NextResponse.json(
        { error: "ride_not_found", message: `Ride with ID ${id} not found.` },
        { status: 404 }
      );
    }

    const partnerIdInMeta = (ride.metadata as any)?.partner_id;
    if (partnerIdInMeta && partnerIdInMeta !== auth.partnerId) {
      return NextResponse.json(
        { error: "forbidden", message: "You do not have permission to cancel this ride." },
        { status: 403 }
      );
    }

    if (["completed", "cancelled"].includes(ride.status)) {
      return NextResponse.json(
        {
          error: "invalid_state",
          message: `Cannot cancel ride. Current status is already '${ride.status}'.`,
        },
        { status: 400 }
      );
    }

    const updatedMetadata = {
      ...(ride.metadata || {}),
      cancellation_reason: reason,
      cancelled_by_partner_id: auth.partnerId,
      cancelled_at: new Date().toISOString(),
    };

    const { data: updatedRide, error: updateError } = await supabaseAdmin
      .from("rides")
      .update({
        status: "cancelled",
        metadata: updatedMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      console.error("[Public API] Failed to cancel ride:", updateError);
      return NextResponse.json(
        { error: "database_error", message: "Failed to update ride cancellation." },
        { status: 500 }
      );
    }

    const res = NextResponse.json({
      success: true,
      message: "Ride cancelled successfully.",
      data: updatedRide,
    });
    return withRateLimitHeaders(res, auth.keyId);
  } catch (err: any) {
    console.error(`[Public API] Error in POST /api/ck/v1/rides/${id}/cancel:`, err);
    return NextResponse.json(
      { error: "internal_error", message: err?.message || "Unexpected server error." },
      { status: 500 }
    );
  }
}
