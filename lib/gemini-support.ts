type SupportMessage = {
  role: "customer" | "assistant" | "admin"
  content: string
}

type SupportAIInput = {
  channel: "in_app" | "email"
  subject?: string | null
  customerName?: string | null
  customerEmail?: string | null
  latestMessage: string
  history?: SupportMessage[]
}

type SupportAIResult = {
  ok: boolean
  model?: string
  reply?: string
  shouldEscalate: boolean
  shouldResolve?: boolean
  confidence: number
  category?: string
  department?: string
  reason?: string
}

const DAPO_INTRO = "Hi, my name is Dapo, but you can also call me Daps. I'm your Charter Keke journey assistant."

const VAGUE_SUPPORT_OPTIONS = [
  "Ride issues - booking, pickup, live tracking, cancellation, or trip status",
  "Payment issues - cash/payment disagreement with a driver or driver remittance",
  "Driver complaints - conduct, delay, unsafe driving, or overcharging",
  "Account issues - login, profile, verification, notifications, or app access",
  "Safety or emergency concern - urgent help, SOS, harassment, or lost item",
  "Something else - describe it in one sentence",
]

const CHARTER_KEKE_APP_KNOWLEDGE = `
Charter Keke mobile app knowledge Dapo can use:

Rider/passenger experience:
- Signup/login: riders create an account, verify access with OTP/password flows, complete profile details, and can edit profile details/avatar later.
- Home: shows greeting, notification bell, theme toggle, profile shortcut, Book Now card, quick tour access, promo cards, stats, nearby map preview, recent rides, and floating support widget.
- Booking: riders choose pickup first, then destination, then pickup time, then review/confirm. Pickup can use current location, typed Google/Mapbox street search, recent locations, voice input, or map picker. Destination works the same. Riders can review fare, distance, pickup/dropoff, and pickup time before confirming.
- Ride matching: after booking, nearby verified/available drivers are notified. Rider gets updates when a driver accepts, starts, completes, or cancels.
- Active ride/ride details: riders can see route/trip status, driver details where available, ride breakdown, and progress.
- Rating: after completion, riders can rate/review the driver.
- Rides history: shows active and past rides with details.
- Alerts/notifications: ride updates, support replies, driver activity, account notices.
- Profile/more: notifications toggle, privacy/security, help & support, check for updates, about, privacy policy, terms, app tour, logout, delete account.
- Support: available from floating widget and profile/more. In-app support creates/continues tickets and can attach messages/screenshots.
- SOS: emergency/SOS requests capture last known location/device/active ride information for admin review where enabled.

Driver experience:
- Signup/login: drivers can register and upload vehicle/credential information. They can log in while pending verification, but driver actions are locked until admin verification.
- Awaiting verification: pending drivers see a waiting screen, can refresh status, and can contact support.
- Home: shows notification bell, online/offline status toggle, remittance lock warnings, earnings summary, active/completed ride stats, nearby map/ride activity, and floating support.
- Verification: only verified/approved drivers should receive ride request SMS/push and accept rides.
- Ride requests: verified online drivers can receive and accept available rides.
- Ride lifecycle: accepted -> arrived/started/in_progress -> completed, with cancellation handling where allowed. If a status already changed, Dapo should explain the app may need refresh rather than claiming failure.
- Earnings: shows today earnings, completed trips, ride totals, and settlement/remittance information.
- Wallet/remittance: drivers pay platform remittance/settlement owed to Charter Keke. Overdue remittance can lock ride acceptance until paid/verified.
- Documents/vehicle/bank accounts: drivers manage credentials, vehicle info, documents, and settlement/payment account information.
- Driver notifications: ride requests, rider updates, remittance/settlement alerts, support replies, account approval/verification.
- Driver support: available in profile and floating widget.

Payment and policy facts:
- Rider trip fare is paid directly to the driver in person. Charter Keke does not process rider card/wallet trip payments in-app.
- Driver remittance/settlement is separate: drivers owe platform fees/remittance to Charter Keke.
- Dapo must not promise refunds, punishment, account approval, cancellation overrides, or database changes.
- For safety, SOS, harassment, fraud, account access, refunds/remittance disputes, verification approval, or driver discipline, Dapo should collect the key details and escalate to human CRM support.
`

const GEMINI_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash-lite-preview-09-2025",
]

