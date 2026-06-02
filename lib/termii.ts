// Termii SMS/OTP Integration (server-side only)

export interface TermiiSendSMSOptions {
  to: string
  message: string
  from?: string
  channel?: "generic" | "dnd" | "whatsapp" | "voice"
  type?: "plain" | "unicode" | "encrypted"
}

interface TermiiSendOTPOptions {
  to: string
  pinLength?: number
  pinType?: "NUMERIC" | "ALPHANUMERIC"
  pinTimeToLive?: number
  pinAttempts?: number
}

interface TermiiVerifyOTPOptions {
  pinId: string
  pin: string
}

interface RideRequestSMSOptions {
  to: string
  rideId: string
  pickup: string
  destination: string
  pickupTime?: string | Date | null
  fare: number
}

type JsonLike = Record<string, unknown>

const TERMII_BASE_URL = (process.env.TERMII_BASE_URL || "https://api.ng.termii.com").replace(/\/+$/, "")
const TERMII_API_URL = `${TERMII_BASE_URL}/api`

function getTermiiConfig() {
  const apiKey = process.env.TERMII_API_KEY
  const senderId = process.env.TERMII_SENDER_ID || "charterkeke"

  if (!apiKey) {
    throw new Error("Termii API key not configured")
  }

  return { apiKey, senderId }
}

export function toTermiiPhoneNumber(rawPhone: string): string | null {
  if (!rawPhone) return null

  const digits = rawPhone.replace(/\D/g, "")
  if (!digits) return null

  if (digits.startsWith("2340") && digits.length === 14) {
    return `234${digits.slice(4)}`
  }

  if (digits.startsWith("234") && digits.length === 13) {
    return digits
  }

  if (digits.startsWith("0") && digits.length === 11) {
    return `234${digits.slice(1)}`
  }

  return null
}

