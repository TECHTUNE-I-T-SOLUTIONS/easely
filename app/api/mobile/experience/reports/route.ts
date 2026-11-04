import { after, NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { notifyAdmins } from '@/lib/admin-notifications'
import { analyzeMobileExperience } from '@/lib/mobile-experience-ai'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 60

const allowedTypes = new Set(['error', 'screen_view', 'task_success', 'task_failure', 'feedback'])
const rateLimit = new Map<string, { startedAt: number; count: number }>()

function text(value: unknown, max: number) {
  if (typeof value !== 'string') return null
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b(?:\+?\d[\d ()-]{7,}\d)\b/g, '[phone]')
    .replace(/([?&](?:token|key|secret|reference|authorization)=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, max)
}

function occurredAt(value: unknown) {
  if (typeof value !== 'string') return new Date().toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character)
}

function mobileExperienceEmailHtml(input: {
  role: string
  screen: string
  appVersion: string
  platform: string
  healthCheck: boolean
  reportCount: number
  insight: { summary: string; likelyCause: string; suggestions: string[]; confidence: number; model: string }
  events: Array<Record<string, any>>
}) {
  const suggestions = input.insight.suggestions.length
    ? input.insight.suggestions.map((suggestion, index) => `<li style="margin:6px 0">${escapeHtml(suggestion)}</li>`).join('')
    : '<li>No automated suggestions were returned. Review the report evidence below.</li>'
  const evidence = input.events.slice(0, 12).map((event, index) => `
    <tr>
      <td style="padding:12px;border-bottom:1px solid #eee;font-weight:700;vertical-align:top">${index + 1}. ${escapeHtml(event.event_type)}</td>
      <td style="padding:12px;border-bottom:1px solid #eee;vertical-align:top">
        <div><b>${escapeHtml(event.screen || 'Unknown screen')}</b> · ${escapeHtml(event.action || 'No action')}</div>
        <div style="color:#777;font-size:12px;margin:4px 0">${escapeHtml(event.occurred_at || 'Time unavailable')}</div>
        ${event.error_name ? `<div><b>Error:</b> ${escapeHtml(event.error_name)}</div>` : ''}
        ${event.message ? `<div style="white-space:pre-wrap;margin-top:4px">${escapeHtml(event.message)}</div>` : ''}
        ${event.feedback ? `<div style="white-space:pre-wrap;margin-top:4px"><b>Feedback:</b> ${escapeHtml(event.feedback)}</div>` : ''}
        ${event.stack ? `<details style="margin-top:8px"><summary style="cursor:pointer;color:#a65300">Technical details</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;background:#f7f7f7;padding:10px;border-radius:8px;font-size:11px">${escapeHtml(String(event.stack).slice(0, 1800))}</pre></details>` : ''}
      </td>
    </tr>`).join('')

  return `
    <h2 style="margin:0 0 12px;color:#181818">${input.healthCheck ? 'Requested app health check' : 'Mobile app report'}</h2>
    <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:18px;background:#fff8ef;border-radius:10px">
      <tr><td style="padding:8px 12px"><b>Account role:</b> ${escapeHtml(input.role)}</td><td style="padding:8px 12px"><b>Screen:</b> ${escapeHtml(input.screen)}</td></tr>
      <tr><td style="padding:8px 12px"><b>App version:</b> ${escapeHtml(input.appVersion)}</td><td style="padding:8px 12px"><b>Platform:</b> ${escapeHtml(input.platform)}</td></tr>
      <tr><td style="padding:8px 12px" colspan="2"><b>Events analyzed:</b> ${input.reportCount} · <b>AI model:</b> ${escapeHtml(input.insight.model)} · <b>Confidence:</b> ${Math.round(input.insight.confidence * 100)}%</td></tr>
    </table>
    <section style="border:1px solid #f0dec8;border-radius:12px;padding:16px;margin:16px 0">
      <h3 style="margin:0 0 8px;color:#a65300">AI assessment</h3>
      <p style="margin:6px 0"><b>Summary:</b> ${escapeHtml(input.insight.summary)}</p>
      <p style="margin:6px 0"><b>Likely cause:</b> ${escapeHtml(input.insight.likelyCause)}</p>
      <p style="margin:10px 0 4px"><b>Suggested follow-up</b></p>
      <ul style="margin:4px 0;padding-left:22px">${suggestions}</ul>
      <p style="color:#777;font-size:12px;margin:10px 0 0">AI suggestions are based only on the consented events listed below. Confirm findings against source code and production logs.</p>
    </section>
    <h3 style="margin:20px 0 8px">Recent diagnostic evidence</h3>
    <table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px">${evidence || '<tr><td>No recent report events were available.</td></tr>'}</table>
  `
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const role = session.user.role === 'driver' ? 'driver' : ['user', 'rider'].includes(session.user.role) ? 'rider' : null
    if (!role) return NextResponse.json({ error: 'This account cannot submit mobile diagnostics' }, { status: 403 })

    const limit = rateLimit.get(session.user.id)
    const now = Date.now()
    if (limit && now - limit.startedAt < 5 * 60_000 && limit.count >= 30) {
      return NextResponse.json({ error: 'Please try again later' }, { status: 429 })
    }
    rateLimit.set(session.user.id, !limit || now - limit.startedAt >= 5 * 60_000
      ? { startedAt: now, count: 1 }
      : { ...limit, count: limit.count + 1 })

    const body = await request.json().catch(() => null)
    if (body?.consent !== true || !Array.isArray(body?.events) || body.events.length === 0 || body.events.length > 15) {
      return NextResponse.json({ error: 'Valid consent and up to 15 events are required' }, { status: 400 })
    }

    const events = body.events.filter((event: any) => event && allowedTypes.has(event.type)).map((event: any) => ({
      event_id: text(event.id, 80) || crypto.randomUUID(),
      event_type: event.type,
      occurred_at: occurredAt(event.occurredAt),
      screen: text(event.screen, 80),
      action: text(event.action, 80),
      duration_ms: Number.isFinite(Number(event.durationMs)) ? Math.max(0, Math.min(Number(event.durationMs), 3_600_000)) : null,
      error_name: text(event.errorName, 100),
      message: text(event.message, 1000),
      stack: text(event.stack, 5000),
      feedback: text(event.feedback, 800),
      app_version: text(event.appVersion, 40),
      platform: text(event.platform, 20),
    }))
    if (events.length === 0) return NextResponse.json({ accepted: 0 })

    const rows = events.map((event: any) => ({
      ...event,
      user_id: session.user.id,
      user_role: role,
      analysis: null,
    }))
    const healthCheck = body.healthCheck === true
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('mobile_experience_reports')
      .upsert(rows, { onConflict: 'event_id', ignoreDuplicates: true })
      .select('event_id,event_type,screen,action,occurred_at,error_name,message,stack,feedback,app_version,platform')

    if (insertError) {
      console.error('[MOBILE][EXPERIENCE][STORE]', insertError)
      return NextResponse.json({ error: 'Could not save diagnostics' }, { status: 503 })
    }

    const actionableTypes = ['error', 'task_failure', 'feedback']
    let actionable: Array<Record<string, any>> = (inserted || []).filter((event: any) => actionableTypes.includes(event.event_type))
    if (actionable.length || healthCheck) after(async () => {
      try {
      if (healthCheck) {
        const { data: recentReports, error: historyError } = await supabaseAdmin
          .from('mobile_experience_reports')
          .select('event_id,event_type,screen,action,occurred_at,error_name,message,stack,feedback,app_version,platform,analysis')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(30)
        if (historyError) console.error('[MOBILE][EXPERIENCE][HEALTH_CHECK_HISTORY]', historyError)
        else actionable = recentReports || actionable
      }
      if (!actionable.length) {
        const retryIds = events.filter((event: any) => actionableTypes.includes(event.event_type)).map((event: any) => event.event_id)
        if (retryIds.length) {
          const { data: previousReports } = await supabaseAdmin
            .from('mobile_experience_reports')
            .select('event_id,event_type,screen,action,occurred_at,error_name,message,stack,feedback,app_version,platform,analysis')
            .in('event_id', retryIds)
          actionable = previousReports || []
        }
      }
      if (!actionable.length) return
      const inputOrder = new Map<string, number>()
      events.forEach((event: any, index: number) => inputOrder.set(event.event_id, index))
      actionable.sort((a, b) => (inputOrder.get(a.event_id) ?? Number.MAX_SAFE_INTEGER) - (inputOrder.get(b.event_id) ?? Number.MAX_SAFE_INTEGER))
      const healthCheckEvent = healthCheck
        ? actionable.find((event: any) => event.action === 'user_initiated_health_check')
        : undefined
      const first = healthCheckEvent || actionable[0]
      const existingInsight = healthCheck ? undefined : actionable.find((event: any) => event.analysis)?.analysis
      const insight = existingInsight || await analyzeMobileExperience(actionable.map((event: any) => ({
        ...event,
        type: event.event_type,
        occurredAt: event.occurred_at,
        errorName: event.error_name,
        appVersion: event.app_version,
      }))) || {
        summary: first.message || first.feedback || 'A mobile app experience event was reported.',
        likelyCause: 'AI analysis is unavailable; the report needs manual review.',
        suggestions: [],
        confidence: 0,
        model: 'unavailable',
      }
      const reportIds = actionable.map((event: any) => event.event_id)
      const reportAnalysis = { ...insight, reportIds }
      const { error: analysisUpdateError } = await supabaseAdmin
        .from('mobile_experience_reports')
        .update({ analysis: reportAnalysis })
        .eq('event_id', first.event_id)
      if (analysisUpdateError) console.error('[MOBILE][EXPERIENCE][ANALYSIS]', analysisUpdateError)
      const shouldDispatch = !existingInsight || Boolean(analysisUpdateError)

      const screen = first.screen || 'unknown screen'
      const title = healthCheck
        ? `Mobile app health check: ${role} / ${screen}`
        : first.event_type === 'error'
        ? `Mobile app issue: ${role} / ${screen}`
        : `Mobile app feedback: ${role} / ${screen}`
      const evidence = actionable.slice(0, 8).map((event: any, index: number) => {
        const lines = [
          `Event ${index + 1}: ${event.event_type}`,
          `Time: ${event.occurred_at || 'unknown'}`,
          `Screen/action: ${event.screen || 'unknown'} / ${event.action || 'unknown'}`,
          event.error_name ? `Error: ${event.error_name}` : null,
          event.message ? `Message: ${event.message}` : null,
          event.feedback ? `Feedback: ${event.feedback}` : null,
          event.stack ? `Technical details:\n${String(event.stack).slice(0, 1400)}` : null,
        ].filter(Boolean)
        return lines.join('\n')
      }).join('\n\n')
      const details = [
        healthCheck ? `Health check reviewed ${actionable.length} recent consented experience event(s).` : null,
        insight?.summary || first.message || first.feedback || first.action || 'A user experience event was reported.',
        insight?.likelyCause ? `Likely cause: ${insight.likelyCause}` : null,
        ...(insight?.suggestions || []).map((suggestion: string, index: number) => `Suggestion ${index + 1}: ${suggestion}`),
        insight.model === 'unavailable' ? 'AI analysis was unavailable; review the linked report details.' : `AI confidence: ${Math.round(insight.confidence * 100)}% (${insight.model})`,
        healthCheck ? `\nRecent report details:\n${evidence}` : null,
      ].filter(Boolean)

      if (shouldDispatch) {
        const delivery = await notifyAdmins({
          allAdmins: true,
          title,
          body: details.join('\n'),
          type: 'mobile_experience_alert',
          actionUrl: '/admin/mobile-experience',
          sourceEventId: `mobile_experience:${first.event_id}`,
          priorityEmail: process.env.DEVELOPER_ALERT_EMAIL,
          // The database trigger inserts the admin inbox row. Keep the existing
          // helper for push/email delivery without creating a duplicate row.
          persist: Boolean(analysisUpdateError),
          emailEnabled: true,
          emailHtml: mobileExperienceEmailHtml({
            role,
            screen,
            appVersion: first.app_version || 'unknown',
            platform: first.platform || 'unknown',
            healthCheck,
            reportCount: actionable.length,
            insight,
            events: actionable,
          }),
          metadata: {
            reportIds,
            role,
            screen,
            appVersion: first.app_version,
            platform: first.platform,
            analysis: reportAnalysis,
            details: actionable.map((event: any) => ({
              type: event.event_type,
              action: event.action,
              occurredAt: event.occurred_at,
              errorName: event.error_name,
              message: event.message,
              stack: event.stack,
              feedback: event.feedback,
            })),
          },
        })
        console.info('[MOBILE][EXPERIENCE][DELIVERY]', {
          reportCount: reportIds.length,
          model: insight.model,
          adminPushes: delivery.delivered,
          adminEmails: delivery.emailed,
          emailHtmlIncluded: true,
        })
      }
      } catch (error) {
        console.error('[MOBILE][EXPERIENCE][POST_RESPONSE_ANALYSIS]', error)
      }
    })

    return NextResponse.json({ accepted: events.length })
  } catch (error) {
    console.error('[MOBILE][EXPERIENCE][POST]', error)
    return NextResponse.json({ error: 'Could not process diagnostics' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session?.user?.id || !['driver', 'rider', 'user'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: reports, error: reportsError } = await supabaseAdmin
      .from('mobile_experience_reports')
      .select('event_id')
      .eq('user_id', session.user.id)

    if (reportsError) {
      console.error('[MOBILE][EXPERIENCE][DELETE][LOOKUP]', reportsError)
      return NextResponse.json({ error: 'Could not remove diagnostics' }, { status: 503 })
    }

    for (const report of reports || []) {
      const { error: notificationError } = await supabaseAdmin
        .from('admin_notifications')
        .delete()
        .eq('type', 'mobile_experience_alert')
        .contains('metadata', { reportIds: [report.event_id] })
      if (notificationError) {
        console.error('[MOBILE][EXPERIENCE][DELETE][NOTIFICATION]', notificationError)
        return NextResponse.json({ error: 'Could not remove diagnostics' }, { status: 503 })
      }
    }

    const { error } = await supabaseAdmin
      .from('mobile_experience_reports')
      .delete()
      .eq('user_id', session.user.id)

    if (error) {
      console.error('[MOBILE][EXPERIENCE][DELETE]', error)
      return NextResponse.json({ error: 'Could not remove diagnostics' }, { status: 503 })
    }
    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error('[MOBILE][EXPERIENCE][DELETE]', error)
    return NextResponse.json({ error: 'Could not remove diagnostics' }, { status: 500 })
  }
}
