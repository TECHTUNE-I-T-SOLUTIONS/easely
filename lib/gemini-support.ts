type SupportMessage = {
  role: "customer" | "assistant" | "admin"
  content: string
}

type SupportAIInput = {
  channel: "in_app" | "email"
  subject?: string | null
  customerName?: string | null
  customerEmail?: string | null
  userRole?: string | null
  latestMessage: string
  history?: SupportMessage[]
  driverContext?: {
    driverId?: string | null
    fullName?: string | null
    phoneNumber?: string | null
    walletRoute?: string | null
    currentAvailability?: string | null
    verified?: boolean | null
    settlementStatus?: string | null
    settlementDueDate?: string | null
    overdueAmount?: number | null
    lastPaymentAt?: string | null
  } | null
  recentTickets?: Array<{
    id: string
    subject?: string | null
    category?: string | null
    status?: string | null
    updated_at?: string | null
  }>
  businessMemory?: Array<{
    title?: string | null
    content?: string | null
    category?: string | null
    audience?: string | null
    route?: string | null
  }>
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
const DRIVER_WALLET_ROUTE = "/driver/wallet"
const RIDER_SUPPORT_ROUTE = "/rider/help-and-support"
const DRIVER_SUPPORT_ROUTE = "/driver/help-and-support"

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
  const greeting = customerName ? `Hi ${customerName},` : "Hi,"
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

function getRoleLabel(userRole?: string | null) {
  return String(userRole || "").toLowerCase()
}

function isDriverRole(userRole?: string | null) {
  return getRoleLabel(userRole) === "driver"
}

function isRiderRole(userRole?: string | null) {
  return getRoleLabel(userRole) === "rider"
}

function routeReply(reply: string, route?: string | null) {
  const cleanRoute = typeof route === "string" && route.trim() ? route.trim() : ""
  if (!cleanRoute) return reply
  if (reply.includes(cleanRoute)) return reply
  return `${reply}\n\nOpen in app: ${cleanRoute}`
}

function buildRoleAwareRemittanceReply(input: SupportAIInput) {
  const greeting = input.customerName ? `Hi ${input.customerName},` : "Hi,"
  const driverName = input.driverContext?.fullName?.trim()
  const settlementStatus = input.driverContext?.settlementStatus?.trim()
  const walletRoute = input.driverContext?.walletRoute || DRIVER_WALLET_ROUTE
  const normalized = input.latestMessage.toLowerCase()
  const wantsRemittanceHelp =
    /\b(remittance|settlement|wallet|payout|pay out|payment|pay|earnings|balance|overdue|due today|due now)\b/i.test(normalized) ||
    /\b(how do i|how can i|where do i|can i)\b.*\b(remittance|settlement|wallet|payment|earnings|balance)\b/i.test(normalized) ||
    /\b(check|look up|view|show)\b.*\b(remittance|settlement|wallet|balance|due)\b/i.test(normalized)

  if (isDriverRole(input.userRole) && wantsRemittanceHelp) {
    const settlementLine = settlementStatus
      ? `Your latest settlement status is ${settlementStatus}.`
      : "I can check your current settlement details in the Wallet screen."
    return {
      ok: true,
      model: "dapo-template",
      reply: routeReply(
        `${greeting}\n\n${driverName ? `${driverName}, ` : ""}drivers can pay their platform remittance from the Wallet screen in the driver app. ${settlementLine} Open your wallet, review the outstanding settlement, and follow the payment steps there.`,
        walletRoute
      ),
      shouldEscalate: false,
      shouldResolve: false,
      confidence: 1,
      category: "payment_issue",
      department: "billing",
      reason: "Driver remittance question answered with wallet route",
    } satisfies SupportAIResult
  }

  if (isRiderRole(input.userRole) && wantsRemittanceHelp) {
    return {
      ok: true,
      model: "dapo-template",
      reply: `${greeting}\n\nThat remittance or settlement feature is only available to drivers. If you need ride help, I can assist here. If you want to become a driver, please use the driver signup flow in the app.`,
      shouldEscalate: false,
      shouldResolve: false,
      confidence: 1,
      category: "account_issue",
      department: "support",
      reason: "Rider asked about a driver-only remittance flow",
    } satisfies SupportAIResult
  }

  return null
}

function isShortAcknowledgement(message: string) {
  const compact = message.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ")
  return ["thanks", "thank you", "ok", "okay", "great", "nice", "got it", "cool"].includes(compact)
}

function isTopicSwitch(message: string, history?: SupportMessage[]) {
  if (!history?.length) return false
  const recentAssistant = history.slice().reverse().find((item) => item.role === "assistant")?.content || ""
  const cleanedMessage = message.toLowerCase()
  const cleanedAssistant = recentAssistant.toLowerCase()
  const topicWords = ["remittance", "wallet", "account", "delete", "ride", "refund", "payment", "support", "booking", "driver", "rider", "profile", "password", "login", "verification"]
  const messageHits = topicWords.filter((word) => cleanedMessage.includes(word))
  const assistantHits = topicWords.filter((word) => cleanedAssistant.includes(word))
  return messageHits.some((word) => !assistantHits.includes(word))
}

function directFaqReply(input: SupportAIInput) {
  const text = input.latestMessage.toLowerCase()
  const greeting = input.customerName ? `Hi ${input.customerName},` : "Hi,"

  if (/\b(delete|deletion)\b.*\b(account|profile)\b|\baccount deletion\b/i.test(text)) {
    return {
      ok: true,
      model: "dapo-template",
      reply: `${greeting}\n\nTo delete your account, open Profile, then Privacy/Security or Delete Account if it is available in your app version. If you cannot see the option, I can escalate it to support for manual review.`,
      shouldEscalate: true,
      shouldResolve: false,
      confidence: 0.97,
      category: "account_issue",
      department: "support",
      reason: "Account deletion handled directly",
    } satisfies SupportAIResult
  }

  if (/\b(otp|one time password|verification code|code)\b/i.test(text) || /\b(login|sign in|signin|password)\b/i.test(text)) {
    return {
      ok: true,
      model: "dapo-template",
      reply: `${greeting}\n\nFor login or OTP issues, confirm your phone number or email, check your network connection, wait for the code window to expire, then try resend once. If the code still fails or the account is locked, I’ll escalate it to support.`,
      shouldEscalate: true,
      shouldResolve: false,
      confidence: 0.97,
      category: "technical",
      department: "engineering",
      reason: "Login/OTP support handled directly",
    } satisfies SupportAIResult
  }

  if (/\b(verified|verification|documents|pending verification)\b/i.test(text) && /\b(driver|driver account)\b/i.test(text)) {
    return {
      ok: true,
      model: "dapo-template",
      reply: `${greeting}\n\nDriver verification is checked from the driver profile/documents area. If your verification is still pending, refresh the status and make sure your documents are complete. If it remains pending for too long, I’ll escalate it to support.`,
      shouldEscalate: true,
      shouldResolve: false,
      confidence: 0.96,
      category: "account_issue",
      department: "support",
      reason: "Driver verification handled directly",
    } satisfies SupportAIResult
  }

  if (/\b(cancel|cancellation)\b/i.test(text)) {
    return {
      ok: true,
      model: "dapo-template",
      reply: `${greeting}\n\nIf the ride is still pending and not yet accepted, you can usually cancel from the booking or ride screen. If it has already been accepted or is in progress, the cancellation may need review, so I can escalate it to support.`,
      shouldEscalate: false,
      shouldResolve: false,
      confidence: 0.95,
      category: "ride_issue",
      department: "operations",
      reason: "Cancellation guidance handled directly",
    } satisfies SupportAIResult
  }

  if (/\b(crash|force close|app crash|something went wrong|error)\b/i.test(text)) {
    return {
      ok: true,
      model: "dapo-template",
      reply: `${greeting}\n\nPlease tell me the screen where it crashed, the exact action you took, your device model, and OS version. If it blocks booking, ride details, login, or wallet, I’ll escalate it to engineering right away.`,
      shouldEscalate: true,
      shouldResolve: false,
      confidence: 0.96,
      category: "technical",
      department: "engineering",
      reason: "Crash triage handled directly",
    } satisfies SupportAIResult
  }

  return null
}

function supportPrompt(input: SupportAIInput) {
  const history = (input.history || [])
    .slice(-12)
    .map((item) => `${item.role.toUpperCase()}: ${item.content}`)
    .join("\n")

  const recentTickets = (input.recentTickets || [])
    .slice(0, 5)
    .map((ticket) => `- ${ticket.subject || ticket.id} [${ticket.status || "unknown"}] ${ticket.category || ""}`.trim())
    .join("\n")
  const businessMemory = (input.businessMemory || [])
    .slice(0, 8)
    .map((item) => `- ${item.title || "Memory"}: ${item.content || ""}${item.route ? ` | route: ${item.route}` : ""}${item.audience ? ` | audience: ${item.audience}` : ""}`)
    .join("\n")

  return `
You are Dapo, Charter Keke's professional customer support assistant. Customers can also call you Daps.
If you have not introduced yourself in this conversation, introduce yourself once as: "${DAPO_INTRO}" Do not repeat the introduction after that.

Business facts:
- Charter Keke connects riders/passengers with keke drivers.
- Passenger/rider trip payments are paid directly to drivers in person. Do not claim card/wallet payment was processed by Charter Keke unless the user is discussing driver remittance/settlement.
- When the user is a driver and asks about remittance, settlement, earnings, wallet, or pay-out flow, answer directly and point them to the driver wallet screen.
- When the user is a rider and asks about driver-only remittance or wallet actions, say it is unavailable to riders and do not reveal internal driver payment steps.
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
- If the user asks a general policy question that does not depend on a specific trip, do not ask for a ride ID.
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

Recent support tickets:
${recentTickets || "(none)"}

Relevant business memory:
${businessMemory || "(none)"}

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
  const remittanceReply = buildRoleAwareRemittanceReply(input)
  if (remittanceReply) return remittanceReply

  const faqReply = directFaqReply(input)
  if (faqReply) return faqReply

  if (isShortAcknowledgement(input.latestMessage)) {
    return {
      ok: true,
      model: "dapo-template",
      reply: "You are welcome. What else can I help with?",
      shouldEscalate: false,
      shouldResolve: false,
      confidence: 1,
      category: "other",
      department: "support",
      reason: "Short acknowledgement handled without repeating prior answer",
    }
  }

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
  const topicSwitch = isTopicSwitch(input.latestMessage, input.history)
  const driverCtx = input.driverContext
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
    "booking",
    "cancel",
    "cancelled",
    "cancellation",
    "status",
  ]
  const mentionsTrip = tripSpecificKeywords.some((keyword) => normalizedLatest.includes(keyword))
  const mentionsTripId = /\b(ride|trip)\s*(id|reference|ref)\b/i.test(input.latestMessage)
  const isPaymentDispute = /\b(fare|overcharge|charged|charge|discrepancy|amount)\b/i.test(input.latestMessage)

  const isGenericPolicyQuestion =
    /\b(how do|how does|what is|can i|can drivers|do drivers|where do)\b/i.test(input.latestMessage) &&
    !/\b(today|yesterday|this morning|this afternoon|last night|at \d{1,2}:\d{2})\b/i.test(input.latestMessage)

  if (driverCtx && isDriverRole(input.userRole) && /\b(name|phone|remittance|settlement|wallet|pay|payment|earnings|balance|today|due)\b/i.test(normalizedLatest)) {
    const greeting = input.customerName ? `Hello ${input.customerName},` : "Hello,"
    const lines = [
      greeting,
      "",
      `${driverCtx.fullName ? `I found your driver profile for ${driverCtx.fullName}.` : "I found your driver profile."}`,
      driverCtx.phoneNumber ? `Phone on file ends with ${driverCtx.phoneNumber.slice(-4)}.` : null,
      driverCtx.settlementStatus ? `Settlement status: ${driverCtx.settlementStatus}.` : null,
      driverCtx.overdueAmount != null ? `Outstanding amount: ₦${Number(driverCtx.overdueAmount).toLocaleString()}.` : null,
      driverCtx.settlementDueDate ? `Due date: ${new Date(driverCtx.settlementDueDate).toLocaleDateString()}.` : null,
      "",
      `Open your wallet here: ${driverCtx.walletRoute || DRIVER_WALLET_ROUTE}`,
    ].filter(Boolean)

    return {
      ok: true,
      model: "dapo-template",
      reply: lines.join("\n"),
      shouldEscalate: false,
      shouldResolve: false,
      confidence: 1,
      category: "payment_issue",
      department: "billing",
      reason: "Driver context used to answer remittance without asking for ride ID",
    }
  }

  if ((mentionsTrip || isPaymentDispute) && !mentionsTripId && !isNegativeClosure(input.latestMessage) && !isGenericPolicyQuestion && !topicSwitch) {
    const greeting = input.customerName ? `Hello ${input.customerName},` : "Hello,"
    return {
      ok: true,
      model: "dapo-template",
      reply: `${greeting}\n\nTo help me look this up properly, please share the ride reference or ride ID if you have it.\n\nIf this is not about a specific ride, tell me the main issue and I will answer directly.`,
      shouldEscalate: false,
      shouldResolve: false,
      confidence: 1,
      category: isPaymentDispute ? "payment_issue" : "ride_issue",
      department: isPaymentDispute ? "billing" : "operations",
      reason: "Trip-specific issue needs ride reference before escalation",
    }
  }

  if (topicSwitch) {
    const memoryMatches = (input.businessMemory || []).filter((item) =>
      [item.title, item.content, item.category, item.route, item.audience].join(" ").toLowerCase().includes(normalizedLatest.split(/\s+/)[0] || "")
    )
    if (memoryMatches.length) {
      const top = memoryMatches[0]
      return {
        ok: true,
        model: "dapo-template",
        reply: `${input.customerName ? `Hi ${input.customerName},` : "Hi,"}\n\n${top.content || "I can help with that."}${top.route ? `\n\nOpen in app: ${top.route}` : ""}`,
        shouldEscalate: false,
        shouldResolve: false,
        confidence: 0.9,
        category: top.category || "other",
        department: "support",
        reason: "Topic switch answered from support memory",
      }
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
