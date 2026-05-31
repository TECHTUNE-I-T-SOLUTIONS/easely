import { ImapFlow } from "imapflow"
import nodemailer from "nodemailer"
import { simpleParser } from "mailparser"
import { supabaseAdmin } from "@/lib/supabase"
import { extractRecipientFromHeaders, normalizeEmailAddress, resolveDepartmentKeyFromText } from "@/lib/crm"

type ParsedMessage = {
  messageId: string | null
  threadId: string | null
  subject: string
  fromEmail: string
  fromName: string | null
  toEmails: string[]
  ccEmails: string[]
  bodyText: string
  bodyHtml: string | null
  headers: Record<string, string>
  receivedAt: string
  attachments: Array<{
    filename: string
    contentType: string
    size: number
  }>
}

function env(name: string, fallback = "") {
  return process.env[name] || fallback
}

function boolEnv(name: string, fallback = true) {
  const value = (process.env[name] || "").toLowerCase()
  if (!value) return fallback
  return value === "true" || value === "1" || value === "yes"
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function imapPasswords() {
  return uniqueValues([env("CRM_EMAIL_IMAP_PASSWORD"), env("CRM_EMAIL_IMAP_FALLBACK_PASSWORD")])
}

function smtpPasswords() {
  return uniqueValues([env("CRM_EMAIL_SMTP_PASSWORD"), env("CRM_EMAIL_SMTP_FALLBACK_PASSWORD")])
}

function imapClient(password = env("CRM_EMAIL_IMAP_PASSWORD")) {
  return new ImapFlow({
    host: env("CRM_EMAIL_IMAP_HOST", "imap.privateemail.com"),
    port: Number(env("CRM_EMAIL_IMAP_PORT", "993")),
    secure: boolEnv("CRM_EMAIL_USE_SSL", true),
    auth: {
      user: env("CRM_EMAIL_IMAP_USER", "support@charterkeke.com"),
      pass: password,
    },
    logger: false,
  })
}

function smtpTransport(password = env("CRM_EMAIL_SMTP_PASSWORD")) {
  return nodemailer.createTransport({
    host: env("CRM_EMAIL_SMTP_HOST", "smtp.privateemail.com"),
    port: Number(env("CRM_EMAIL_SMTP_PORT", "465")),
    secure: boolEnv("CRM_EMAIL_USE_SSL", true),
    auth: {
      user: env("CRM_EMAIL_SMTP_USER", "support@charterkeke.com"),
      pass: password,
    },
  })
}

async function resolveContactUserId(fromEmail: string, fromName: string | null): Promise<string | null> {
  const normalizedEmail = normalizeEmailAddress(fromEmail)
  if (!normalizedEmail || !supabaseAdmin) return null

  const { data: existingUser } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle()

  if (existingUser?.id) {
    return existingUser.id
  }

  const parts = (fromName || normalizedEmail.split("@")[0] || "Customer").split(/\s+/).filter(Boolean)
  const firstName = parts[0] || "Customer"
  const lastName = parts.slice(1).join(" ") || "Email"

  const { data: createdUser, error } = await supabaseAdmin
    .from("users")
    .insert({
      first_name: firstName,
      last_name: lastName,
      phone_number: normalizedEmail,
      email: normalizedEmail,
      role: "user",
      status: "active",
      profile_complete: false,
    })
    .select("id")
    .single()

  if (error) throw error
  return createdUser?.id || null
}

async function resolveDepartmentId(departmentKey: string): Promise<string | null> {
  if (!supabaseAdmin) return null
  const { data } = await supabaseAdmin
    .from("crm_departments")
    .select("id")
    .eq("department_key", departmentKey)
    .maybeSingle()
  return data?.id || null
}

async function upsertEmailAccount(recipientEmail: string, departmentId: string | null): Promise<string | null> {
  if (!supabaseAdmin) return null
  const normalizedRecipient = normalizeEmailAddress(recipientEmail || env("CRM_PRIMARY_SUPPORT_INBOX", "support@charterkeke.com"))
  const { data: existing } = await supabaseAdmin
    .from("crm_email_accounts")
    .select("id")
    .eq("email_address", normalizedRecipient)
    .maybeSingle()

  if (existing?.id) {
    await supabaseAdmin
      .from("crm_email_accounts")
      .update({ department_id: departmentId, is_active: true, last_synced_at: new Date().toISOString() })
      .eq("id", existing.id)
    return existing.id
  }

  const { data, error } = await supabaseAdmin
    .from("crm_email_accounts")
    .insert({
      display_name: normalizedRecipient,
      email_address: normalizedRecipient,
      provider: "namecheap_private_email",
      department_id: departmentId,
      is_active: true,
      last_synced_at: new Date().toISOString(),
      settings: {
        imapHost: env("CRM_EMAIL_IMAP_HOST", "imap.privateemail.com"),
        smtpHost: env("CRM_EMAIL_SMTP_HOST", "smtp.privateemail.com"),
      },
    })
    .select("id")
    .single()

  if (error) throw error
  return data?.id || null
}

function toHeaderRecord(headers: Map<string, unknown>): Record<string, string> {
  const output: Record<string, string> = {}
  for (const [key, value] of headers.entries()) {
    if (value === undefined || value === null) continue
    output[key.toLowerCase()] = String(value)
  }
  return output
}

async function parseMessage(source: Buffer): Promise<ParsedMessage> {
  const parsed = await simpleParser(source)
  const headerRecord = toHeaderRecord(parsed.headers)

  const toEmails = (parsed.to?.value || []).map((entry: any) => normalizeEmailAddress(entry.address)).filter(Boolean)
  const ccEmails = (parsed.cc?.value || []).map((entry: any) => normalizeEmailAddress(entry.address)).filter(Boolean)
  const from = parsed.from?.value?.[0]
  const fromEmail = normalizeEmailAddress(from?.address || "")
  const fromName = (from?.name || "").trim() || null

  const threadId = parsed.inReplyTo || (parsed.references?.length ? parsed.references[0] : null)
  const attachments = (parsed.attachments || []).map((attachment: any) => ({
    filename: attachment.filename || "attachment",
    contentType: attachment.contentType || "application/octet-stream",
    size: Number(attachment.size || 0),
  }))

  return {
    messageId: parsed.messageId || null,
    threadId: threadId || parsed.messageId || null,
    subject: (parsed.subject || "").trim() || "(No Subject)",
    fromEmail,
    fromName,
    toEmails,
    ccEmails,
    bodyText: (parsed.text || "").trim(),
    bodyHtml: parsed.html ? String(parsed.html) : null,
    headers: headerRecord,
    receivedAt: new Date(parsed.date || Date.now()).toISOString(),
    attachments,
  }
}

async function persistInboundMessage(message: ParsedMessage) {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client unavailable")
  }

  if (!message.fromEmail) {
    return { skipped: true, reason: "No sender email" }
  }

  const recipientEmail =
    message.toEmails[0] ||
    normalizeEmailAddress(extractRecipientFromHeaders(message.headers)) ||
    normalizeEmailAddress(env("CRM_PRIMARY_SUPPORT_INBOX", "support@charterkeke.com"))

  const { data: existingInbound } = await supabaseAdmin
    .from("crm_email_messages")
    .select("id")
    .eq("external_message_id", message.messageId || "")
    .eq("direction", "inbound")
    .maybeSingle()

  if (existingInbound?.id) {
    return { skipped: true, reason: "Already synced" }
  }

  const departmentKey = resolveDepartmentKeyFromText({
    subject: message.subject,
    body: message.bodyText || message.bodyHtml || "",
    senderEmail: message.fromEmail,
    recipientEmail,
  })

  const departmentId = await resolveDepartmentId(departmentKey)
  const emailAccountId = await upsertEmailAccount(recipientEmail, departmentId)
  const contactUserId = await resolveContactUserId(message.fromEmail, message.fromName)
  if (!contactUserId) {
    throw new Error("Unable to resolve sender contact")
  }

  let ticketId: string | null = null
  if (message.threadId) {
    const { data: existingTicket } = await supabaseAdmin
      .from("support_tickets")
      .select("id")
      .eq("external_thread_id", message.threadId)
      .maybeSingle()
    ticketId = existingTicket?.id || null
  }

  if (!ticketId) {
    const { data: createdTicket, error: ticketError } = await supabaseAdmin
      .from("support_tickets")
      .insert({
        user_id: contactUserId,
        subject: message.subject,
        description: message.bodyText || message.bodyHtml || message.subject,
        category: departmentKey,
        priority: "normal",
        status: "open",
        department_id: departmentId,
        source_channel: "email",
        source_email: message.fromEmail,
        source_name: message.fromName,
        external_thread_id: message.threadId,
        external_message_id: message.messageId,
        routing_reason: `Inbound email routed to ${departmentKey}`,
        routing_confidence: 100,
        crm_metadata: {
          recipientEmail,
          senderEmail: message.fromEmail,
          source: "namecheap_private_email",
          headers: message.headers,
        },
        user_last_read_at: message.receivedAt,
        last_message_at: message.receivedAt,
      })
      .select("id")
      .single()

    if (ticketError || !createdTicket) {
      throw ticketError || new Error("Failed to create support ticket")
    }
    ticketId = createdTicket.id
  }

  const { error: emailInsertError } = await supabaseAdmin
    .from("crm_email_messages")
    .insert({
      email_account_id: emailAccountId,
      ticket_id: ticketId,
      direction: "inbound",
      from_email: message.fromEmail,
      from_name: message.fromName,
      to_emails: message.toEmails,
      cc_emails: message.ccEmails,
      bcc_emails: [],
      subject: message.subject,
      body_text: message.bodyText || null,
      body_html: message.bodyHtml,
      attachments: message.attachments,
      external_message_id: message.messageId,
      external_thread_id: message.threadId,
      processing_status: "processed",
      processing_reason: "Synced from IMAP inbox",
      raw_headers: message.headers,
      raw_payload: {
        syncedAt: new Date().toISOString(),
      },
      received_at: message.receivedAt,
      processed_at: new Date().toISOString(),
    })

  if (emailInsertError) {
    throw emailInsertError
  }

  const { error: messageInsertError } = await supabaseAdmin
    .from("ticket_messages")
    .insert({
      ticket_id: ticketId,
      sender_id: contactUserId,
      message: message.bodyText || message.bodyHtml || message.subject,
      attachments: message.attachments,
      message_type: message.attachments.length ? "image" : "text",
      is_internal: false,
    })

  if (messageInsertError) {
    throw messageInsertError
  }

  if (boolEnv("CRM_EMAIL_AUTOREPLY_ENABLED", true)) {
    await supabaseAdmin
      .from("crm_email_messages")
      .insert({
        email_account_id: emailAccountId,
        ticket_id: ticketId,
        direction: "outbound",
        from_email: env("CRM_EMAIL_AUTOREPLY_FROM", recipientEmail),
        from_name: "Charter Keke Support",
        to_emails: [message.fromEmail],
        cc_emails: [],
        bcc_emails: [],
        subject: `Ticket Received - ${ticketId}`,
        body_text: `Hello ${message.fromName || "there"}, your message has been received and assigned ticket ${ticketId}.`,
        body_html: null,
        attachments: [],
        external_message_id: null,
        external_thread_id: message.threadId,
        processing_status: "queued",
        processing_reason: "Queued acknowledgment for SMTP delivery",
        raw_headers: {},
        raw_payload: {},
        received_at: new Date().toISOString(),
        processed_at: null,
      })
  }

  await supabaseAdmin
    .from("support_tickets")
    .update({
      source_channel: "email",
      department_id: departmentId,
      external_thread_id: message.threadId,
      external_message_id: message.messageId,
      last_message_at: message.receivedAt,
      updated_at: message.receivedAt,
    })
    .eq("id", ticketId)

  await supabaseAdmin
    .from("crm_email_accounts")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", emailAccountId || "")

  return { skipped: false, ticketId }
}

