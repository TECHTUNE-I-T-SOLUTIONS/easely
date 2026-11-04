export type MobileExperienceInsight = {
  summary: string
  likelyCause: string
  suggestions: string[]
  confidence: number
  model: string
}

function parseInsight(raw: string, model: string): MobileExperienceInsight | null {
  const normalized = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const json = normalized.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return null
  const parsed = JSON.parse(json)
  if (!parsed || typeof parsed !== 'object') return null
  return {
    summary: String(parsed.summary || '').slice(0, 240),
    likelyCause: String(parsed.likelyCause || '').slice(0, 400),
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3).map((value: unknown) => String(value).slice(0, 240)) : [],
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    model,
  }
}

export async function analyzeMobileExperience(events: Array<Record<string, unknown>>): Promise<MobileExperienceInsight | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey || events.length === 0) {
    console.warn('[AI][MOBILE_EXPERIENCE] Analysis skipped: API key or report evidence is missing')
    return null
  }

  const normalizedEvents: Array<Record<string, unknown>> = events.map((event) => ({
    ...event,
    type: event.type ?? event.event_type,
    occurredAt: event.occurredAt ?? event.occurred_at,
    errorName: event.errorName ?? event.error_name,
    appVersion: event.appVersion ?? event.app_version,
  }))
  const priority = (event: Record<string, unknown>) => {
    if (event.action === 'user_initiated_health_check') return 5
    if (event.type === 'error' || event.type === 'task_failure') return 0
    if (event.type === 'feedback') return 1
    if (event.type === 'task_success') return 2
    return 3
  }
  const relevantEvents = [...normalizedEvents].sort((a, b) => priority(a) - priority(b)).slice(0, 8)
  const counts = normalizedEvents.reduce<Record<string, number>>((result, event) => {
    const type = String(event.type || 'unknown')
    result[type] = (result[type] || 0) + 1
    return result
  }, {})
  const actualErrors = normalizedEvents.filter((event) =>
    (event.type === 'error' || event.type === 'task_failure') && event.action !== 'user_initiated_health_check'
  )
  const errorGroups = actualErrors.reduce<Record<string, number>>((result, event) => {
    const key = `${String(event.errorName || event.type)} at ${String(event.screen || 'unknown screen')}`
    result[key] = (result[key] || 0) + 1
    return result
  }, {})
  const evidence = relevantEvents.map((event) => ({
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

  const prompt = `You are triaging consented Charter Keke mobile app diagnostics for engineers. Analyze the evidence and return JSON only with keys summary, likelyCause, suggestions (array of at most 3 concise actionable items), confidence (0 to 1). Explicitly say when evidence is insufficient. Separate observed facts from hypotheses. Do not treat the user-initiated health-check marker as a crash. Prioritize repeated real errors and failures, then user feedback, then app usage signals. Never claim to have fixed anything or infer personal identity. Keep summary under 240 characters and likelyCause under 400 characters. Event counts: ${JSON.stringify(counts)}. Repeated error groups: ${JSON.stringify(errorGroups)}. Relevant event evidence: ${JSON.stringify(evidence)}`

  // Free-tier text generation models from the provided AI Studio pricing guide.
  // Specialized audio, image, TTS, and robotics models are excluded because
  // this endpoint needs text-in/text-out structured analysis.
  const models = [
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
  ]
  for (const model of models) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 1200,
              responseMimeType: 'application/json',
              ...(model.startsWith('gemini-2.5-') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
            },
          }),
          signal: AbortSignal.timeout(5000),
        },
      )
      if (!response.ok) {
        const responseDetail = (await response.text().catch(() => '')).slice(0, 500)
        console.warn(`[AI][MOBILE_EXPERIENCE] ${model} returned HTTP ${response.status}: ${responseDetail}`)
        continue
      }
      const payload = await response.json()
      const candidate = payload?.candidates?.[0]
      const text = candidate?.content?.parts?.map((part: { text?: string }) => part.text || '').join('').trim()
      if (!text) {
        console.warn(`[AI][MOBILE_EXPERIENCE] ${model} returned no text (finishReason=${candidate?.finishReason || 'unknown'})`)
        continue
      }
      const insight = parseInsight(text, `gemini/${model}`)
      if (insight?.summary && insight.likelyCause) return insight
      console.warn(`[AI][MOBILE_EXPERIENCE] ${model} returned an incomplete JSON insight`)
    } catch (error) {
      console.warn(`[AI][MOBILE_EXPERIENCE] ${model} failed:`, error instanceof Error ? error.message : 'Unknown model error')
      // Try the next configured support model; reports still reach admins if AI is unavailable.
    }
  }

  console.error('[AI][MOBILE_EXPERIENCE] All configured AI providers failed; alert will include raw diagnostic evidence')
  return null
}
