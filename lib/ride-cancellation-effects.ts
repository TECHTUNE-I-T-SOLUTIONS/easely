import { supabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/push-service";
import { getDriverRemittanceSummary } from "@/lib/driver-settlement";
import { notifyAdmins } from "@/lib/admin-notifications";
import { DRIVER_DAILY_CANCEL_LIMIT, lagosDayKey } from "@/lib/cancellation-policy";

/**
 * Everything that has to happen to the DRIVER when a ride they accepted is
 * cancelled. Drivers cannot cancel themselves — only the rider, an admin or the
 * system can cancel — so this module is the single place that:
 *
 *   1. puts the driver back in the dispatch pool (they are stuck on `busy`
 *      otherwise and invisible to every dispatch query),
 *   2. recomputes today's remittance so the cancelled ride's platform fee is no
 *      longer owed (`driver_daily_settlement` is derived from rides),
 *   3. records the rider-cancellation against the driver's day so a driver who
 *      keeps losing accepted rides to rider cancellations gets investigated,
 *   4. notifies the driver.
 *
 * The driver is NOT punished here: a rider cancelling is not the driver's
 * fault, so this only raises an investigation for admins. It never sets
 * `lock_status`, so the driver keeps working while the case is reviewed.
 */

export type CancelledBy = "rider" | "admin" | "system";

export interface RideCancellationInput {
  rideId: string;
  driverId: string | null | undefined;
  rideStatus: string;
  cancelledBy: CancelledBy;
  reason?: string | null;
  feeCharged?: number;
}

export interface RideCancellationResult {
  handled: boolean;
  driverId: string | null;
  /** availability_status after the reset, or null when untouched */
  availabilityStatus: string | null;
  /** true when the driver was actually moved back into the pool */
  driverReleased: boolean;
  remittanceRecomputed: boolean;
  todayRemittanceDue: number | null;
  /** rider cancellations recorded against this driver for the Lagos day */
  riderCancellationsToday: number;
  /** true when today's count crossed the review threshold */
  flaggedForReview: boolean;
  driverNotified: boolean;
}

const EMPTY: RideCancellationResult = {
  handled: false,
  driverId: null,
  availabilityStatus: null,
  driverReleased: false,
  remittanceRecomputed: false,
  todayRemittanceDue: null,
  riderCancellationsToday: 0,
  flaggedForReview: false,
  driverNotified: false,
};

function numberOf(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * A driver only counts as "released" if the ride had actually committed them —
 * an unaccepted ride never put them on `busy` in the first place.
 */
function rideCommittedDriver(status: string): boolean {
  return status === "accepted" || status === "in_progress" || status === "arrived";
}

export async function applyRideCancellationEffects(
  input: RideCancellationInput
): Promise<RideCancellationResult> {
  const { rideId, driverId, rideStatus, cancelledBy, reason, feeCharged = 0 } = input;

  if (!driverId) return { ...EMPTY };

  const result: RideCancellationResult = { ...EMPTY, handled: true, driverId };
  const committed = rideCommittedDriver(rideStatus);
  const dayKey = lagosDayKey();

  // ---------------------------------------------------------------------
  // 1. Remittance — recompute from rides so the cancelled ride drops out.
  //    `driver_daily_settlement` totals are derived from rides whose status is
  //    accepted/in_progress/completed, so recalculating removes the fee.
  // ---------------------------------------------------------------------
  let remittanceBlocked = false;
  try {
    const remittance = await getDriverRemittanceSummary(driverId);
    remittanceBlocked = Boolean(remittance?.blocked);
    result.remittanceRecomputed = true;
    result.todayRemittanceDue = numberOf(remittance?.todayTotal);
  } catch (error: any) {
    console.error("[CANCEL_EFFECTS] Remittance recompute failed (non-critical):", {
      driverId,
      rideId,
      message: error?.message,
    });
  }

  // ---------------------------------------------------------------------
  // 2. Availability — accept-ride sets the driver to `busy`, and nothing on the
  //    cancellation path used to undo it. Without this the driver stays
  //    invisible to dispatch until their app happens to poll /driver/status.
  // ---------------------------------------------------------------------
  try {
    const { data: driver } = await supabaseAdmin!
      .from("drivers")
      .select("*")
      .eq("id", driverId)
      .maybeSingle();

    if (driver) {
      const manualOff = Boolean(driver.manual_availability_off);
      // A driver with overdue remittance is intentionally kept offline.
      const target = remittanceBlocked || manualOff ? "offline" : "online";

      if (committed || driver.availability_status === "busy") {
        const { error } = await supabaseAdmin!
          .from("drivers")
          .update({ availability_status: target, updated_at: new Date().toISOString() })
          .eq("id", driverId);

        if (error) {
          console.error("[CANCEL_EFFECTS] Availability reset failed:", error.message);
        } else {
          result.availabilityStatus = target;
          result.driverReleased = target === "online";
        }
      } else {
        result.availabilityStatus = driver.availability_status ?? null;
      }
    }
  } catch (error: any) {
    console.error("[CANCEL_EFFECTS] Availability reset threw (non-critical):", error?.message);
  }

  // ---------------------------------------------------------------------
  // 3. Record the cancellation against the driver's day. Only rides that had
  //    actually been committed to the driver count — those are the ones where
  //    the driver lost real work to a rider cancellation.
  // ---------------------------------------------------------------------
  if (committed) {
    try {
      const { error } = await supabaseAdmin!
        .from("driver_ride_cancellations")
        .upsert(
          {
            driver_id: driverId,
            ride_id: rideId,
            day_key: dayKey,
            cancelled_by: cancelledBy,
            ride_status_at_cancel: rideStatus,
            reason: reason ?? null,
            fee_charged: feeCharged,
          },
          { onConflict: "ride_id" }
        );

      if (error) {
        // 42P01 = table missing (migration not applied yet) — degrade quietly.
        if (error.code === "42P01") {
          console.warn(
            "[CANCEL_EFFECTS] driver_ride_cancellations missing — run supabase/2026-11-14-cashback-idempotency-and-cancellation-policy.sql"
          );
        } else {
          console.error("[CANCEL_EFFECTS] Failed to record driver cancellation:", error.message);
        }
      }
    } catch (error: any) {
      console.error("[CANCEL_EFFECTS] Failed to record driver cancellation:", error?.message);
    }

    // Count today's rider cancellations for this driver.
    try {
      const { count, error } = await supabaseAdmin!
        .from("driver_ride_cancellations")
        .select("id", { count: "exact", head: true })
        .eq("driver_id", driverId)
        .eq("day_key", dayKey)
        .eq("cancelled_by", "rider");

      if (!error) {
        result.riderCancellationsToday = count || 0;
      }
    } catch {
      /* non-critical */
    }

    // -------------------------------------------------------------------
    // 4. More than DRIVER_DAILY_CANCEL_LIMIT rider cancellations in one day is
    //    worth a human look — the driver may be being targeted, or may be
    //    discouraging riders into cancelling. Flag for review; do NOT lock.
    // -------------------------------------------------------------------
    if (result.riderCancellationsToday > DRIVER_DAILY_CANCEL_LIMIT) {
      try {
        const { error } = await supabaseAdmin!
          .from("driver_investigations")
          .upsert(
            {
              driver_id: driverId,
              day_key: dayKey,
              trigger_reason: "rider_cancellations_exceeded_threshold",
              cancellation_count: result.riderCancellationsToday,
              threshold: DRIVER_DAILY_CANCEL_LIMIT,
              status: "open",
            },
            { onConflict: "driver_id,day_key" }
          );

        if (error && error.code !== "42P01") {
          console.error("[CANCEL_EFFECTS] Failed to open investigation:", error.message);
        } else if (!error) {
          result.flaggedForReview = true;
          await notifyAdmins({
            department: "integrity",
            title: "Driver review: repeated rider cancellations",
            body:
              `A driver has had ${result.riderCancellationsToday} accepted rides cancelled by riders today ` +
              `(threshold ${DRIVER_DAILY_CANCEL_LIMIT}). Review whether they are being targeted or are ` +
              `discouraging riders from completing trips.`,
            type: "driver_cancellation_review",
            actionUrl: `/admin/drivers/${driverId}`,
            sourceEventId: `driver-investigation:${driverId}:${dayKey}`,
            metadata: {
              driverId,
              dayKey,
              rideId,
              cancellationCount: result.riderCancellationsToday,
              threshold: DRIVER_DAILY_CANCEL_LIMIT,
            },
          });
        }
      } catch (error: any) {
        console.error("[CANCEL_EFFECTS] Failed to open investigation:", error?.message);
      }
    }
  }

  // ---------------------------------------------------------------------
  // 5. Tell the driver. Push first (works with the app closed), then an in-app
  //    row so it is still there when they open the app.
  // ---------------------------------------------------------------------
  try {
    const { data: driverUser } = await supabaseAdmin!
      .from("drivers")
      .select("user_id")
      .eq("id", driverId)
      .maybeSingle();

    const driverUserId = driverUser?.user_id;

    if (driverUserId) {
      const body =
        cancelledBy === "rider"
          ? "The rider cancelled this ride. You have been returned to the online queue."
          : "This ride was cancelled. You have been returned to the online queue.";

      await sendPushNotification(driverUserId, {
        title: "Ride Cancelled",
        body,
        type: "ride_cancelled",
        data: {
          rideId,
          type: "ride_cancelled",
          cancelledBy,
          feeCharged,
          availabilityStatus: result.availabilityStatus,
        },
      } as any);

      await supabaseAdmin!.from("notifications").insert({
        user_id: driverUserId,
        title: "Ride Cancelled",
        message: body,
        type: "ride_cancelled",
        channel: "in_app",
        related_table: "rides",
        related_id: rideId,
        data: {
          ride_id: rideId,
          cancelled_by: cancelledBy,
          fee_charged: feeCharged,
        },
        deep_link: "/driver/home",
      });

      result.driverNotified = true;
    }
  } catch (error: any) {
    console.error("[CANCEL_EFFECTS] Driver notification failed (non-critical):", error?.message);
  }

  return result;
}