export async function syncInboxNow(limit = 20) {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client unavailable")
  }

  const passwords = imapPasswords()
  let client = imapClient(passwords[0])
  const synced: Array<Record<string, unknown>> = []
  const skipped: Array<Record<string, unknown>> = []
  const failed: Array<Record<string, unknown>> = []

  try {
    try {
      await client.connect()
    } catch (error) {
      if (passwords.length < 2) throw error
      await client.logout().catch(() => undefined)
      client = imapClient(passwords[1])
      await client.connect()
    }
    const lock = await client.getMailboxLock("INBOX")
    try {
      const status = await client.status("INBOX", { uidNext: true, messages: true })
      const end = Number(status.messages || 0)
      if (end <= 0) {
        return {
          syncedCount: 0,
          skippedCount: 0,
          failedCount: 0,
          synced,
          skipped,
          failed,
          message: "Mailbox is empty",
        }
      }

      const start = Math.max(1, end - limit + 1)

      for await (const message of client.fetch(`${start}:${end}`, { uid: true, source: true })) {
        try {
          if (!message.source) {
            skipped.push({ uid: message.uid, reason: "Message source buffer is empty" })
            continue
          }
          const parsed = await parseMessage(message.source)
          const result = await persistInboundMessage(parsed)
          if (result.skipped) {
            skipped.push({ uid: message.uid, reason: result.reason })
          } else {
            synced.push({ uid: message.uid, ticketId: result.ticketId, messageId: parsed.messageId })
          }
        } catch (error) {
          failed.push({ uid: message.uid, error: error instanceof Error ? error.message : "Unknown error" })
        }
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => undefined)
  }

  return {
    syncedCount: synced.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    synced,
    skipped,
    failed,
  }
}