function isVagueSupportMessage(message: string) {
  const normalized = message.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "")
  if (!normalized) return true
  const compact = normalized.replace(/\s+/g, " ")
  return [
    "hi",
    "hello",
    "hey",
    "good morning",
    "good afternoon",
    "good evening",
    "help",
    "support",
    "i need help",
    "please help",
    "can you help",
  ].includes(compact)
}

function isNegativeClosure(message: string) {
  const compact = message.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ")
  return [
    "no",
    "nope",
    "nothing else",
    "no thanks",
    "no thank you",
    "all good",
    "it works now",
    "it works fine now",
    "resolved",
    "done",
    "okay done",
  ].includes(compact)
}

function hasDapoIntroduced(history?: SupportMessage[]) {
  return (history || []).some((item) => item.role === "assistant" && /dapo|daps|journey assistant/i.test(item.content || ""))
}

function vagueSupportReply(customerName?: string | null) {
  const greeting = customerName ? `Hello ${customerName},` : "Hello,"
  return `${greeting}

${DAPO_INTRO}

How can I help today? Reply with the number that best matches your issue:

1. ${VAGUE_SUPPORT_OPTIONS[0]}
2. ${VAGUE_SUPPORT_OPTIONS[1]}
3. ${VAGUE_SUPPORT_OPTIONS[2]}
4. ${VAGUE_SUPPORT_OPTIONS[3]}
5. ${VAGUE_SUPPORT_OPTIONS[4]}
6. ${VAGUE_SUPPORT_OPTIONS[5]}

You can also type a short description, and I will guide you from there.`
}

function supportPrompt(input: SupportAIInput) {
  const history = (input.history || [])
    .slice(-12)
    .map((item) => `${item.role.toUpperCase()}: ${item.content}`)
    .join("\n")

  return `
You are Dapo, Charter Keke's professional customer support assistant. Customers can also call you Daps.
If you have not introduced yourself in this conversation, introduce yourself once as: "${DAPO_INTRO}" Do not repeat the introduction after that.

Business facts:
- Charter Keke connects riders/passengers with keke drivers.
- Passenger/rider trip payments are paid directly to drivers in person. Do not claim card/wallet payment was processed by Charter Keke unless the user is discussing driver remittance/settlement.
- Be warm, concise, calm, and practical.
- If the customer message is vague, a greeting, or lacks enough detail, give a short numbered option menu for ride issues, payment issues, driver complaints, account issues, safety/emergency, and other.
- Ask one focused follow-up question when details are missing after the customer chooses a category.
- If the issue needs a human admin, safety review, account action, refund/remittance investigation, driver discipline, legal/privacy handling, or database changes, say a support agent will follow up and set shouldEscalate true.
- Department routing: payment/refund/remittance -> billing; app crash, login reset, OTP, bug, technical issue -> engineering; driver misconduct/safety/SOS/harassment -> safety; verification/account access/profile -> support; ride matching/status/cancellation -> operations.
- Super admins and support always remain notified. Other departments should only add internal notes; support replies to customers.
- If you previously asked whether anything else is needed and the customer clearly answers no/nothing else/all good/resolved, set shouldResolve true and reply briefly that the case can be marked resolved.
- If the customer issue is tied to a specific trip, ask for the ride reference/ride ID first when possible, along with the date and any amount/fare details. For fare discrepancy or overcharge reports, ask for:
  - ride reference or ride ID
  - trip date
  - pickup and destination
  - fare shown in the app
  - amount charged by the driver
- If the user does not know the ride ID, ask for the date and route so support can search the trip, then continue with the other missing details.
- Do not invent ride, payment, account, or driver details.
- Never promise refunds or enforcement outcomes.
- Do not answer outside Charter Keke customer support. If asked unrelated questions, politely redirect to Charter Keke support matters.

${CHARTER_KEKE_APP_KNOWLEDGE}

Return only JSON with:
{
  "reply": "customer-facing reply",
  "shouldEscalate": boolean,
  "shouldResolve": boolean,
  "confidence": number between 0 and 1,
  "category": "ride_issue|payment_issue|driver_complaint|account_issue|safety|technical|other",
  "department": "support|billing|engineering|safety|operations|general",
  "reason": "short internal reason"
}

Channel: ${input.channel}
Subject: ${input.subject || "Support request"}
Customer: ${input.customerName || input.customerEmail || "Customer"}

Conversation history:
${history || "(none)"}

Latest customer message:
${input.latestMessage}
`.trim()
}

