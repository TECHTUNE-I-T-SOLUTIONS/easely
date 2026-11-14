/**
 * Rider / driver cancellation policy
 * ----------------------------------
 * One source of truth for the free-cancellation windows and the fine, shared by
 * the cancel API routes and anything else that needs to explain the rules.
 *
 * Rider rules
 *  - Before a driver accepts (pending / dispatched): always free.
 *  - Within FREE_CANCEL_AFTER_ACCEPT_MS of the driver accepting: free.
 *  - After that window: CANCELLATION_PENALTY_PERCENT of the fare is charged and
 *    added to the rider's next booking.
 *  - Once the ride is in progress or finished: cannot be cancelled.
 *
 * Driver rules
 *  - A driver may cancel an accepted ride before it starts.
 *  - More than DRIVER_DAILY_CANCEL_LIMIT cancellations in one day locks the
 *    account for admin review.
 */

export const FREE_CANCEL_AFTER_ACCEPT_MS = 5 * 60 * 1000
export const CANCELLATION_PENALTY_PERCENT = 30
export const DRIVER_DAILY_CANCEL_LIMIT = 2

export type CancellationCode =
  | "free_before_accept"
  | "free_within_window"
  | "penalty"
  | "not_cancellable"
  | "already_terminal"

export interface CancellationDecision {
  allowed: boolean
  isFree: boolean
  feeAmount: number
  feePercent: number
  code: CancellationCode
  message: string
  /** ISO timestamp when the free window closes (null when already closed / not applicable). */
  freeWindowEndsAt: string | null
  /** Whole seconds left in the free window (0 once it has closed). */
  secondsRemainingInFreeWindow: number
  /** Minutes elapsed since the driver accepted, when known. */
  minutesSinceAcceptance: number | null
}

export interface CancellableRide {
  status?: string | null
  fare_amount?: number | string | null
  accepted_at?: string | null
  updated_at?: string | null
  created_at?: string | null
  metadata?: Record<string, any> | null
}

const TERMINAL_STATUSES = ["completed", "cancelled", "in_progress", "started"]

function toNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Best-effort acceptance timestamp: column first, then metadata, then updated_at. */
export function resolveAcceptedAt(ride: CancellableRide): number | null {
  const candidates = [
    ride.accepted_at,
    ride.metadata?.accepted_at,
    ride.metadata?.driver_accepted_at,
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    const time = new Date(candidate).getTime()
    if (Number.isFinite(time)) return time
  }
  return null
}

export function evaluateRiderCancellation(
  ride: CancellableRide,
  now: number = Date.now()
): CancellationDecision {
  const status = String(ride.status || "").toLowerCase()
  const fare = toNumber(ride.fare_amount)

  if (TERMINAL_STATUSES.includes(status)) {
    return {
      allowed: false,
      isFree: false,
      feeAmount: 0,
      feePercent: 0,
      code: "already_terminal",
      message:
        status === "in_progress" || status === "started"
          ? "This ride has already started and can no longer be cancelled"
          : `This ride is already ${status}`,
      freeWindowEndsAt: null,
      secondsRemainingInFreeWindow: 0,
      minutesSinceAcceptance: null,
    }
  }

  const acceptedAt = resolveAcceptedAt(ride)

  // No driver yet — always free.
  if (!acceptedAt) {
    return {
      allowed: true,
      isFree: true,
      feeAmount: 0,
      feePercent: 0,
      code: "free_before_accept",
      message: "Free cancellation — no driver has accepted this ride yet",
      freeWindowEndsAt: null,
      secondsRemainingInFreeWindow: 0,
      minutesSinceAcceptance: null,
    }
  }

  const elapsedMs = Math.max(0, now - acceptedAt)
  const remainingMs = FREE_CANCEL_AFTER_ACCEPT_MS - elapsedMs
  const minutesSinceAcceptance = Math.round((elapsedMs / 60000) * 10) / 10

  if (remainingMs > 0) {
    return {
      allowed: true,
      isFree: true,
      feeAmount: 0,
      feePercent: 0,
      code: "free_within_window",
      message: "Free cancellation — you are still inside the free window",
      freeWindowEndsAt: new Date(acceptedAt + FREE_CANCEL_AFTER_ACCEPT_MS).toISOString(),
      secondsRemainingInFreeWindow: Math.ceil(remainingMs / 1000),
      minutesSinceAcceptance,
    }
  }

  const feeAmount = Math.round(fare * (CANCELLATION_PENALTY_PERCENT / 100) * 100) / 100

  return {
    allowed: true,
    isFree: false,
    feeAmount,
    feePercent: CANCELLATION_PENALTY_PERCENT,
    code: "penalty",
    message: `The free cancellation window has closed. A ${CANCELLATION_PENALTY_PERCENT}% cancellation fee applies`,
    freeWindowEndsAt: null,
    secondsRemainingInFreeWindow: 0,
    minutesSinceAcceptance,
  }
}

export interface DriverCancellationDecision {
  allowed: boolean
  code: "allowed" | "not_cancellable" | "already_terminal"
  message: string
}

export function evaluateDriverCancellation(ride: CancellableRide): DriverCancellationDecision {
  const status = String(ride.status || "").toLowerCase()

  if (TERMINAL_STATUSES.includes(status)) {
    return {
      allowed: false,
      code: "already_terminal",
      message:
        status === "in_progress" || status === "started"
          ? "You cannot cancel a ride that has already started"
          : `This ride is already ${status}`,
    }
  }

  if (!["accepted", "arrived"].includes(status)) {
    return {
      allowed: false,
      code: "not_cancellable",
      message: "Only an accepted ride can be cancelled by the driver",
    }
  }

  return { allowed: true, code: "allowed", message: "Ride can be cancelled" }
}

/** Lagos-local calendar day key (YYYY-MM-DD) used for the daily driver limit. */
export function lagosDayKey(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  return formatter.format(date)
}