export async function processOutboundQueue(limit = 20) {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client unavailable")
  }

  const passwords = smtpPasswords()
  let transporter = smtpTransport(passwords[0])
  if (passwords.length > 1) {
    try {
      await transporter.verify()
    } catch {
      transporter = smtpTransport(passwords[1])
    }
  }

  const { data: queued, error } = await supabaseAdmin
    .from("crm_email_messages")
    .select(
      `
        id,
        ticket_id,
        from_email,
        from_name,
        to_emails,
        cc_emails,
        bcc_emails,
        subject,
        body_text,
        body_html,
        attachments,
        external_thread_id
      `
    )
    .eq("direction", "outbound")
    .eq("processing_status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) throw error

  const sent: Array<Record<string, unknown>> = []
  const failed: Array<Record<string, unknown>> = []

  for (const item of queued || []) {
    try {
      const toList = Array.isArray(item.to_emails) ? item.to_emails.map((entry) => String(entry)).filter(Boolean) : []
      const ccList = Array.isArray(item.cc_emails) ? item.cc_emails.map((entry) => String(entry)).filter(Boolean) : []
      const bccList = Array.isArray(item.bcc_emails) ? item.bcc_emails.map((entry) => String(entry)).filter(Boolean) : []

      if (!toList.length) {
        throw new Error("Outbound email has no recipients")
      }

      const result = await transporter.sendMail({
        from: item.from_name ? `${item.from_name} <${item.from_email}>` : item.from_email,
        to: toList.join(", "),
        cc: ccList.length ? ccList.join(", ") : undefined,
        bcc: bccList.length ? bccList.join(", ") : undefined,
        subject: String(item.subject || ""),
        text: item.body_text ? String(item.body_text) : undefined,
        html: item.body_html ? String(item.body_html) : undefined,
      })

      await supabaseAdmin
        .from("crm_email_messages")
        .update({
          processing_status: "processed",
          processing_reason: "Delivered via SMTP",
          external_message_id: result.messageId,
          processed_at: new Date().toISOString(),
        })
        .eq("id", item.id)

      sent.push({ id: item.id, messageId: result.messageId })
    } catch (sendError) {
      const reason = sendError instanceof Error ? sendError.message : "Unknown SMTP error"
      failed.push({ id: item.id, error: reason })

      await supabaseAdmin
        .from("crm_email_messages")
        .update({
          processing_status: "failed",
          processing_reason: reason,
          processed_at: new Date().toISOString(),
        })
        .eq("id", item.id)
    }
  }

  return {
    queued: queued?.length || 0,
    sentCount: sent.length,
    failedCount: failed.length,
    sent,
    failed,
  }
}
