import { type NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { supabaseAdmin } from "@/lib/supabase"
import { acceptRideFirstCome } from "@/lib/ride-acceptance"
import { toTermiiPhoneNumber } from "@/lib/termii"

function getHeader(request: NextRequest, key: string) {
  return request.headers.get(key) || request.headers.get(key.toLowerCase())
}

function verifyWebhookSignature(rawBody: string, signature: string, secret: string) {
  const expected = crypto.createHmac("sha512", secret).update(rawBody).digest("hex")

  if (expected.length !== signature.length) {
    return false
  }

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}

function safeCompare(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

function getWebhookAuth(request: NextRequest, rawBody: string, body: any) {
  const webhookSecret = process.env.TERMII_WEBHOOK_SECRET
  const requireSignature = process.env.TERMII_REQUIRE_WEBHOOK_SIGNATURE === "true"
  if (!webhookSecret) return { authenticated: !requireSignature, requireSignature }

  const signature =
    getHeader(request, "x-termii-signature") ||
    getHeader(request, "x-termii-signature-hash") ||
    getHeader(request, "termii-signature")

  const sharedSecret =
    getHeader(request, "x-webhook-secret") ||
    getHeader(request, "x-termii-webhook-secret") ||
    request.nextUrl.searchParams.get("secret") ||
    (typeof body?.secret === "string" ? body.secret : "")

  const validSignature = signature ? verifyWebhookSignature(rawBody, signature, webhookSecret) : false
  const validSharedSecret = sharedSecret ? safeCompare(sharedSecret, webhookSecret) : false

  return {
    authenticated: validSignature || validSharedSecret || !requireSignature,
    requireSignature,
    hasSignature: Boolean(signature),
    hasSharedSecret: Boolean(sharedSecret),
    invalidSignature: Boolean(signature && !validSignature),
  }
}

function getTermiiEventType(body: any) {
  const explicit = String(body?.type || body?.event || body?.event_type || "").toLowerCase()
  if (explicit) return explicit

  const hasDeliveryStatus = Boolean(body?.message_id || body?.messageId || body?.status || body?.delivery_status)
  const hasIncomingMessage = Boolean(
    (body?.from || body?.msisdn || body?.phone_number || body?.sender) &&
      (body?.message || body?.sms || body?.text || body?.content)
  )

  if (hasIncomingMessage) return "inbound"
  if (hasDeliveryStatus) return "delivery_report"
  return ""
}

function extractDeliveryReport(body: any) {
  return {
    messageId: body?.message_id || body?.messageId || body?.id || null,
    status: body?.status || body?.delivery_status || body?.message_status || null,
    phone: body?.to || body?.receiver || body?.phone_number || body?.msisdn || null,
    network: body?.network || body?.operator || null,
    raw: body,
  }
}

function extractIncomingMessage(body: any) {
  // Termii "inbound" event uses different field names
  // See Termii docs: https://termii.com/documentation
  const from = String(body?.from || body?.msisdn || body?.phone_number || body?.sender || "").trim()
  const message = String(body?.message || body?.sms || body?.text || body?.content || "").trim()
  
  return { from, message }
}

function extractRideAcceptCommand(message: string) {
  if (!message) return { isAccept: false as const, rideId: null as string | null }

  const isAccept = /\baccept\b/i.test(message)
  const rideIdMatch = message.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)

  return {
    isAccept,
    rideId: rideIdMatch?.[0]?.toLowerCase() || null,
  }
}

async function findDriverUserByPhone(phone: string) {
  if (!supabaseAdmin) return null

  const normalized = toTermiiPhoneNumber(phone)
  if (!normalized) return null

  const variants = Array.from(
    new Set([normalized, `+${normalized}`, `0${normalized.slice(3)}`])
  )

  for (const variant of variants) {
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("id, phone_number")
      .eq("role", "driver")
      .eq("phone_number", variant)
      .maybeSingle()

    if (user) return user
  }

  const last10 = normalized.slice(-10)
  const { data: users } = await supabaseAdmin
    .from("users")
    .select("id, phone_number")
    .eq("role", "driver")
    .ilike("phone_number", `%${last10}`)
    .limit(1)

  return users?.[0] || null
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const body = rawBody ? JSON.parse(rawBody) : {}

    // Handle Termii webhook events
    console.log("[Termii] Webhook received:", body)

    const eventType = getTermiiEventType(body)
    const auth = getWebhookAuth(request, rawBody, body)

    if (!auth.authenticated && eventType !== "delivery_report") {
      console.warn("[Termii-Webhook] Rejected unauthenticated actionable webhook", {
        eventType,
        hasSignature: auth.hasSignature,
        hasSharedSecret: auth.hasSharedSecret,
        invalidSignature: auth.invalidSignature,
      })
      return NextResponse.json({ error: "Webhook verification failed" }, { status: 401 })
    }

    if (!auth.authenticated && eventType === "delivery_report") {
      console.warn("[Termii-Webhook] Delivery report received without valid webhook signature/secret; acknowledged only")
    }

    // Handle different event types
    switch (eventType) {
      case "delivery_report":
        // Message delivery status
        console.log("[Termii-Webhook] Delivery report:", extractDeliveryReport(body))
        break

      case "inbound":
      case "incoming_sms":
        {
          const { from, message } = extractIncomingMessage(body)
          console.log("[Termii-Webhook] Incoming SMS from:", from, "Message:", message)

          const command = extractRideAcceptCommand(message)

          if (!command.isAccept || !command.rideId) {
            console.log("[Termii-Webhook] No valid ACCEPT command found in message")
            return NextResponse.json({
              received: true,
              ignored: true,
              reason: "No valid ACCEPT command with ride ID",
            })
          }

          console.log("[Termii-Webhook] ACCEPT command found, rideId:", command.rideId)

          const driverUser = await findDriverUserByPhone(from)
          if (!driverUser) {
            console.error("[Termii-Webhook] Driver not found for phone:", from)
            return NextResponse.json({
              received: true,
              ignored: true,
              reason: "Driver not found for incoming phone number",
            })
          }

          console.log("[Termii-Webhook] Driver found:", driverUser.id)

          const acceptance = await acceptRideFirstCome({
            rideId: command.rideId,
            driverUserId: driverUser.id,
            source: "sms",
          })

          if (!acceptance.success && acceptance.status === 409) {
            console.log("[Termii-Webhook] Ride already taken or unavailable")
            return NextResponse.json(
              {
                received: true,
                accepted: false,
                reason: "Ride already taken",
              },
              { status: 409 }
            )
          }

          if (!acceptance.success) {
            console.error("[Termii-Webhook] Acceptance failed:", acceptance)
            return NextResponse.json(
              {
                received: true,
                accepted: false,
                error: acceptance.message,
                code: acceptance.code,
              },
              { status: acceptance.status }
            )
          }

          console.log("[Termii-Webhook] ✅ Ride accepted successfully", {
            rideId: command.rideId,
            driverUserId: driverUser.id,
          })

          return NextResponse.json({
            received: true,
            accepted: true,
            rideId: command.rideId,
            driverUserId: driverUser.id,
          })
        }

        break

      default:
        console.log("[Termii-Webhook] Unhandled event type:", eventType)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error("[Termii] Webhook error:", error)
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}
