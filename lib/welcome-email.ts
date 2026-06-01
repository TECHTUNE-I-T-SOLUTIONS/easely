import nodemailer from "nodemailer"

type WelcomeEmailUser = {
  id: string
  firstName: string
  lastName: string
  email: string
  phone?: string | null
  role: string
  referralCode?: string | null
  plateNumber?: string | null
  vehicleType?: string | null
  operatingZones?: string | null
}

function env(name: string, fallback = "") {
  return process.env[name] || fallback
}

function appLink(path = "") {
  const base = env("MOBILE_APP_DEEPLINK_BASE", "charterkeke://").replace(/\/+$/, "")
  return `${base}/${path.replace(/^\/+/, "")}`
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

function row(label: string, value?: string | null) {
  if (!value) return ""
  return `<tr><td style="padding:8px 0;color:#6b7280">${label}</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#111827">${value}</td></tr>`
}

export async function sendWelcomeEmail(user: WelcomeEmailUser) {
  if (!user.email || !env("CRM_EMAIL_SMTP_PASSWORD") && !env("CRM_EMAIL_SMTP_FALLBACK_PASSWORD")) {
    return { skipped: true, reason: "SMTP is not configured" }
  }

  const isDriver = user.role === "driver"
  const title = isDriver ? "Welcome to Charter Keke Driver" : "Welcome to Charter Keke"
  const ctaLabel = isDriver ? "Open Driver Home" : "Book Your First Ride"
  const ctaUrl = appLink(isDriver ? "driver/home" : "rider/booking")
  const supportUrl = appLink("support")

  const html = `
    <div style="margin:0;padding:0;background:#f6f4ef;font-family:Arial,Helvetica,sans-serif;color:#111827">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f4ef;padding:24px 12px">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #f1dfc6">
              <tr>
                <td style="background:#f5820b;padding:28px;color:#111827">
                  <div style="font-size:13px;font-weight:800;letter-spacing:.16em;text-transform:uppercase">Charter Keke</div>
                  <h1 style="margin:10px 0 0;font-size:30px;line-height:1.15">${title}, ${user.firstName}</h1>
                  <p style="margin:10px 0 0;font-size:15px;line-height:1.6">Your account was created successfully. Keep this email as a quick reference for your Charter Keke profile and support options.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:28px">
                  <h2 style="margin:0 0 12px;font-size:18px">Your account details</h2>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #f3e4d0;border-bottom:1px solid #f3e4d0">
                    ${row("Name", `${user.firstName} ${user.lastName}`)}
                    ${row("Email", user.email)}
                    ${row("Phone", user.phone)}
                    ${row("Account type", isDriver ? "Driver" : "Rider")}
                    ${row("Referral code", user.referralCode)}
                    ${isDriver ? row("Vehicle", [user.vehicleType, user.plateNumber].filter(Boolean).join(" - ")) : ""}
                    ${isDriver ? row("Operating zones", user.operatingZones) : ""}
                  </table>

                  <h2 style="margin:28px 0 12px;font-size:18px">What you can do in the app</h2>
                  <ul style="margin:0;padding-left:20px;line-height:1.7;color:#374151">
                    ${
                      isDriver
                        ? "<li>Go online and receive ride requests.</li><li>Track active rides, earnings, wallet activity, and remittance status.</li><li>Chat with riders, receive push notifications, and manage trip history.</li>"
                        : "<li>Book keke rides, choose pickup and destination points, and view fare estimates.</li><li>Track your ride, chat with your driver, and receive live updates.</li><li>Review completed rides, manage wallet activity, and contact support in the app.</li>"
                    }
                  </ul>

                  <div style="margin:28px 0;display:flex;gap:12px;flex-wrap:wrap">
                    <a href="${ctaUrl}" style="display:inline-block;background:#f5820b;color:#111827;text-decoration:none;font-weight:800;padding:13px 18px;border-radius:12px">${ctaLabel}</a>
                    <a href="${supportUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:800;padding:13px 18px;border-radius:12px">Contact Support</a>
                  </div>

                  <h2 style="margin:0 0 12px;font-size:18px">Support and feedback</h2>
                  <p style="margin:0;line-height:1.7;color:#374151">You can reach us inside the app from the Support screen, or email <a href="mailto:support@charterkeke.com" style="color:#c46400;font-weight:700">support@charterkeke.com</a>. Feedback helps us improve pickup accuracy, driver matching, payments, safety, and the full ride experience.</p>

                  <p style="margin:28px 0 0;font-size:12px;line-height:1.6;color:#6b7280">If the app button does not open, visit <a href="${webLink("")}" style="color:#c46400">${webLink("")}</a> or open Charter Keke manually on your phone.</p>
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
    to: user.email,
    subject: `${title} - your account is ready`,
    html,
    text: `${title}, ${user.firstName}. Your Charter Keke account is ready. Open the app: ${ctaUrl}. Support: support@charterkeke.com`,
  })
}
