import { supabaseAdmin } from "@/lib/supabase";
import { sendPushNotification, broadcastToDrivers } from "@/lib/push-service";
import { notifyAdmins } from "@/lib/admin-notifications";
import { getDriverRemittanceSummary } from "@/lib/driver-settlement";
import { FREE_CANCEL_AFTER_ACCEPT_MS, resolveAcceptedAt } from "@/lib/cancellation-policy";

/**
 * Ride driver change requests.
 *
 * A driver who has accepted a ride cannot cancel it. Inside the same free
 * window the rider has (5 minutes from acceptance) they may instead REQUEST a
 * handover. The request is broadcast to every other online driver; the first to
 * accept takes the ride over.
 *
 * "Everything saved on the previous driver's account moves to the new driver"
 * is automatic: remittance, earnings and ride counts are all derived from
 * `rides.driver_id`, so reassigning the ride moves them. Both drivers' daily
 * settlements are recomputed here so the numbers are correct immediately
 * rather than on the next accept/completion/cron.
 */

export type ChangeRequestStatus =
  | "open"
  | "accepted"
  | "cancelled"
  | "expired"
  | "rejected"
  | "admin_reassigned";

export interface ChangeRequestResult {
  success: boolean;
  status: number;
  code?: string;
  message?: string;
  request?: any;
  ride?: any;
}

const RIDE_FIELDS =
  "id, rider_id, driver_id, status, fare_amount, platform_fee, driver_earnings, remitted, accepted_at, pickup_zone, destination_zone, pickup_address, destination_address, metadata, created_at, updated_at";

function nowIso() {
  return new Date().toISOString();
}

