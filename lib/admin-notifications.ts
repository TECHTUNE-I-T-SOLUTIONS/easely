import webpush from "web-push"
import nodemailer from "nodemailer"
import { supabaseAdmin } from "@/lib/supabase"

type AdminNotificationInput = {
  userIds?: string[]
  department?: string
  allAdmins?: boolean
  title: string
  body: string
  type?: string
  actionUrl?: string
  metadata?: Record<string, unknown>
  sourceEventId?: string
  persist?: boolean
}

let vapidConfigured = false

function env(name: string, fallback = "") {
  return process.env[name] || fallback
}

function boolEnv(name: string, fallback = true) {
  const value = (process.env[name] || "").toLowerCase()
  if (!value) return fallback
  return value === "true" || value === "1" || value === "yes"
}

function adminBaseUrl() {
  return env("ADMIN_APP_URL", env("NEXT_PUBLIC_ADMIN_URL", "https://admin.charterkeke.com")).replace(/\/+$/, "")
}

function absoluteActionUrl(actionUrl?: string) {
  const base = adminBaseUrl()
  if (!actionUrl) return `${base}/admin/dashboard`
  if (/^https?:\/\//i.test(actionUrl)) return actionUrl
  return `${base}${actionUrl.startsWith("/") ? actionUrl : `/${actionUrl}`}`
}

function configureVapid() {
  if (vapidConfigured) return true

  const publicKey = env("NEXT_PUBLIC_VAPID_PUBLIC_KEY")
  const privateKey = env("VAPID_PRIVATE_KEY")
  const subject = env("VAPID_SUBJECT", "mailto:support@charterkeke.com")

  if (!publicKey || !privateKey) return false

  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidConfigured = true
  return true
}

function smtpTransport() {
  const user = env("CRM_EMAIL_SMTP_USER", "support@charterkeke.com")
  const pass = env("CRM_EMAIL_SMTP_PASSWORD") || env("CRM_EMAIL_SMTP_FALLBACK_PASSWORD")
  if (!pass) return null

  return nodemailer.createTransport({
    host: env("CRM_EMAIL_SMTP_HOST", "smtp.privateemail.com"),
    port: Number(env("CRM_EMAIL_SMTP_PORT", "465")),
    secure: boolEnv("CRM_EMAIL_USE_SSL", true),
    auth: { user, pass },
  })
}

async function sendAdminNotificationEmails(userIds: string[], input: AdminNotificationInput) {
  if (!userIds.length || env("ADMIN_NOTIFICATION_EMAILS_ENABLED", "true") === "false") return 0
  const transporter = smtpTransport()
  if (!transporter) return 0

  const { data: users } = await supabaseAdmin
    .from("users")
    .select("email, first_name")
    .in("id", userIds)
    .not("email", "is", null)

  let sent = 0
  await Promise.all(
    (users || []).map(async (user) => {
      try {
        const url = absoluteActionUrl(input.actionUrl)
        await transporter.sendMail({
          from: `Charter Keke Admin Alerts <${env("CRM_EMAIL_SMTP_USER", "support@charterkeke.com")}>`,
          to: user.email,
          subject: input.title,
          text: `${input.body}\n\nOpen: ${url}`,
          html: `
            <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f2ec;padding:24px">
              <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #f0dec8;border-radius:18px;overflow:hidden">
                <div style="background:#111;color:#fff;padding:22px 24px">
                  <div style="color:#ff8a00;font-size:12px;font-weight:900;letter-spacing:.16em;text-transform:uppercase">Charter Keke Admin Alert</div>
                  <h1 style="margin:8px 0 0;font-size:24px;line-height:1.25">${input.title}</h1>
                </div>
                <div style="padding:24px;color:#333;font-size:15px;line-height:1.65">
                  <p>Hello ${user.first_name || "Admin"},</p>
                  <p>${input.body}</p>
                  <p><a href="${url}" style="display:inline-block;background:#ff8a00;color:#111;text-decoration:none;font-weight:800;border-radius:12px;padding:12px 16px">Open in admin</a></p>
                </div>
              </div>
            </div>
          `,
        })
        sent += 1
      } catch (error) {
        console.error("[ADMIN][NOTIFICATIONS][EMAIL]", error)
      }
    })
  )
  return sent
}

async function resolveAdminUserIds(input: AdminNotificationInput) {
  const targetUserIds = new Set(Array.from(new Set(input.userIds || [])).filter(Boolean))
  const department = input.department?.trim().toLowerCase()

  if (input.allAdmins) {
    const { data: admins } = await supabaseAdmin.from("admins").select("user_id, users:user_id(status)")
    for (const admin of admins || []) {
      const user = Array.isArray((admin as any).users) ? (admin as any).users[0] : (admin as any).users
      if (admin.user_id && user?.status !== "deleted") targetUserIds.add(admin.user_id)
    }
  }

  if (department) {
    const { data: admins } = await supabaseAdmin
      .from("admins")
      .select("user_id")
      .or(`department.eq.${department},admin_level.eq.super,admin_level.eq.super_admin,admin_level.eq.super-admin`)

    for (const admin of admins || []) {
      if (admin.user_id) targetUserIds.add(admin.user_id)
    }
  }

  return { targetUserIds, department }
}

export async function notifyAdmins(input: AdminNotificationInput) {
  const shouldPersist = input.persist !== false

  if (input.sourceEventId && shouldPersist) {
    const { data: existing } = await supabaseAdmin
      .from("admin_notifications")
      .select("id")
      .eq("type", input.type || "admin_event")
      .contains("metadata", { sourceEventId: input.sourceEventId })
      .limit(1)

    if (existing?.length) return { success: true, delivered: 0, emailed: 0, skipped: "duplicate" }
  }

  const { targetUserIds, department } = await resolveAdminUserIds(input)
  const targetIds = Array.from(targetUserIds)
  const metadata = {
    ...(input.metadata || {}),
    ...(input.sourceEventId ? { sourceEventId: input.sourceEventId } : {}),
    source: "app_backend",
  }

  const rows = [
    ...targetIds.map((userId) => ({
      recipient_user_id: userId,
      recipient_department: null,
      title: input.title,
      body: input.body,
      type: input.type || "admin_event",
      action_url: input.actionUrl || null,
      metadata,
    })),
    ...(department && !targetIds.length
      ? [
          {
            recipient_user_id: null,
            recipient_department: department,
            title: input.title,
            body: input.body,
            type: input.type || "admin_event",
            action_url: input.actionUrl || null,
            metadata,
          },
        ]
      : []),
  ]

  if (shouldPersist && rows.length) {
    const { error } = await supabaseAdmin.from("admin_notifications").insert(rows)
    if (error) console.error("[ADMIN][NOTIFICATIONS][INSERT]", error)
  }

  let delivered = 0
  if (targetIds.length && configureVapid()) {
    const { data: subscriptions } = await supabaseAdmin
      .from("admin_push_subscriptions")
      .select("id, admin_user_id, endpoint, p256dh, auth")
      .eq("is_active", true)
      .in("admin_user_id", targetIds)

    await Promise.all(
      (subscriptions || []).map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            JSON.stringify({
              title: input.title,
              body: input.body,
              type: input.type || "admin_event",
              actionUrl: absoluteActionUrl(input.actionUrl),
              metadata,
            })
          )
          delivered += 1
        } catch (error: any) {
          if (error?.statusCode === 404 || error?.statusCode === 410) {
            await supabaseAdmin
              .from("admin_push_subscriptions")
              .update({ is_active: false, updated_at: new Date().toISOString() })
              .eq("id", subscription.id)
          }
        }
      })
    )
  }

  const emailed = await sendAdminNotificationEmails(targetIds, input)
  return { success: true, delivered, emailed }
}
