import { after } from "next/server"

import { supabaseAdmin } from "@/lib/supabase"
import { notifyAdmins } from "@/lib/admin-notifications"
import { sendPushNotification } from "@/lib/push-service"
import { emitRideAccepted, emitRideTaken } from "@/lib/push-emitters"
import { sendNativeLiveTrackingNotification } from "@/lib/live-tracking-native"
import { sendRideAcceptanceSMS, sendSMS } from "@/lib/termii"
import { sendRideReceiptEmail } from "@/lib/ride-receipt-email"

/**
 * Everything that must happen *after* a ride has been accepted — rider push,
 * driver push, other-driver "ride taken" broadcast, SMS to both parties, receipt
 * emails, admin notification and the native live-tracking notification.
 *
 * It lives here (rather than inline in the API route) so every acceptance path
 * fires the exact same bundle:
 *   - `acceptRideFirstCome` (app route and Termii SMS webhook)
 *   - the API route's "already accepted via the fast Supabase path" branch
 *
 * Dispatch is deferred with `after()` so the driver's accept call returns the
 * moment the row is assigned — notifications no longer add latency to it.
 */

export type RideAcceptanceSource = "app" | "sms"

export interface RideAcceptedNotificationInput {
  /** The ride row as it stands after acceptance. */
  ride: any
  /** drivers.id of the accepting driver. */
  driverId: string
  /** users.id of the accepting driver. */
  driverUserId: string
  /** Driver ETA in minutes, if the client sent one. */
  etaMinutes?: number | null
  source: RideAcceptanceSource
}

const DRIVER_VEHICLE_LABEL = "Keke Tricycle"
const NOTIFIED_MARKER = "accepted_notified_at"

function extractCoordinates(description?: string): { latitude: number; longitude: number } | null {
  if (!description) return null
  const latMatch = description.match(/Lat:\s*([-\d.]+)/)
  const lngMatch = description.match(/Lng:\s*([-\d.]+)/)
  if (latMatch && lngMatch) {
    return { latitude: parseFloat(latMatch[1]), longitude: parseFloat(lngMatch[1]) }
  }
  return null
}

function formatLagosTime(value?: string | null) {
  try {
    return new Intl.DateTimeFormat("en-NG", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "Africa/Lagos",
    }).format(new Date(value || Date.now()))
  } catch {
    return String(value || new Date().toISOString())
  }
}

/**
 * Claims the notification slot for this ride so retries / duplicate calls
 * (client retry, webhook + app racing) cannot text and email the rider twice.
 * A failed claim write is not fatal — we would rather double-notify than not at all.
 */
async function claimNotificationSlot(ride: any): Promise<boolean> {
  if (!supabaseAdmin) return false

  const metadata = ride?.metadata && typeof ride.metadata === "object" ? ride.metadata : {}
  if (metadata?.[NOTIFIED_MARKER]) return false

  const { error } = await supabaseAdmin
    .from("rides")
    .update({
      metadata: {
        ...metadata,
        [NOTIFIED_MARKER]: new Date().toISOString(),
      },
    })
    .eq("id", ride.id)

  if (error) {
    console.warn("[RideAcceptedNotifications] Could not claim notification slot:", error.message)
  }

  return true
}

