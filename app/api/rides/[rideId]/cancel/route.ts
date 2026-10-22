import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { sendPushNotification } from "@/lib/push-service";

type Params = { params: Promise<{ rideId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const session = await getSessionFromRequest(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { rideId } = await params;
    const body = await request.json();
    const { reason, waiver = false } = body || {};

    if (!rideId) {
      return NextResponse.json({ error: "Ride ID is required" }, { status: 400 });
    }

    // Fetch the ride details
    const { data: ride, error: rideError } = await supabaseAdmin!
      .from("rides")
      .select("id, rider_id, status, driver_id, fare_amount, accepted_at, pickup_time, metadata")
      .eq("id", rideId)
      .single();

    if (rideError || !ride) {
      console.error("[RIDE_CANCEL] Ride not found:", { rideId, rideError });
      return NextResponse.json({ 
        error: "Ride not found", 
        details: rideError?.message || "The specified ride does not exist or may have been cancelled already",
        rideId 
      }, { status: 404 });
    }

    // Verify the rider owns this ride
    if (ride.rider_id !== session.user.id) {
      console.log("[RIDE_CANCEL] User does not own this ride:", { 
        sessionUserId: session.user.id, 
        rideRiderId: ride.rider_id 
      });
      return NextResponse.json({ 
        error: "You can only cancel your own rides",
        rideId 
      }, { status: 403 });
    }

    // Check if ride can be cancelled
    const terminalStatuses = ["completed", "cancelled"];
    if (terminalStatuses.includes(ride.status)) {
      console.log("[RIDE_CANCEL] Ride already in terminal state:", { rideId, status: ride.status });
      return NextResponse.json({ 
        error: `Ride cannot be cancelled - it is already ${ride.status}`,
        currentStatus: ride.status,
        rideId 
      }, { status: 400 });
    }

    // Calculate cancellation fee if applicable
    let cancellationFee = 0;
    let waiveFee = waiver;

    // If driver has accepted, check the 5-minute window
    if (ride.status === "accepted" && ride.accepted_at) {
      const acceptedTime = new Date(ride.accepted_at).getTime();
      const currentTime = Date.now();
      const elapsedMinutes = (currentTime - acceptedTime) / (1000 * 60);

      // If more than 5 minutes have passed and no waiver, apply 30% fee
      if (elapsedMinutes > 5 && !waiveFee) {
        cancellationFee = ride.fare_amount * 0.30; // 30% of fare
      }
    }

    // Cancel the ride
    const { error: updateError } = await supabaseAdmin!
      .from("rides")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: "rider",
        cancellation_reason: reason,
        cancellation_fee: cancellationFee,
        updated_at: new Date().toISOString(),
        metadata: {
          ...ride.metadata,
          fee_waived: waiveFee,
          cancellation_context: {
            elapsed_since_acceptance: ride.accepted_at
              ? (Date.now() - new Date(ride.accepted_at).getTime()) / (1000 * 60)
              : null,
          },
        },
      })
      .eq("id", rideId);

    if (updateError) {
      return NextResponse.json({ error: "Failed to cancel ride" }, { status: 500 });
    }

    // Record penalty if applicable
    if (cancellationFee > 0 && !waiveFee) {
      // Add to user's pending penalty
      const { data: userData } = await supabaseAdmin
        .from("users")
        .select("pending_cancellation_penalty")
        .eq("id", session.user.id)
        .single();

      const currentPenalty = Number(userData?.pending_cancellation_penalty || 0);
      const newPenalty = currentPenalty + cancellationFee;

      await supabaseAdmin
        .from("users")
        .update({
          pending_cancellation_penalty: newPenalty,
        })
        .eq("id", session.user.id);

      // Record penalty history
      await supabaseAdmin.from("rider_penalties").insert({
        user_id: session.user.id,
        ride_id: rideId,
        penalty_type: "cancellation",
        penalty_amount: cancellationFee,
        penalty_percent: 0.30,
        ride_fare_amount: ride.fare_amount,
        status: "pending",
        metadata: {
          reason,
          elapsed_since_acceptance: ride.accepted_at
            ? (Date.now() - new Date(ride.accepted_at).getTime()) / (1000 * 60)
            : null,
        },
      });

      // Send penalty notification
      await supabaseAdmin.from("notifications").insert({
        user_id: session.user.id,
        title: "Cancellation Fee Applied",
        message: `A cancellation fee of ₦${cancellationFee.toLocaleString()} has been added to your next booking.`,
        type: "penalty",
        channel: "in_app",
        related_table: "rides",
        related_id: rideId,
        data: {
          penalty_amount: cancellationFee,
          penalty_percent: 30,
          ride_id: rideId,
        },
        deep_link: "/rider/rides-history",
      });
    } else if (waiveFee) {
      // Send notification that fee was waived
      await supabaseAdmin.from("notifications").insert({
        user_id: session.user.id,
        title: "Cancellation Fee Waived",
        message: "Your cancellation fee has been waived due to driver communication.",
        type: "penalty_waived",
        channel: "in_app",
        related_table: "rides",
        related_id: rideId,
        data: {
          ride_id: rideId,
        },
        deep_link: "/rider/rides-history",
      });
    }

    // Notify the driver if ride was accepted
    if (ride.status === "accepted" && ride.driver_id) {
      const { data: driver } = await supabaseAdmin!
        .from("drivers")
        .select("user_id")
        .eq("id", ride.driver_id)
        .single();

      if (driver?.user_id) {
        await sendPushNotification(driver.user_id, {
          title: "Ride Cancelled",
          body: waiveFee
            ? "The rider cancelled the ride (no fee - driver communicated)"
            : "The rider cancelled the ride (cancellation fee may apply)",
          type: "ride_cancelled",
          data: { rideId, type: "ride_cancelled", feeWaived: waiveFee },
        });
      }
    }

    // Notify the rider
    await sendPushNotification(ride.rider_id, {
      title: "Ride Cancelled",
      body: cancellationFee > 0
        ? `Ride cancelled. Cancellation fee: ₦${cancellationFee.toLocaleString()}`
        : waiveFee
          ? "Ride cancelled without fee (driver communicated)"
          : "Ride cancelled successfully",
      type: "ride_cancelled",
      data: { rideId, type: "ride_cancelled", cancellationFee },
    });

    return NextResponse.json({
      success: true,
      message: "Ride cancelled successfully",
      rideId,
      cancellationFee,
      feeWaived: waiveFee,
    });
  } catch (error) {
    console.error("[RIDE_CANCEL]", error);
    return NextResponse.json({ error: "Failed to cancel ride" }, { status: 500 });
  }
}
