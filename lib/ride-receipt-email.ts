import nodemailer from "nodemailer"

function env(name: string, fallback = "") {
  return process.env[name] || fallback
}

function smtpTransport() {
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

function money(value: unknown) {
  const amount = Number(value || 0)
  return `NGN ${Number.isFinite(amount) ? amount.toLocaleString() : "0"}`
}

function clean(value: unknown, fallback = "Not available") {
  const output = String(value ?? "").trim()
  return output || fallback
}

function dateTime(value: unknown) {
  if (!value) return "Not available"
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString("en-NG", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function receiptNumber(ride: any) {
  return `CK-${String(ride.id || "ride").replace(/-/g, "").slice(0, 10).toUpperCase()}`
}

function escapeHtml(raw: unknown) {
  return String(raw ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function normalize(ride: any, audience: "rider" | "driver") {
  const fare = Number(ride.fare_amount ?? ride.fare ?? 0)
  const platformFee = Number(ride.platform_fee ?? 0)
  const driverEarnings = Number(ride.driver_earnings ?? Math.max(0, fare - platformFee))
  const rider = ride.rider || ride.users || {}
  const driverUser = ride.driverUser || ride.driver_user || {}
  const driver = ride.driver || ride.drivers || {}
  return {
    number: receiptNumber(ride),
    status: clean(ride.status, "accepted").toUpperCase(),
    createdAt: dateTime(ride.created_at),
    pickup: clean(ride.pickup_zone),
    dropoff: clean(ride.destination_zone),
    riderName: clean(`${rider.first_name || ""} ${rider.last_name || ""}`.trim(), "Rider"),
    driverName: clean(`${driverUser.first_name || ""} ${driverUser.last_name || ""}`.trim(), "Driver"),
    driverPhone: clean(driverUser.phone_number, ""),
    vehicle: clean(driver.vehicle_type, "Keke"),
    plateNumber: clean(driver.plate_number, ""),
    fare,
    platformFee,
    driverEarnings,
    total: audience === "driver" ? driverEarnings : fare + platformFee,
  }
}

export function renderRideReceiptEmailHtml(ride: any, audience: "rider" | "driver") {
  const data = normalize(ride, audience)
  const isDriver = audience === "driver"
  return `
    <div style="margin:0;padding:0;background:#f6f2ec;font-family:Arial,Helvetica,sans-serif;color:#171717">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f2ec;padding:28px 12px">
        <tr><td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border:1px solid #f0dec8;border-radius:22px;overflow:hidden;box-shadow:0 18px 50px rgba(24,24,27,.08)">
            <tr><td style="background:#111111;padding:26px 28px;color:#ffffff">
              <table role="presentation" width="100%"><tr>
                <td width="62"><img src="https://admin.charterkeke.com/charter%20keke.png" width="54" height="54" alt="Charter Keke" style="display:block;border-radius:14px;border:1px solid rgba(255,138,0,.45)" /></td>
                <td style="padding-left:14px">
                  <div style="font-size:12px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:#ff8a00">Charter Keke</div>
                  <div style="font-size:25px;line-height:1.25;font-weight:900;margin-top:4px">${isDriver ? "Ride accepted successfully" : "Your ride has been accepted"}</div>
                </td>
              </tr></table>
            </td></tr>
            <tr><td style="padding:30px 28px">
              <p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:#333333">${isDriver ? "You accepted this ride. The ride sheet is attached for quick pickup confirmation." : "A driver has accepted your ride. Your receipt is attached as PDF and image for sharing or pickup confirmation."}</p>
              <div style="border:1px solid #f0dec8;border-radius:18px;overflow:hidden;margin-bottom:20px">
                <div style="background:#fff5e8;padding:14px 18px;border-bottom:1px solid #f0dec8">
                  <div style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#9a5a00;font-weight:800">Reference</div>
                  <div style="font-size:18px;font-weight:900;color:#171717;margin-top:4px">${escapeHtml(data.number)} - ${escapeHtml(data.status)}</div>
                </div>
                <div style="padding:18px">
                  <p><strong>Pickup:</strong> ${escapeHtml(data.pickup)}</p>
                  <p><strong>Dropoff:</strong> ${escapeHtml(data.dropoff)}</p>
                  <p><strong>Rider:</strong> ${escapeHtml(data.riderName)}</p>
                  <p><strong>Driver:</strong> ${escapeHtml(data.driverName)} ${data.plateNumber ? `(${escapeHtml(data.plateNumber)})` : ""}</p>
                  <p><strong>${isDriver ? "Driver earning" : "Total payable"}:</strong> ${money(data.total)}</p>
                </div>
              </div>
              <p style="margin:0;font-size:14px;line-height:1.6;color:#6b7280">The attached PDF is best for printing. The image file is best for quick sharing from your phone.</p>
            </td></tr>
            <tr><td style="background:#ff8a00;padding:16px 28px;color:#111111;font-size:13px;font-weight:800">Affordable Keke rides in Lagos</td></tr>
          </table>
        </td></tr>
      </table>
    </div>
  `
}

export function renderRideReceiptSvg(ride: any, audience: "rider" | "driver") {
  const data = normalize(ride, audience)
  const label = audience === "driver" ? "Driver Ride Sheet" : "Ride Receipt"
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
    <rect width="1080" height="1350" fill="#f6f2ec"/>
    <rect x="70" y="70" width="940" height="1210" rx="42" fill="#fff" stroke="#f0dec8" stroke-width="3"/>
    <rect x="70" y="70" width="940" height="250" rx="42" fill="#111"/>
    <text x="120" y="150" fill="#ff8a00" font-family="Arial" font-size="26" font-weight="900" letter-spacing="5">CHARTER KEKE</text>
    <text x="120" y="212" fill="#fff" font-family="Arial" font-size="54" font-weight="900">${escapeHtml(label)}</text>
    <text x="120" y="274" fill="#fff" opacity=".82" font-family="Arial" font-size="28">${escapeHtml(data.number)} - ${escapeHtml(data.status)}</text>
    ${[
      ["Created", data.createdAt],
      ["Rider", data.riderName],
      ["Driver", `${data.driverName} ${data.plateNumber ? `- ${data.plateNumber}` : ""}`],
      ["Pickup", data.pickup],
      ["Dropoff", data.dropoff],
      [audience === "driver" ? "Driver earning" : "Total payable", money(data.total)],
    ].map((row, index) => {
      const y = 390 + index * 130
      const total = index === 5
      return `<text x="130" y="${y}" fill="#7c5b37" font-family="Arial" font-size="24" font-weight="900">${escapeHtml(row[0]).toUpperCase()}</text>
      <text x="130" y="${y + 48}" fill="${total ? "#ff8a00" : "#171717"}" font-family="Arial" font-size="${total ? 48 : 34}" font-weight="900">${escapeHtml(row[1]).slice(0, 48)}</text>`
    }).join("")}
    <rect x="70" y="1190" width="940" height="90" fill="#ff8a00"/>
    <text x="120" y="1247" fill="#111" font-family="Arial" font-size="26" font-weight="900">Affordable Keke rides in Lagos</text>
  </svg>`
}

export async function renderRideReceiptPdfBuffer(ride: any, audience: "rider" | "driver") {
  const data = normalize(ride, audience)
  const rows = [
    ["Created", data.createdAt],
    ["Pickup", data.pickup],
    ["Dropoff", data.dropoff],
    ["Rider", data.riderName],
    ["Driver", `${data.driverName} ${data.plateNumber ? `(${data.plateNumber})` : ""}`],
    ["Ride fare", money(data.fare)],
    ["Platform fee", money(data.platformFee)],
    [audience === "driver" ? "Driver earning" : "Total payable", money(data.total)],
  ]

  return renderSimplePdf({
    title: audience === "driver" ? "Driver Ride Sheet" : "Ride Receipt",
    subtitle: `${data.number} - ${data.status}`,
    rows,
  })
}

function escapePdfText(value: unknown) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r?\n/g, " ")
}

function renderSimplePdf({
  title,
  subtitle,
  rows,
}: {
  title: string
  subtitle: string
  rows: string[][]
}) {
  const lines: string[] = [
    "q",
    "0 0 0 rg",
    "0 682 595 160 re f",
    "1 0.54 0 rg",
    "BT /F1 12 Tf 44 790 Td (CHARTER KEKE) Tj ET",
    "1 1 1 rg",
    `BT /F1 30 Tf 44 754 Td (${escapePdfText(title)}) Tj ET`,
    `BT /F1 12 Tf 44 712 Td (${escapePdfText(subtitle)}) Tj ET`,
    "0.09 0.09 0.09 rg",
  ]

  let y = 635
  for (const [label, value] of rows) {
    const isTotal = /earning|payable/i.test(label)
    lines.push("0.49 0.36 0.22 rg")
    lines.push(`BT /F1 9 Tf 44 ${y} Td (${escapePdfText(label.toUpperCase())}) Tj ET`)
    lines.push(isTotal ? "1 0.54 0 rg" : "0.09 0.09 0.09 rg")
    lines.push(`BT /F1 ${isTotal ? 22 : 14} Tf 44 ${y - 20} Td (${escapePdfText(value).slice(0, 90)}) Tj ET`)
    y -= 58
  }

  lines.push("1 0.54 0 rg")
  lines.push("0 0 595 70 re f")
  lines.push("0 0 0 rg")
  lines.push("BT /F1 12 Tf 44 32 Td (Affordable Keke rides in Lagos) Tj ET")
  lines.push("Q")

  const stream = lines.join("\n")
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`,
  ]

  let pdf = "%PDF-1.4\n"
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(pdf, "utf8")
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  return Buffer.from(pdf, "utf8")
}

export async function sendRideReceiptEmail({
  to,
  ride,
  audience,
}: {
  to: string
  ride: any
  audience: "rider" | "driver"
}) {
  if (!to || (!env("CRM_EMAIL_SMTP_PASSWORD") && !env("CRM_EMAIL_SMTP_FALLBACK_PASSWORD"))) return

  const pdf = await renderRideReceiptPdfBuffer(ride, audience)
  const svg = Buffer.from(renderRideReceiptSvg(ride, audience), "utf8")
  const reference = receiptNumber(ride)

  await smtpTransport().sendMail({
    from: env("CRM_EMAIL_AUTOREPLY_FROM", "Charter Keke <support@charterkeke.com>"),
    to,
    subject: audience === "driver" ? `Ride accepted - ${reference}` : `Your Charter Keke ride receipt - ${reference}`,
    text: `Your Charter Keke ${audience === "driver" ? "ride sheet" : "ride receipt"} is attached as PDF and image.`,
    html: renderRideReceiptEmailHtml(ride, audience),
    attachments: [
      {
        filename: `${reference}-${audience}.pdf`,
        content: pdf,
        contentType: "application/pdf",
      },
      {
        filename: `${reference}-${audience}.svg`,
        content: svg,
        contentType: "image/svg+xml",
      },
    ],
  })
}