export async function dispatchRideAcceptedNotifications(input: RideAcceptedNotificationInput) {
  const ride = input.ride
  const rideId = String(ride?.id || "")

  if (!rideId) {
    console.warn("[RideAcceptedNotifications] Missing ride id, skipping")
    return { skipped: "missing_ride" as const }
  }

  if (!supabaseAdmin) {
    console.warn("[RideAcceptedNotifications] Database client not initialized, skipping")
    return { skipped: "no_db" as const }
  }

  if (!(await claimNotificationSlot(ride))) {
    console.log("[RideAcceptedNotifications] Already notified, skipping", { rideId })
    return { skipped: "already_notified" as const }
  }

  const now = new Date().toISOString()

  const [{ data: driverUser }, { data: riderUser }, { data: driverRow }] = await Promise.all([
    supabaseAdmin!
      .from("users")
      .select("first_name, last_name, phone_number, email")
      .eq("id", input.driverUserId)
      .single(),
    supabaseAdmin!
      .from("users")
      .select("first_name, last_name, phone_number, email")
      .eq("id", ride.rider_id)
      .single(),
    supabaseAdmin!
      .from("drivers")
      .select("id, plate_number, vehicle_type")
      .eq("id", input.driverId)
      .single(),
  ])

  const driverName =
    [driverUser?.first_name, driverUser?.last_name].filter(Boolean).join(" ").trim() || "Driver"
  const driverPhone = driverUser?.phone_number || ""
  const vehiclePlate = driverRow?.plate_number || ""
  const fare = Number(ride.fare_amount ?? ride.fare ?? 0)
  const etaMinutes =
    Number.isFinite(Number(input.etaMinutes)) && Number(input.etaMinutes) > 0
      ? Math.round(Number(input.etaMinutes))
      : 10

  // Each channel is independent: one failing never blocks the others, and every
  // failure is logged so a silent miss (the bug this module fixes) shows up in logs.
  const tasks: Array<Promise<unknown>> = []

  tasks.push(
    emitRideAccepted(
      ride.rider_id,
      input.driverUserId,
      rideId,
      driverName,
      driverPhone,
      driverRow?.vehicle_type || DRIVER_VEHICLE_LABEL,
      etaMinutes,
      ride.pickup_zone,
      ride.destination_zone,
      fare
    ).catch((error) => console.error("[RideAcceptedNotifications] rider/driver push failed:", error))
  )

  tasks.push(
    emitRideTaken(rideId).catch((error) =>
      console.error("[RideAcceptedNotifications] ride-taken broadcast failed:", error)
    )
  )

  // Native live-tracking notification (emoji visuals, sticky channel on Android).
  const pickupCoords = extractCoordinates(ride.pickup_description)
  const destCoords = extractCoordinates(ride.destination_description)
  if (pickupCoords && destCoords) {
    tasks.push(
      sendNativeLiveTrackingNotification({
        rideId,
        riderId: ride.rider_id,
        driverName,
        driverLocation: { lat: 0, lng: 0 }, // Replaced on the driver's first location update
        pickupLocation: {
          lat: pickupCoords.latitude,
          lng: pickupCoords.longitude,
          address: ride.pickup_zone,
        },
        destinationLocation: {
          lat: destCoords.latitude,
          lng: destCoords.longitude,
          address: ride.destination_zone,
        },
        etaMinutes,
        distanceKm: 5,
        status: "accepted",
        vehiclePlate,
      }).catch((error) =>
        console.error("[RideAcceptedNotifications] live tracking notification failed:", error)
      )
    )
  } else {
    console.warn("[RideAcceptedNotifications] Missing coordinates, skipping live tracking card", { rideId })
  }

  if (driverPhone) {
    tasks.push(
      sendRideAcceptanceSMS(driverPhone, rideId, riderUser?.first_name, ride.pickup_time)
        .then(() => console.log("[RideAcceptedNotifications] SMS sent to driver", { rideId }))
        .catch((error) => console.error("[RideAcceptedNotifications] driver SMS failed:", error))
    )
  } else {
    console.warn("[RideAcceptedNotifications] Driver has no phone number, skipping driver SMS", { rideId })
  }

  if (riderUser?.phone_number) {
    const riderSMSMessage = `✅ DRIVER FOUND - CK-${rideId.slice(0, 8).toUpperCase()}

Your ride has been accepted!
Driver: ${driverName}
Pickup time: ${formatLagosTime(ride.pickup_time || ride.created_at)}
Open in app: charterkeke:///rider/ride-details?rideId=${rideId}

📍 They are heading to your pickup location.
🔔 You will receive updates soon.

Get ready for pickup!`

    tasks.push(
      sendSMS({
        to: riderUser.phone_number,
        message: riderSMSMessage,
        channel: "dnd",
        type: "plain",
      })
        .then(() => console.log("[RideAcceptedNotifications] SMS sent to rider", { rideId }))
        .catch((error) => console.error("[RideAcceptedNotifications] rider SMS failed:", error))
    )
  } else {
    console.warn("[RideAcceptedNotifications] Rider has no phone number, skipping rider SMS", { rideId })
  }

  const emailRide = { ...ride, rider: riderUser, driver: driverRow, driverUser }

  if (riderUser?.email) {
    tasks.push(
      sendRideReceiptEmail({ to: riderUser.email, ride: emailRide, audience: "rider" }).catch((error) =>
        console.error("[RideAcceptedNotifications] rider receipt email failed:", error)
      )
    )
  }
  if (driverUser?.email) {
    tasks.push(
      sendRideReceiptEmail({ to: driverUser.email, ride: emailRide, audience: "driver" }).catch((error) =>
        console.error("[RideAcceptedNotifications] driver receipt email failed:", error)
      )
    )
  }

  tasks.push(
    notifyAdmins({
      allAdmins: true,
      department: "ops",
      title: "Ride accepted",
      body: `${driverName} accepted a ride from ${ride.pickup_zone} to ${ride.destination_zone}.`,
      type: "ride_accepted",
      actionUrl: `/admin/rides?ride=${rideId}`,
      metadata: {
        rideId,
        riderId: ride.rider_id,
        driverUserId: input.driverUserId,
        driverId: input.driverId,
      },
      sourceEventId: `ride_accepted:${rideId}:${input.driverUserId}`,
    }).catch((error) => console.error("[RideAcceptedNotifications] admin notification failed:", error))
  )

  const settled = await Promise.allSettled(tasks)
  const failed = settled.filter((entry) => entry.status === "rejected").length

  console.log("[RideAcceptedNotifications] Dispatch complete", {
    rideId,
    source: input.source,
    channels: tasks.length,
    failed,
    completedAt: now,
  })

  return { success: true as const, channels: tasks.length, failed }
}

/**
 * Fire the whole bundle after the response has been sent, so accepting a ride
 * stays instant. Falls back to a detached promise outside a request scope
 * (scripts, cron, tests).
 */
export function scheduleRideAcceptedNotifications(input: RideAcceptedNotificationInput) {
  const run = () =>
    dispatchRideAcceptedNotifications(input).catch((error) => {
      console.error("[RideAcceptedNotifications] Dispatch crashed:", error)
    })

  try {
    after(run)
    console.log("[RideAcceptedNotifications] Dispatch scheduled after response", {
      rideId: input.ride?.id,
      source: input.source,
    })
  } catch {
    // Not inside a Next request scope — run it detached instead of dropping it.
    void run()
  }
}

/**
 * Standalone rider push used only when the shared bundle has already claimed the
 * slot (for example a re-accept after a failed notification write). Keeping the
 * payload here means both callers send the same thing.
 */
export async function sendRideAcceptedPushToRider(params: {
  rideId: string
  riderId: string
  driverId: string
  driverName: string
  pickupZone?: string
  destinationZone?: string
}) {
  await sendPushNotification([params.riderId], {
    title: "✅ Driver Accepted",
    body: `${params.driverName} accepted your ride request. Heading to pickup location.`,
    type: "ride_accepted",
    categoryId: "ride_accepted_action",
    data: {
      rideId: params.rideId,
      deeplink: `/rider/active-ride?rideId=${params.rideId}`,
      driverId: params.driverId,
      driverName: params.driverName,
      pickupZone: params.pickupZone,
      destinationZone: params.destinationZone,
    },
  })
}