function parseJson(text: string): any {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim()
  const match = cleaned.match(/\{[\s\S]*\}/)
  return JSON.parse(match ? match[0] : cleaned)
}

export async function generateSupportAIReply(input: SupportAIInput): Promise<SupportAIResult> {
  if (isNegativeClosure(input.latestMessage)) {
    return {
      ok: true,
      model: "dapo-template",
      reply: "Thank you for letting me know. I am glad we could resolve that for you. I will mark this support case as resolved now. Have a safe journey with Charter Keke.",
      shouldEscalate: false,
      shouldResolve: true,
      confidence: 1,
      category: "other",
      department: "support",
      reason: "Customer confirmed no further help is needed",
    }
  }

  if (isVagueSupportMessage(input.latestMessage)) {
    const reply = hasDapoIntroduced(input.history)
      ? vagueSupportReply(input.customerName).replace(`\n\n${DAPO_INTRO}`, "")
      : vagueSupportReply(input.customerName)

    return {
      ok: true,
      model: "dapo-template",
      reply,
      shouldEscalate: false,
      shouldResolve: false,
      confidence: 1,
      category: "other",
      department: "support",
      reason: "Vague support greeting handled with Dapo option menu",
    }
  }

  const normalizedLatest = input.latestMessage.toLowerCase()
  const tripSpecificKeywords = [
    "ride",
    "trip",
    "fare",
    "overcharge",
    "charged",
    "charge",
    "pickup",
    "dropoff",
    "destination",
    "route",
    "driver",
  ]
  const mentionsTrip = tripSpecificKeywords.some((keyword) => normalizedLatest.includes(keyword))
  const mentionsTripId = /\b(ride|trip)\s*(id|reference|ref)\b/i.test(input.latestMessage)
  const isPaymentDispute = /\b(fare|overcharge|charged|charge|discrepancy|amount)\b/i.test(input.latestMessage)

  if ((mentionsTrip || isPaymentDispute) && !mentionsTripId && !isNegativeClosure(input.latestMessage)) {
    const greeting = input.customerName ? `Hello ${input.customerName},` : "Hello,"
    return {
      ok: true,
      model: "dapo-template",
      reply: `${greeting}\n\nTo help me look this up properly, please share the ride reference or ride ID if you have it.\n\nIf you do not have the ride ID, send me:\n1. The trip date\n2. Pickup and destination\n3. The fare shown in the app\n4. The amount charged by the driver\n\nOnce I have those details, I can route this to the right support team.`,
      shouldEscalate: false,
      shouldResolve: false,
      confidence: 1,
      category: isPaymentDispute ? "payment_issue" : "ride_issue",
      department: isPaymentDispute ? "billing" : "operations",
      reason: "Trip-specific issue needs ride reference before escalation",
    }
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return { ok: false, shouldEscalate: true, confidence: 0, reason: "Gemini API key not configured" }
  }

  const prompt = supportPrompt(input)
  let lastError = ""

  for (const model of GEMINI_MODELS) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.25,
              topP: 0.8,
              maxOutputTokens: 700,
              responseMimeType: "application/json",
            },
          }),
        }
      )

      if (!response.ok) {
        lastError = `${model}: ${response.status} ${await response.text().catch(() => "")}`
        continue
      }

      const payload = await response.json()
      const text = payload?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || "").join("\n").trim()
      if (!text) {
        lastError = `${model}: empty response`
        continue
      }

      const parsed = parseJson(text)
      const reply = String(parsed.reply || "").trim()
      if (!reply) {
        lastError = `${model}: missing reply`
        continue
      }

      return {
        ok: true,
        model,
        reply,
        shouldEscalate: parsed.shouldEscalate !== false,
        shouldResolve: parsed.shouldResolve === true,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.5))),
        category: String(parsed.category || "other"),
        department: String(parsed.department || "support"),
        reason: String(parsed.reason || "AI support response"),
      }
    } catch (error) {
      lastError = `${model}: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  return { ok: false, shouldEscalate: true, confidence: 0, reason: lastError || "All Gemini models failed" }
}
