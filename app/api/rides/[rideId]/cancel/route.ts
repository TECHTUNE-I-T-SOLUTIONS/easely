import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { sendPushNotification } from "@/lib/push-service";
import { applyRideCancellationEffects, type RideCancellationResult } from "@/lib/ride-cancellation-effects";
import {
  evaluateRiderCancellation,
  type CancellationDecision,
} from "@/lib/cancellation-policy";

type Params = { params: Promise<{ rideId: string }> };

const RIDE_FIELDS =
  "id, rider_id, driver_id, status, fare_amount, accepted_at, updated_at, created_at, metadata";

function parseNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * GET — cancellation gate for this ride.
 * The rider screens call this so the free/penalty/blocked state always comes
 * from the server clock instead of the device clock.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { rideId } = await params;
  try {
    const session = await getSessionFromRequest(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: ride, error } = await supabaseAdmin!
      .from("rides")
      .select(RIDE_FIELDS)
      .eq("id", rideId)
      .single();

    if (error || !ride) {
      return NextResponse.json({ error: "Ride not found" }, { status: 404 });
    }
    if (ride.rider_id !== session.user.id) {
      return NextResponse.json({ error: "You can only cancel your own rides" }, { status: 403 });
    }

    const decision = evaluateRiderCancellation(ride);

    const { data: userRow } = await supabaseAdmin
      .from("users")
      .select("pending_cancellation_penalty")
      .eq("id", session.user.id)
      .maybeSingle();

    const response = NextResponse.json({
      rideId,
      status: ride.status,
      acceptedAt: ride.accepted_at ?? null,
      cancellation: decision,
      pendingCancellationPenalty: parseNumber(userRow?.pending_cancellation_penalty),
      serverTime: new Date().toISOString(),
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error: any) {
    console.error("[RIDE_CANCEL][GET] error:", error?.message);
    return NextResponse.json({ error: "Failed to check cancellation status" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { rideId } = await params;
  try {
    const session = await getSessionFromRequest(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { reason, waiver = false } = body || {};

    if (!rideId) {
      return NextResponse.json({ error: "Ride ID is required" }, { status: 400 });
    }

    const { data: ride, error: rideError } = await supabaseAdmin!
      .from("rides")
      .select(RIDE_FIELDS)
      .eq("id", rideId)
      .single();

    if (rideError || !ride) {
      console.error("[RIDE_CANCEL] Ride not found:", { rideId, rideError });
      return NextResponse.json(
        {
          error: "Ride not found",
          details:
            rideError?.message ||
            "The specified ride does not exist or may have been cancelled already",
          rideId,
        },
        { status: 404 }
      );
    }

    if (ride.rider_id !== session.user.id) {
      console.log("[RIDE_CANCEL] User does not own this ride:", {
        sessionUserId: session.user.id,
        rideRiderId: ride.rider_id,
      });
      return NextResponse.json({ error: "You can only cancel your own rides", rideId }, { status: 403 });
    }

    // The server decides the gate and the amount — never the client.
    const decision: CancellationDecision = evaluateRiderCancellation(ride);

    if (!decision.allowed) {
      return NextResponse.json(
        {
          error: decision.message,
          code: decision.code,
          currentStatus: ride.status,
          cancellation: decision,
          rideId,
        },
        { status: 400 }
      );
    }

    // A waiver is only meaningful when the rider is outside the free window.
    // Inside the window there is nothing to waive.
    const waiveFee = !decision.isFree && Boolean(waiver);
    const cancellationFee = decision.isFree || waiveFee ? 0 : decision.feeAmount;
    const cancelledAt = new Date().toISOString();

    const { error: updateError } = await supabaseAdmin!
      .from("rides")
      .update({
        status: "cancelled",
        updated_at: cancelledAt,
        metadata: {
          ...(ride.metadata || {}),
          fee_waived: waiveFee,
          cancellation_reason: reason || "User cancelled",
          cancellation_fee: cancellationFee,
          cancellation_fee_percent: cancellationFee > 0 ? decision.feePercent : 0,
          cancelled_by: "rider",
          cancelled_at: cancelledAt,
          cancellation_context: {
            code: decision.code,
            elapsed_since_acceptance: decision.minutesSinceAcceptance,
            free_window_ends_at: decision.freeWindowEndsAt,
            fare_amount: parseNumber(ride.fare_amount),
          },
        },
      })
      .eq("id", rideId);

    if (updateError) {
      console.error("[RIDE_CANCEL] Failed to update ride status:", updateError);
      return NextResponse.json(
        { error: "Failed to cancel ride", details: updateError?.message, code: updateError?.code },
        { status: 500 }
      );
    }

    let penaltyId: string | null = null;
    let pendingCancellationPenalty = 0;

    if (cancellationFee > 0) {
      try {
        const { data: userData } = await supabaseAdmin
          .from("users")
          .select("pending_cancellation_penalty")
          .eq("id", session.user.id)
          .single();

        const currentPenalty = parseNumber(userData?.pending_cancellation_penalty);
        pendingCancellationPenalty = Math.round((currentPenalty + cancellationFee) * 100) / 100;

        await supabaseAdmin
          .from("users")
          .update({ pending_cancellation_penalty: pendingCancellationPenalty })
          .eq("id", session.user.id);

        const { data: penaltyRow } = await supabaseAdmin
          .from("rider_penalties")
          .insert({
            user_id: session.user.id,
            ride_id: rideId,
            penalty_type: "cancellation",
            penalty_amount: cancellationFee,
            penalty_percent: decision.feePercent / 100,
            ride_fare_amount: parseNumber(ride.fare_amount),
            status: "pending",
            metadata: {
              reason: reason || "User cancelled",
              elapsed_since_acceptance: decision.minutesSinceAcceptance,
              free_window_ends_at: decision.freeWindowEndsAt,
            },
          })
          .select("id")
          .single();

        penaltyId = penaltyRow?.id ?? null;

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
            penalty_percent: decision.feePercent,
            ride_id: rideId,
            pending_total: pendingCancellationPenalty,
          },
          deep_link: "/rider/cashback",
        });
      } catch (penaltyError) {
        console.error("[RIDE_CANCEL] Failed to record penalty (non-critical):", penaltyError);
      }
    } else if (waiveFee) {
      try {
        await supabaseAdmin.from("notifications").insert({
          user_id: session.user.id,
          title: "Cancellation Fee Waived",
          message: "Your cancellation fee has been waived due to driver communication.",
          type: "penalty_waived",
          channel: "in_app",
          related_table: "rides",
          related_id: rideId,
          data: { ride_id: rideId },
          deep_link: "/rider/rides-history",
        });
      } catch (notificationError) {
        console.error("[RIDE_CANCEL] Failed to send waiver notification (non-critical):", notificationError);
      }
    } else {
      pendingCancellationPenalty = 0;
      try {
        const { data: userData } = await supabaseAdmin
          .from("users")
          .select("pending_cancellation_penalty")
          .eq("id", session.user.id)
          .maybeSingle();
        pendingCancellationPenalty = parseNumber(userData?.pending_cancellation_penalty);
      } catch {
        /* non-critical */
      }
    }

    // Driver side: release them back into the dispatch pool, recompute today's
    // remittance without this ride, record the cancellation against their day,
    // flag for review past the threshold, and notify them.
    let driverEffects: RideCancellationResult | null = null;
    try {
      driverEffects = await applyRideCancellationEffects({
        rideId,
        driverId: ride.driver_id,
        rideStatus: ride.status,
        cancelledBy: "rider",
        reason: reason || "User cancelled",
        feeCharged: cancellationFee,
      });
    } catch (driverEffectsError) {
      console.error("[RIDE_CANCEL] Driver cancellation effects failed (non-critical):", driverEffectsError);
    }

    try {
      await sendPushNotification(ride.rider_id, {
        title: "Ride Cancelled",
        body:
          cancellationFee > 0
            ? `Ride cancelled. A ₦${cancellationFee.toLocaleString()} fee was added to your next ride.`
            : waiveFee
              ? "Ride cancelled without fee (driver communicated)"
              : "Ride cancelled successfully",
        type: "ride_cancelled",
        data: { rideId, type: "ride_cancelled", cancellationFee },
      } as any);
    } catch (riderNotifyError) {
      console.error("[RIDE_CANCEL] Failed to notify rider (non-critical):", riderNotifyError);
    }

    return NextResponse.json({
      success: true,
      message:
        cancellationFee > 0
          ? `Ride cancelled. A ₦${cancellationFee.toLocaleString()} fee has been added to your next booking.`
          : "Ride cancelled successfully",
      rideId,
      cancellation: {
        ...decision,
        isFree: cancellationFee === 0,
        feeAmount: cancellationFee,
      },
      cancellationFee,
      feeWaived: waiveFee,
      penaltyId,
      penaltyRecorded: cancellationFee > 0 && penaltyId !== null,
      pendingCancellationPenalty,
      driver: driverEffects
        ? {
            released: driverEffects.driverReleased,
            availabilityStatus: driverEffects.availabilityStatus,
            remittanceRecomputed: driverEffects.remittanceRecomputed,
            todayRemittanceDue: driverEffects.todayRemittanceDue,
            notified: driverEffects.driverNotified,
          }
        : null,
    });
  } catch (error: any) {
    console.error("[RIDE_CANCEL] Unexpected error:", {
      message: error?.message,
      stack: error?.stack,
      rideId,
    });
    return NextResponse.json(
      { error: "Failed to cancel ride", details: error?.message || "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
