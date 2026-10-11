import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";

type Params = { params: Promise<{ rideId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const session = await getSessionFromRequest(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { rideId } = await params;

    if (!rideId) {
      return NextResponse.json({ error: "Ride ID is required" }, { status: 400 });
    }

    // Fetch the ride details
    const { data: ride, error: rideError } = await supabaseAdmin!
      .from("rides")
      .select("id, rider_id, status, metadata, fare_amount")
      .eq("id", rideId)
      .single();

    if (rideError || !ride) {
      return NextResponse.json({ error: "Ride not found" }, { status: 404 });
    }

    // Verify the rider owns this ride
    if (ride.rider_id !== session.user.id) {
      return NextResponse.json({ error: "You can only confirm your own rides" }, { status: 403 });
    }

    // Check if ride is completed
    if (ride.status !== "completed") {
      return NextResponse.json({ error: "Ride must be completed first" }, { status: 400 });
    }

    // Check if this ride had a penalty applied
    if (ride.metadata?.penalty_applied && ride.metadata?.penalty_applied > 0) {
      try {
        // Clear the rider's pending penalty
        await supabaseAdmin
          .from("users")
          .update({ pending_cancellation_penalty: 0 })
          .eq("id", session.user.id);

        // Update the rider penalty history to "confirmed"
        await supabaseAdmin
          .from("rider_penalties")
          .update({
            status: "confirmed",
            confirmed_at: new Date().toISOString(),
          })
          .eq("ride_id", rideId)
          .eq("status", "applied");

        console.log("[ConfirmCompletion] Rider penalty confirmed and cleared:", {
          rideId,
          riderId: session.user.id,
          penaltyAmount: ride.metadata.penalty_applied,
        });

        // Send notification to rider that penalty has been cleared
        await supabaseAdmin.from("notifications").insert({
          user_id: session.user.id,
          title: "Penalty Applied",
          message: `Your cancellation penalty of ₦${ride.metadata.penalty_applied.toLocaleString()} has been applied to this ride and cleared from your account.`,
          type: "penalty_cleared",
          channel: "in_app",
          related_table: "rides",
          related_id: rideId,
          data: {
            penalty_amount: ride.metadata.penalty_applied,
            ride_id: rideId,
          },
          deep_link: "/rider/rides-history",
        });
      } catch (error) {
        console.error("[ConfirmCompletion] Failed to clear rider penalty:", error);
        // Don't fail the request if penalty clearing fails
      }
    }

    return NextResponse.json({
      success: true,
      message: "Ride completion confirmed",
      rideId,
    });
  } catch (error) {
    console.error("[CONFIRM_COMPLETION]", error);
    return NextResponse.json({ error: "Failed to confirm ride completion" }, { status: 500 });
  }
}