async function postTermii(path: string, payload: JsonLike) {
  const response = await fetch(`${TERMII_API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  const responseText = await response.text()
  let responseBody: JsonLike | string = {}

  try {
    responseBody = responseText ? JSON.parse(responseText) : {}
  } catch {
    responseBody = responseText
  }

  if (!response.ok) {
    throw new Error(
      `Termii request failed (${response.status}): ${typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody)}`
    )
  }

  if (typeof responseBody === "object" && responseBody !== null) {
    const code = String((responseBody as any).code || "").toLowerCase()
    if (code && code !== "ok" && code !== "success") {
      throw new Error(`Termii non-success response: ${JSON.stringify(responseBody)}`)
    }
  }

  return responseBody
}

export async function sendSMS(options: TermiiSendSMSOptions) {
  const { apiKey, senderId } = getTermiiConfig()

  const normalizedPhone = toTermiiPhoneNumber(options.to)
  if (!normalizedPhone) {
    throw new Error(`Invalid destination phone number: ${options.to}`)
  }

  // Try the requested channel first, then fallback to alternatives
  const channels = [options.channel || "generic"]
  if (options.channel !== "generic") channels.push("generic")
  if (options.channel !== "dnd") channels.push("dnd")

  let lastError: Error | null = null
  for (const channel of channels) {
    try {
      console.log(`[Termii] Attempting to send SMS via ${channel} channel`)
      const result = await postTermii("/sms/send", {
        to: normalizedPhone,
        from: options.from || senderId,
        sms: options.message,
        type: options.type || "plain",
        channel,
        api_key: apiKey,
      })
      console.log(`[Termii] SMS sent successfully via ${channel}`, { to: normalizedPhone })
      return result
    } catch (error) {
      lastError = error as Error
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (errorMsg.includes("Country Inactive") || errorMsg.includes("400")) {
        console.log(`[Termii] ${channel} channel failed, trying next channel...`, errorMsg)
        continue
      }
      // If it's a different error, throw immediately
      throw error
    }
  }

  // If all channels failed, throw the last error
  if (lastError) {
    throw lastError
  }

  throw new Error("All SMS channels failed")
}

export async function sendRideRequestSMS(options: RideRequestSMSOptions) {
  const shortRideRef = options.rideId.slice(0, 8).toUpperCase()
  const pickupTime = formatRidePickupTime(options.pickupTime)
  const message = `CHARTER KEKE RIDE REQUEST
  
New ride: CK-${shortRideRef}
From: ${options.pickup}
To: ${options.destination}
Pickup time: ${pickupTime}
Fare: ₦${Math.round(options.fare || 0)}

TO ACCEPT THIS RIDE:
1. Accept the ride in your driver app as soon as possible.
2. Accept via the email sent to you (check spam folder if not in inbox).
3. Accept it in the notification sent to your phone.

Open requests expire at the end of the scheduled pickup day.`

  // Try DND first (transactional), fallback to generic automatically via sendSMS
  return sendSMS({
    to: options.to,
    message,
    channel: "dnd",
    type: "plain",
  })
}

function formatRidePickupTime(value?: string | Date | null) {
  if (!value) return "ASAP"

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)

  return new Intl.DateTimeFormat("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Africa/Lagos",
  }).format(date)
}

export async function sendOTP(options: TermiiSendOTPOptions) {
  const { apiKey, senderId } = getTermiiConfig()

  const normalizedPhone = toTermiiPhoneNumber(options.to)
  if (!normalizedPhone) {
    throw new Error(`Invalid OTP destination phone number: ${options.to}`)
  }

  return postTermii("/sms/otp/send", {
    api_key: apiKey,
    message_type: "NUMERIC",
    to: normalizedPhone,
    from: senderId,
    channel: "generic",
    pin_attempts: options.pinAttempts || 3,
    pin_time_to_live: options.pinTimeToLive || 10,
    pin_length: options.pinLength || 6,
    pin_placeholder: "< 1234 >",
    message_text: "Your Charter Keke verification code is < 1234 >. Valid for 10 minutes.",
    pin_type: options.pinType || "NUMERIC",
  })
}

export async function verifyOTP(options: TermiiVerifyOTPOptions) {
  const { apiKey } = getTermiiConfig()

  return postTermii("/sms/otp/verify", {
    api_key: apiKey,
    pin_id: options.pinId,
    pin: options.pin,
  })
}

export async function sendBulkSMS(phoneNumbers: string[], message: string, channel: "generic" | "dnd" = "generic") {
  const { apiKey, senderId } = getTermiiConfig()

  const validPhones = phoneNumbers
    .map(phone => toTermiiPhoneNumber(phone))
    .filter((phone): phone is string => phone !== null)

  if (validPhones.length === 0) {
    throw new Error("No valid phone numbers for bulk SMS")
  }

  // Split into batches of 100 (Termii limit)
  const batches = []
  for (let i = 0; i < validPhones.length; i += 100) {
    batches.push(validPhones.slice(i, i + 100))
  }

  const results = await Promise.allSettled(
    batches.map(batch =>
      postTermii("/sms/send/bulk", {
        to: batch,
        from: senderId,
        sms: message,
        type: "plain",
        channel,
        api_key: apiKey,
      })
    )
  )

  const failed = results.filter(r => r.status === "rejected")
  if (failed.length > 0) {
    console.error("[Termii] Some bulk SMS batches failed:", failed.map((r) => (r as PromiseRejectedResult).reason))
  }

  return {
    totalPhones: validPhones.length,
    batches: batches.length,
    results,
  }
}

export async function sendRideAcceptanceSMS(driverPhone: string, rideId: string, riderName?: string) {
  const message = `RIDE ACCEPTED - CK-${rideId.slice(0, 8).toUpperCase()}

You have accepted the ride.
${riderName ? `Rider: ${riderName}` : ""}

You will receive pickup location soon.
Watch for updates from Charter Keke.

Safe travels!`

  return sendSMS({
    to: driverPhone,
    message,
    channel: "dnd",
    type: "plain",
  })
}

export async function sendRideStatusUpdateSMS(driverPhone: string, rideId: string, status: string, message?: string) {
  const defaultMessages: Record<string, string> = {
    "in_progress": `TRIP STARTED - CK-${rideId.slice(0, 8).toUpperCase()}

Your trip has begun. 
Start driving safely to the pickup location.

Follow navigation directions.`,
    "completed": `TRIP COMPLETED - CK-${rideId.slice(0, 8).toUpperCase()}

Excellent work! Trip completed successfully.

The Passenger will pay to you directly.
Rider may rate your service soon.

Thank you for driving with Charter Keke!`,
    "cancelled": `RIDE CANCELLED - CK-${rideId.slice(0, 8).toUpperCase()}

Unfortunately, this ride has been cancelled.

You can accept other ride requests.`,
  }

  const smsMessage = message || defaultMessages[status] || `Ride ${rideId.slice(0, 8).toUpperCase()} status: ${status}`

  return sendSMS({
    to: driverPhone,
    message: smsMessage,
    channel: "dnd",
    type: "plain",
  })
}
