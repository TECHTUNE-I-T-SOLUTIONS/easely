import nodemailer from "nodemailer"

function env(name: string, fallback = "") {
  return process.env[name] || fallback
}

function webLink(path = "") {
  const base = env("NEXT_PUBLIC_APP_URL", env("NEXTAUTH_URL", "https://www.charterkeke.com")).replace(/\/+$/, "")
  return `${base}/${path.replace(/^\/+/, "")}`
}

function mailTransport() {
  return nodemailer.createTransport({
    host: env("CRM_EMAIL_SMTP_HOST", "smtp.privateemail.com"),
    port: Number(env("CRM_EMAIL_SMTP_PORT", "465")),
    secure: (env("CRM_EMAIL_USE_SSL", "true") || "true").toLowerCase() !== "false",
    auth: {
      user: env("CRM_EMAIL_SMTP_USER", "support@charterkeke.com"),
      pass: env("CRM_EMAIL_SMTP_PASSWORD") || env("CRM_EMAIL_SMTP_FALLBACK_PASSWORD"),
    },
  })
}

export async function sendAccountDeletionEmail({
  email,
  firstName,
  token,
}: {
  email: string
  firstName?: string | null
  token: string
}) {
  const smtpReady = env("CRM_EMAIL_SMTP_PASSWORD") || env("CRM_EMAIL_SMTP_FALLBACK_PASSWORD")
  if (!email || !smtpReady) {
    return { skipped: true, reason: "SMTP not configured" }
  }

  const confirmUrl = webLink(`delete-account/confirm?token=${encodeURIComponent(token)}`)
  const name = firstName?.trim() || "Charter Keke user"

  const html = `
    <div style="margin:0;padding:0;background:#f6f4ef;font-family:Arial,Helvetica,sans-serif;color:#111827">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f4ef;padding:24px 12px">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #f1dfc6">

              <!-- Header -->
              <tr>
                <td style="background:#1a1a1a;padding:28px;text-align:center">
                  <div style="font-size:13px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#f5820b">Charter Keke</div>
                  <h1 style="margin:10px 0 0;font-size:26px;line-height:1.15;color:#ffffff">Account Deletion Request</h1>
                </td>
              </tr>

              <!-- Body -->
              <tr>
                <td style="padding:32px 28px">
                  <p style="margin:0 0 16px;font-size:15px;color:#374151">Hi <strong>${name}</strong>,</p>
                  <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#374151">
                    We received a request to permanently delete your Charter Keke account and all associated data.
                  </p>
                  <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#374151">
                    If you made this request, click the button below to confirm. This link is valid for <strong>24 hours</strong>.
                  </p>

                  <!-- CTA Button -->
                  <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 28px">
                    <tr>
                      <td style="border-radius:12px;background:#ef4444">
                        <a href="${confirmUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:12px">
                          Confirm Account Deletion
                        </a>
                      </td>
                    </tr>
                  </table>

                  <!-- Warning box -->
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    <tr>
                      <td style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:16px 18px">
                        <p style="margin:0 0 8px;font-size:14px;font-weight:800;color:#b91c1c">⚠️ This action is permanent</p>
                        <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.7;color:#7f1d1d">
                          <li>Your profile, rides, messages, and all personal data will be deleted</li>
                          <li>Your account cannot be recovered after deletion</li>
                          <li>Any active rides or pending settlements must be resolved first</li>
                        </ul>
                      </td>
                    </tr>
                  </table>

                  <p style="margin:24px 0 0;font-size:13px;line-height:1.65;color:#6b7280">
                    If you did <strong>not</strong> request this, ignore this email — your account is safe and will not be deleted.
                  </p>
                  <p style="margin:16px 0 0;font-size:13px;line-height:1.65;color:#6b7280">
                    If the button above doesn't work, copy and paste this link into your browser:<br/>
                    <a href="${confirmUrl}" style="color:#c46400;word-break:break-all">${confirmUrl}</a>
                  </p>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="background:#f9fafb;border-top:1px solid #f3e4d0;padding:20px 28px;text-align:center">
                  <p style="margin:0;font-size:12px;color:#9ca3af">
                    Charter Keke · <a href="mailto:support@charterkeke.com" style="color:#c46400">support@charterkeke.com</a>
                  </p>
                  <p style="margin:8px 0 0;font-size:11px;color:#d1d5db">
                    This email was sent because an account deletion was requested for ${email}.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </div>
  `

  const transporter = mailTransport()
  return transporter.sendMail({
    from: env("CRM_EMAIL_AUTOREPLY_FROM", "Charter Keke <support@charterkeke.com>"),
    to: email,
    subject: "Confirm your Charter Keke account deletion",
    html,
    text: `Hi ${name},\n\nWe received a request to permanently delete your Charter Keke account.\n\nTo confirm, visit: ${confirmUrl}\n\nThis link expires in 24 hours. If you did not request this, ignore this email.\n\nSupport: support@charterkeke.com`,
  })
}
