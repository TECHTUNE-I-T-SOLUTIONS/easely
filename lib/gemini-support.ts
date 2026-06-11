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
  confidence: number
  category?: string
  reason?: string
}

const GEMINI_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash-lite-preview-09-2025",
]

function supportPrompt(input: SupportAIInput) {
  const history = (input.history || [])
    .slice(-12)
    .map((item) => `${item.role.toUpperCase()}: ${item.content}`)
    .join("\n")

  return `
You are Charter Keke's professional customer support assistant.

Business facts:
- Charter Keke connects riders/passengers with keke drivers.
- Passenger/rider trip payments are paid directly to drivers in person. Do not claim card/wallet payment was processed by Charter Keke unless the user is discussing driver remittance/settlement.
- Be warm, concise, calm, and practical.
- Ask one focused follow-up question when details are missing.
- If the issue needs a human admin, safety review, account action, refund/remittance investigation, driver discipline, legal/privacy handling, or database changes, say a support agent will follow up and set shouldEscalate true.
- Do not invent ride, payment, account, or driver details.
- Never promise refunds or enforcement outcomes.

Return only JSON with:
{
  "reply": "customer-facing reply",
  "shouldEscalate": boolean,
  "confidence": number between 0 and 1,
  "category": "ride_issue|payment_issue|driver_complaint|account_issue|safety|technical|other",
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
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.5))),
        category: String(parsed.category || "other"),
        reason: String(parsed.reason || "AI support response"),
      }
    } catch (error) {
      lastError = `${model}: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  return { ok: false, shouldEscalate: true, confidence: 0, reason: lastError || "All Gemini models failed" }
}
