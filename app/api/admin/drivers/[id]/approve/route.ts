import { NextRequest, NextResponse } from "next/server"
import nodemailer from "nodemailer"
import { supabaseAdmin } from "@/lib/supabase"
import { sendPushNotification } from "@/lib/push-service"
import { sendSMS } from "@/lib/termii"
import { isDeletedPlaceholderEmail, isDeletedPlaceholderPhone, isDeletedUserLike } from "@/lib/contact-hygiene"

function env(name: string, fallback = "") {
  return process.env[name] || fallback
}

async function sendApprovalEmail(to: string, firstName?: string | null) {
  const pass = env("CRM_EMAIL_SMTP_PASSWORD") || env("CRM_EMAIL_SMTP_FALLBACK_PASSWORD")
  if (!to || !pass) return

  const transporter = nodemailer.createTransport({
    host: env("CRM_EMAIL_SMTP_HOST", "smtp.privateemail.com"),
    port: Number(env("CRM_EMAIL_SMTP_PORT", "465")),
    secure: (env("CRM_EMAIL_USE_SSL", "true") || "true").toLowerCase() !== "false",
    auth: {
      user: env("CRM_EMAIL_SMTP_USER", "support@charterkeke.com"),
      pass,
    },
  })

  const name = firstName || "Driver"
  await transporter.sendMail({
    from: env("CRM_EMAIL_AUTOREPLY_FROM", `Charter Keke <${env("CRM_EMAIL_SMTP_USER", "support@charterkeke.com")}>`),
    to,
    subject: "Your Charter Keke driver account is approved",
    text: `Hello ${name}, your Charter Keke driver account has been approved. You can now open the app, go online, receive ride requests, and accept rides.`,
    html: `
      <div style="margin:0;padding:0;background:#f6f2ec;font-family:Arial,Helvetica,sans-serif;color:#171717">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:28px 12px">
          <tr><td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:660px;background:#fff;border:1px solid #f0dec8;border-radius:22px;overflow:hidden">
              <tr><td style="background:#111;padding:24px 28px;color:#fff">
                <div style="font-size:12px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:#ff8a00">Charter Keke Drivers</div>
                <div style="font-size:26px;line-height:1.25;font-weight:900;margin-top:6px">Account approved</div>
              </td></tr>
              <tr><td style="padding:30px 28px">
                <p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:#333">Hello ${name},</p>
                <p style="margin:0 0 22px;font-size:16px;line-height:1.65;color:#333">Your driver account has been verified and approved. You can now open Charter Keke, go online, receive ride requests, and accept rides.</p>
                <div style="background:#fff5e8;border:1px solid #f0dec8;border-radius:18px;padding:18px">
                  <div style="font-size:14px;color:#333;line-height:1.6">Keep your documents current, keep your phone reachable, and only accept rides you can serve safely.</div>
                </div>
              </td></tr>
              <tr><td style="background:#ff8a00;padding:16px 28px;color:#111;font-size:13px;font-weight:700">Charter Keke - Driver Operations</td></tr>
            </table>
          </td></tr>
        </table>
      </div>
    `,
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id, user_id, verified")
      .or(`id.eq.${id},user_id.eq.${id}`)
      .maybeSingle()

    if (driverError || !driver?.id) {
      return NextResponse.json({ error: "Driver not found" }, { status: 404 })
    }

    const { data: updatedDriver, error: updateError } = await supabaseAdmin
      .from("drivers")
      .update({
        verified: true,
        identity_verified: true,
        identity_verification_status: "verified",
        identity_verification_provider: "manual_admin",
        identity_verification_reason: null,
        identity_verified_at: new Date().toISOString(),
        availability_status: "offline",
        updated_at: new Date().toISOString(),
      })
      .eq("id", driver.id)
      .select("id, user_id, verified, availability_status")
      .single()

    // Also ensure user status is active
    if (!updateError && updatedDriver) {
      await supabaseAdmin
        .from("users")
        .update({
          status: "active",
          updated_at: new Date().toISOString(),
        })
        .eq("id", driver.user_id)
    }

    if (updateError || !updatedDriver) {
      return NextResponse.json({ error: updateError?.message || "Failed to approve driver" }, { status: 400 })
    }

    const { data: user } = await supabaseAdmin
      .from("users")
      .select("id, first_name, email, phone_number, status, deleted_at, deletion_reason")
      .eq("id", driver.user_id)
      .maybeSingle()

    if (isDeletedUserLike(user)) {
      return NextResponse.json({ success: true, driver: updatedDriver, skippedNotifications: true })
    }

    const message = "Your Charter Keke driver account has been approved. Open the app to go online and start receiving ride requests."

    await Promise.allSettled([
      user?.phone_number && !isDeletedPlaceholderPhone(user.phone_number) ? sendSMS({ to: user.phone_number, message, channel: "dnd", type: "plain" }) : Promise.resolve(),
      user?.email && !isDeletedPlaceholderEmail(user.email) ? sendApprovalEmail(user.email, user.first_name) : Promise.resolve(),
      sendPushNotification([driver.user_id], {
        title: "Driver account approved",
        body: "You can now go online and accept Charter Keke rides.",
        type: "security_alert",
        data: { deeplink: "/driver/home", driverId: driver.id },
      }),
    ])

    return NextResponse.json({ success: true, driver: updatedDriver })
  } catch (error) {
    console.error("[ADMIN][DRIVERS][APPROVE]", error)
    return NextResponse.json({ error: "Failed to approve driver" }, { status: 500 })
  }
}
