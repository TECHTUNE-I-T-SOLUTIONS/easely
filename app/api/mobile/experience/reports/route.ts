import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { notifyAdmins } from '@/lib/admin-notifications'
import { analyzeMobileExperience } from '@/lib/mobile-experience-ai'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'

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
    if (actionable.length) {
      const inputOrder = new Map<string, number>()
      events.forEach((event: any, index: number) => inputOrder.set(event.event_id, index))
      actionable.sort((a, b) => (inputOrder.get(a.event_id) ?? Number.MAX_SAFE_INTEGER) - (inputOrder.get(b.event_id) ?? Number.MAX_SAFE_INTEGER))
      const first = actionable[0]
      const existingInsight = actionable.find((event: any) => event.analysis)?.analysis
      const insight = existingInsight || await analyzeMobileExperience(actionable) || {
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
      const title = first.event_type === 'error'
        ? `Mobile app issue: ${role} / ${screen}`
        : `Mobile app feedback: ${role} / ${screen}`
      const details = [
        insight?.summary || first.message || first.feedback || first.action || 'A user experience event was reported.',
        insight?.likelyCause ? `Likely cause: ${insight.likelyCause}` : null,
        ...(insight?.suggestions || []).map((suggestion: string, index: number) => `Suggestion ${index + 1}: ${suggestion}`),
        insight.model === 'unavailable' ? 'AI analysis was unavailable; review the linked report details.' : `AI confidence: ${Math.round(insight.confidence * 100)}% (${insight.model})`,
      ].filter(Boolean)

      if (shouldDispatch) {
        await notifyAdmins({
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
      }
    }

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