async function driverForUser(userId: string) {
  const { data } = await supabaseAdmin!
    .from("drivers")
    .select("id, user_id, availability_status, manual_availability_off, lock_status")
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

async function driverUserId(driverId: string | null | undefined) {
  if (!driverId) return null;
  const { data } = await supabaseAdmin!
    .from("drivers")
    .select("user_id")
    .eq("id", driverId)
    .maybeSingle();
  return data?.user_id ?? null;
}

/** Expire anything past its window so no screen ever shows a dead request. */
export async function expireStaleChangeRequests() {
  try {
    await supabaseAdmin!
      .from("ride_driver_change_requests")
      .update({ status: "expired", updated_at: nowIso() })
      .eq("status", "open")
      .lt("expires_at", nowIso());
  } catch (error: any) {
    console.error("[DRIVER_CHANGE] Expiry sweep failed (non-critical):", error?.message);
  }
}

/**
 * Driver asks for this ride to be handed to someone else.
 * Only allowed inside the free window, and only once per ride at a time.
 */
export async function requestDriverChange(input: {
  rideId: string;
  driverUserId: string;
  reason: string;
}): Promise<ChangeRequestResult> {
  const { rideId, driverUserId: userId, reason } = input;

  const driver = await driverForUser(userId);
  if (!driver?.id) {
    return { success: false, status: 404, code: "driver_not_found", message: "Driver profile not found" };
  }

  const { data: ride } = await supabaseAdmin!
    .from("rides")
    .select(RIDE_FIELDS)
    .eq("id", rideId)
    .maybeSingle();

  if (!ride) {
    return { success: false, status: 404, code: "ride_not_found", message: "Ride not found" };
  }
  if (ride.driver_id !== driver.id) {
    return { success: false, status: 403, code: "not_your_ride", message: "This ride is not assigned to you" };
  }
  if (ride.status !== "accepted") {
    return {
      success: false,
      status: 400,
      code: "ride_not_changeable",
      message: "A ride can only be handed over before the trip starts",
    };
  }
  if (ride.remitted) {
    return {
      success: false,
      status: 400,
      code: "ride_already_remitted",
      message: "This ride has already been remitted and cannot be transferred",
    };
  }

  const acceptedAt = resolveAcceptedAt(ride);
  if (acceptedAt === null) {
    return {
      success: false,
      status: 400,
      code: "no_acceptance_time",
      message: "This ride has no acceptance time recorded",
    };
  }

  const expiresAtMs = acceptedAt + FREE_CANCEL_AFTER_ACCEPT_MS;
  if (Date.now() > expiresAtMs) {
    return {
      success: false,
      status: 400,
      code: "window_closed",
      message:
        "The handover window has closed. Contact support if you cannot complete this ride.",
    };
  }

  // One live request per ride.
  const { data: existing } = await supabaseAdmin!
    .from("ride_driver_change_requests")
    .select("id, status, expires_at")
    .eq("ride_id", rideId)
    .eq("status", "open")
    .maybeSingle();

  if (existing) {
    return {
      success: true,
      status: 200,
      code: "already_requested",
      message: "A handover request is already open for this ride",
      request: existing,
    };
  }

  const { data: request, error } = await supabaseAdmin!
    .from("ride_driver_change_requests")
    .insert({
      ride_id: rideId,
      current_driver_id: driver.id,
      requested_by_user_id: userId,
      reason: reason?.trim() || "Driver requested a handover",
      status: "open",
      requested_at: nowIso(),
      expires_at: new Date(expiresAtMs).toISOString(),
      metadata: {
        fare_amount: ride.fare_amount,
        pickup_zone: ride.pickup_zone,
        destination_zone: ride.destination_zone,
      },
    })
    .select("*")
    .single();

  if (error) {
    console.error("[DRIVER_CHANGE] Failed to create request:", error);
    return { success: false, status: 500, code: "insert_failed", message: "Could not create the handover request" };
  }

  // Broadcast to every other online driver.
  let broadcastCount = 0;
  try {
    const results = await broadcastToDrivers(
      {
        title: "Ride available — driver handover",
        body: `A driver needs to hand over a ride from ${ride.pickup_zone || "pickup"} to ${
          ride.destination_zone || "destination"
        }. Tap to take it.`,
        type: "ride_request",
        data: {
          type: "ride_driver_change_request",
          requestId: request.id,
          rideId,
          pickupZone: ride.pickup_zone,
          destinationZone: ride.destination_zone,
          fareAmount: ride.fare_amount,
        },
      },
      [userId]
    );
    broadcastCount = Array.isArray(results) ? results.length : 0;
  } catch (broadcastError: any) {
    console.error("[DRIVER_CHANGE] Broadcast failed (non-critical):", broadcastError?.message);
  }

  await supabaseAdmin!
    .from("ride_driver_change_requests")
    .update({ broadcast_count: broadcastCount })
    .eq("id", request.id);

  // Let admins see it in the queue.
  try {
    await notifyAdmins({
      department: "operations",
      title: "Driver requested a ride handover",
      body: `A driver requested a handover for a ride from ${ride.pickup_zone || "pickup"} to ${
        ride.destination_zone || "destination"
      }. Reason: ${reason || "not given"}.`,
      type: "ride_driver_change_request",
      actionUrl: "/admin/ride-change-requests",
      sourceEventId: `driver-change:${request.id}`,
      metadata: { requestId: request.id, rideId, driverId: driver.id, reason },
    });
  } catch (adminError: any) {
    console.error("[DRIVER_CHANGE] Admin notify failed (non-critical):", adminError?.message);
  }

  return {
    success: true,
    status: 201,
    message: "Handover requested. Nearby drivers have been notified.",
    request: { ...request, broadcast_count: broadcastCount },
  };
}

/** Open handovers this driver is allowed to take (never their own). */
export async function listOpenChangeRequests(driverUserId: string) {
  await expireStaleChangeRequests();

  const driver = await driverForUser(driverUserId);
  if (!driver?.id) return [];

  const { data: requests, error } = await supabaseAdmin!
    .from("ride_driver_change_requests")
    .select("*")
    .eq("status", "open")
    .neq("current_driver_id", driver.id)
    .gt("expires_at", nowIso())
    .order("requested_at", { ascending: false })
    .limit(10);

  if (error || !requests?.length) {
    if (error) console.error("[DRIVER_CHANGE] List failed:", error.message);
    return [];
  }

  const rideIds = requests.map((r: any) => r.ride_id);
  const { data: rides } = await supabaseAdmin!
    .from("rides")
    .select("id, status, driver_id, pickup_zone, destination_zone, pickup_address, destination_address, fare_amount, ride_type, distance_km, created_at")
    .in("id", rideIds);

  const rideMap = new Map((rides || []).map((r: any) => [r.id, r]));

  return requests
    .map((request: any) => {
      const ride = rideMap.get(request.ride_id);
      // The ride may have moved on (cancelled, completed, already handed over).
      if (!ride || ride.status !== "accepted" || ride.driver_id !== request.current_driver_id) {
        return null;
      }
      return {
        id: request.id,
        rideId: request.ride_id,
        reason: request.reason,
        requestedAt: request.requested_at,
        expiresAt: request.expires_at,
        secondsRemaining: Math.max(
          0,
          Math.floor((new Date(request.expires_at).getTime() - Date.now()) / 1000)
        ),
        ride: {
          id: ride.id,
          pickupZone: ride.pickup_zone,
          destinationZone: ride.destination_zone,
          pickupAddress: ride.pickup_address,
          destinationAddress: ride.destination_address,
          fareAmount: Number(ride.fare_amount || 0),
          rideType: ride.ride_type,
          distanceKm: ride.distance_km,
        },
      };
    })
    .filter(Boolean);
}

/**
 * Another driver takes the ride over. The ride keeps its id, rider and fare;
 * only the driver changes, so remittance/earnings/ride counts follow it.
 */
export async function acceptDriverChange(input: {
  requestId: string;
  driverUserId: string;
}): Promise<ChangeRequestResult> {
  const { requestId, driverUserId: userId } = input;

  const driver = await driverForUser(userId);
  if (!driver?.id) {
    return { success: false, status: 404, code: "driver_not_found", message: "Driver profile not found" };
  }
  if (driver.lock_status && driver.lock_status !== "active") {
    return {
      success: false,
      status: 403,
      code: "account_locked",
      message: "Your account is under review and cannot take new rides",
    };
  }

  // A driver already on a trip cannot take a second one.
  const { data: existingActive } = await supabaseAdmin!
    .from("rides")
    .select("id")
    .eq("driver_id", driver.id)
    .in("status", ["accepted", "in_progress"])
    .limit(1)
    .maybeSingle();

  if (existingActive) {
    return {
      success: false,
      status: 409,
      code: "already_on_ride",
      message: "Finish your current ride before taking another",
    };
  }

  const { data: request } = await supabaseAdmin!
    .from("ride_driver_change_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();

  if (!request) {
    return { success: false, status: 404, code: "request_not_found", message: "Handover request not found" };
  }
  if (request.status !== "open") {
    return {
      success: false,
      status: 409,
      code: "request_not_open",
      message: "This handover has already been taken or has expired",
    };
  }
  if (request.current_driver_id === driver.id) {
    return { success: false, status: 400, code: "own_request", message: "You cannot take your own handover" };
  }
  if (new Date(request.expires_at).getTime() < Date.now()) {
    await supabaseAdmin!
      .from("ride_driver_change_requests")
      .update({ status: "expired", updated_at: nowIso() })
      .eq("id", requestId);
    return { success: false, status: 410, code: "request_expired", message: "This handover has expired" };
  }

  const { data: ride } = await supabaseAdmin!
    .from("rides")
    .select(RIDE_FIELDS)
    .eq("id", request.ride_id)
    .maybeSingle();

  if (!ride) {
    return { success: false, status: 404, code: "ride_not_found", message: "Ride not found" };
  }
  if (ride.status !== "accepted" || ride.driver_id !== request.current_driver_id) {
    await supabaseAdmin!
      .from("ride_driver_change_requests")
      .update({ status: "cancelled", updated_at: nowIso() })
      .eq("id", requestId);
    return {
      success: false,
      status: 409,
      code: "ride_moved_on",
      message: "This ride is no longer available for handover",
    };
  }

  const previousDriverId = request.current_driver_id;
  const acceptedAt = nowIso();

  // Claim the request first — the conditional update makes this race-safe, so
  // two drivers tapping at once cannot both win.
  const { data: claimed, error: claimError } = await supabaseAdmin!
    .from("ride_driver_change_requests")
    .update({
      status: "accepted",
      accepted_by_driver_id: driver.id,
      accepted_at: acceptedAt,
      updated_at: acceptedAt,
    })
    .eq("id", requestId)
    .eq("status", "open")
    .select("id")
    .maybeSingle();

  if (claimError || !claimed) {
    return {
      success: false,
      status: 409,
      code: "request_not_open",
      message: "Another driver just took this ride",
    };
  }

  // Move the ride. accepted_at restarts so the new driver gets a full window.
  const { error: rideError } = await supabaseAdmin!
    .from("rides")
    .update({
      driver_id: driver.id,
      accepted_at: acceptedAt,
      updated_at: acceptedAt,
      metadata: {
        ...(ride.metadata || {}),
        driver_change: {
          from_driver_id: previousDriverId,
          to_driver_id: driver.id,
          request_id: requestId,
          changed_at: acceptedAt,
          reason: request.reason,
        },
      },
    })
    .eq("id", ride.id)
    .eq("driver_id", previousDriverId);

  if (rideError) {
    console.error("[DRIVER_CHANGE] Ride reassignment failed:", rideError);
    // Put the request back so someone else can still take it.
    await supabaseAdmin!
      .from("ride_driver_change_requests")
      .update({ status: "open", accepted_by_driver_id: null, accepted_at: null, updated_at: nowIso() })
      .eq("id", requestId);
    return { success: false, status: 500, code: "reassign_failed", message: "Could not reassign the ride" };
  }

  // Availability: previous driver back in the pool, new driver busy.
  try {
    await supabaseAdmin!
      .from("drivers")
      .update({ availability_status: "online", updated_at: acceptedAt })
      .eq("id", previousDriverId);
    await supabaseAdmin!
      .from("drivers")
      .update({ availability_status: "busy", updated_at: acceptedAt })
      .eq("id", driver.id);
  } catch (availabilityError: any) {
    console.error("[DRIVER_CHANGE] Availability update failed (non-critical):", availabilityError?.message);
  }

  // Remittance follows the ride — recompute both drivers so the fee moves now.
  try {
    await Promise.all([
      getDriverRemittanceSummary(previousDriverId),
      getDriverRemittanceSummary(driver.id),
    ]);
  } catch (remittanceError: any) {
    console.error("[DRIVER_CHANGE] Remittance recompute failed (non-critical):", remittanceError?.message);
  }

  // Notify everyone involved.
  try {
    const [previousUserId, riderId] = await Promise.all([
      driverUserId(previousDriverId),
      Promise.resolve(ride.rider_id),
    ]);

    if (previousUserId) {
      await sendPushNotification(previousUserId, {
        title: "Ride handed over",
        body: "Another driver has taken this ride. You are back in the online queue.",
        type: "ride_update",
        data: { rideId: ride.id, type: "ride_driver_change_accepted" },
      } as any);
    }

    await sendPushNotification(userId, {
      title: "Ride assigned to you",
      body: `You took over a ride from ${ride.pickup_zone || "pickup"} to ${
        ride.destination_zone || "destination"
      }. Head to the pickup point.`,
      type: "ride_accepted",
      data: { rideId: ride.id, type: "ride_driver_change_accepted" },
    } as any);

    if (riderId) {
      await sendPushNotification(riderId, {
        title: "Your driver has changed",
        body: "A new driver has taken over your ride and is on the way.",
        type: "ride_update",
        data: { rideId: ride.id, type: "ride_driver_changed" },
      } as any);
    }
  } catch (notifyError: any) {
    console.error("[DRIVER_CHANGE] Notifications failed (non-critical):", notifyError?.message);
  }

  return {
    success: true,
    status: 200,
    message: "Ride taken over. Head to the pickup point.",
    request: { ...request, status: "accepted", accepted_by_driver_id: driver.id, accepted_at: acceptedAt },
    ride: { ...ride, driver_id: driver.id, accepted_at: acceptedAt },
  };
}

/** The requesting driver withdraws their own handover request. */
export async function cancelDriverChangeRequest(input: {
  rideId: string;
  driverUserId: string;
}): Promise<ChangeRequestResult> {
  const driver = await driverForUser(input.driverUserId);
  if (!driver?.id) {
    return { success: false, status: 404, code: "driver_not_found", message: "Driver profile not found" };
  }

  const { data: request } = await supabaseAdmin!
    .from("ride_driver_change_requests")
    .select("id, current_driver_id, status")
    .eq("ride_id", input.rideId)
    .eq("status", "open")
    .maybeSingle();

  if (!request) {
    return { success: true, status: 200, message: "No open handover request for this ride" };
  }
  if (request.current_driver_id !== driver.id) {
    return { success: false, status: 403, code: "not_your_request", message: "This is not your request" };
  }

  await supabaseAdmin!
    .from("ride_driver_change_requests")
    .update({ status: "cancelled", updated_at: nowIso() })
    .eq("id", request.id);

  return { success: true, status: 200, message: "Handover request withdrawn" };
}

/** Admin approves (force-reassign) or rejects a request. */
export async function adminReviewChangeRequest(input: {
  requestId: string;
  adminUserId: string;
  action: "approve" | "reject";
  note?: string;
  newDriverId?: string;
}): Promise<ChangeRequestResult> {
  const { requestId, adminUserId, action, note, newDriverId } = input;

  const { data: request } = await supabaseAdmin!
    .from("ride_driver_change_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();

  if (!request) {
    return { success: false, status: 404, code: "request_not_found", message: "Handover request not found" };
  }
  if (request.status !== "open") {
    return { success: false, status: 409, code: "request_not_open", message: "This request is no longer open" };
  }

  if (action === "reject") {
    await supabaseAdmin!
      .from("ride_driver_change_requests")
      .update({
        status: "rejected",
        reviewed_by: adminUserId,
        reviewed_at: nowIso(),
        admin_note: note ?? null,
        updated_at: nowIso(),
      })
      .eq("id", requestId);

    const previousUserId = await driverUserId(request.current_driver_id);
    if (previousUserId) {
      await sendPushNotification(previousUserId, {
        title: "Handover request declined",
        body: note
          ? `An admin declined your handover request: ${note}`
          : "An admin declined your handover request. Please continue with the ride or contact support.",
        type: "ride_update",
        data: { rideId: request.ride_id, type: "ride_driver_change_rejected" },
      } as any);
    }

    return { success: true, status: 200, message: "Request rejected" };
  }

  // Approve: reassign to a specific driver, or back to the dispatch pool.
  const { data: ride } = await supabaseAdmin!
    .from("rides")
    .select(RIDE_FIELDS)
    .eq("id", request.ride_id)
    .maybeSingle();

  if (!ride) {
    return { success: false, status: 404, code: "ride_not_found", message: "Ride not found" };
  }

  const previousDriverId = request.current_driver_id;
  const stamp = nowIso();

  if (newDriverId) {
    const { error } = await supabaseAdmin!
      .from("rides")
      .update({
        driver_id: newDriverId,
        accepted_at: stamp,
        updated_at: stamp,
        metadata: {
          ...(ride.metadata || {}),
          driver_change: {
            from_driver_id: previousDriverId,
            to_driver_id: newDriverId,
            request_id: requestId,
            changed_at: stamp,
            by: "admin",
            admin_user_id: adminUserId,
            reason: request.reason,
          },
        },
      })
      .eq("id", ride.id);

    if (error) {
      return { success: false, status: 500, code: "reassign_failed", message: "Could not reassign the ride" };
    }

    await supabaseAdmin!
      .from("drivers")
      .update({ availability_status: "busy", updated_at: stamp })
      .eq("id", newDriverId);
  } else {
    // No replacement chosen: release the ride back to dispatch.
    const { error } = await supabaseAdmin!
      .from("rides")
      .update({
        driver_id: null,
        status: "dispatched",
        accepted_at: null,
        updated_at: stamp,
        metadata: {
          ...(ride.metadata || {}),
          driver_change: {
            from_driver_id: previousDriverId,
            to_driver_id: null,
            request_id: requestId,
            changed_at: stamp,
            by: "admin",
            admin_user_id: adminUserId,
            reason: request.reason,
          },
        },
      })
      .eq("id", ride.id);

    if (error) {
      return { success: false, status: 500, code: "release_failed", message: "Could not release the ride" };
    }
  }

  await supabaseAdmin!
    .from("ride_driver_change_requests")
    .update({
      status: "admin_reassigned",
      accepted_by_driver_id: newDriverId ?? null,
      accepted_at: stamp,
      reviewed_by: adminUserId,
      reviewed_at: stamp,
      admin_note: note ?? null,
      updated_at: stamp,
    })
    .eq("id", requestId);

  try {
    await supabaseAdmin!
      .from("drivers")
      .update({ availability_status: "online", updated_at: stamp })
      .eq("id", previousDriverId);

    await Promise.all([
      getDriverRemittanceSummary(previousDriverId),
      newDriverId ? getDriverRemittanceSummary(newDriverId) : Promise.resolve(null),
    ]);
  } catch (error: any) {
    console.error("[DRIVER_CHANGE] Admin post-reassign side effects failed (non-critical):", error?.message);
  }

  const previousUserId = await driverUserId(previousDriverId);
  if (previousUserId) {
    await sendPushNotification(previousUserId, {
      title: "Handover approved",
      body: "An admin approved your handover. The ride has been reassigned and you are back online.",
      type: "ride_update",
      data: { rideId: ride.id, type: "ride_driver_change_approved" },
    } as any);
  }

  return { success: true, status: 200, message: "Request approved and ride reassigned" };
}
