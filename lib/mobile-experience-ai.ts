import { GEMINI_MODELS } from '@/lib/gemini-support'

export type MobileExperienceInsight = {
  summary: string
  likelyCause: string
  suggestions: string[]
  confidence: number
  model: string
}

export async function analyzeMobileExperience(events: Array<Record<string, unknown>>): Promise<MobileExperienceInsight | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey || events.length === 0) return null

  const evidence = events.slice(0, 8).map((event) => ({
    type: event.type,
    screen: event.screen,
    action: event.action,
    occurredAt: event.occurredAt,
    errorName: event.errorName,
    message: event.message,
    stack: typeof event.stack === 'string' ? event.stack.slice(0, 2400) : undefined,
    durationMs: event.durationMs,
    feedback: typeof event.feedback === 'string' ? event.feedback.slice(0, 600) : undefined,
    appVersion: event.appVersion,
    platform: event.platform,
  }))

  const prompt = `You are triaging anonymized Charter Keke mobile app diagnostics. Return JSON only with keys summary, likelyCause, suggestions (array of at most 3 concise actionable items), confidence (0 to 1). Distinguish evidence from guesses. Never claim to have fixed anything. Do not ask for personal data. Keep the summary under 240 characters and the cause under 400 characters. Evidence: ${JSON.stringify(evidence)}`

  for (const model of GEMINI_MODELS.slice(0, 4)) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.15, maxOutputTokens: 500, responseMimeType: 'application/json' },
          }),
          signal: AbortSignal.timeout(12000),
        },
      )
      if (!response.ok) continue
      const payload = await response.json()
      const text = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('').trim()
      if (!text) continue
      const parsed = JSON.parse(text)
      return {
        summary: String(parsed.summary || 'Mobile app issue reported').slice(0, 240),
        likelyCause: String(parsed.likelyCause || 'The available diagnostics do not identify a clear cause.').slice(0, 400),
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3).map((value: unknown) => String(value).slice(0, 240)) : [],
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        model,
      }
    } catch {
      // Try the next configured support model; reports still reach admins if AI is unavailable.
    }
  }

  return null
}
