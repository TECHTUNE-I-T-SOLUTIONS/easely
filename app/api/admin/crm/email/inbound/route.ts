import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import {
  CRM_DEPARTMENTS,
  extractEmailAddresses,
  extractRecipientFromHeaders,
  normalizeEmailAddress,
  resolveDepartmentKeyFromText,
} from "@/lib/crm"
import { processOutboundQueue } from "@/lib/crm-email-service"

function normalizeAttachments(input: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(input)) return []
  return input.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>
}

async function resolveContactUserId(fromEmail: string, fromName: string | null) {
  const normalizedEmail = normalizeEmailAddress(fromEmail)
  if (!normalizedEmail) return null

  const { data: existingUser } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle()

  if (existingUser?.id) {
    return existingUser.id as string
  }

  const nameParts = (fromName || normalizedEmail.split("@")[0] || "Customer").split(/\s+/)
  const firstName = nameParts[0] || "Customer"
  const lastName = nameParts.slice(1).join(" ") || "Email"

  const { data: createdUser, error } = await supabaseAdmin
    .from("users")
    .insert({
      first_name: firstName,
      last_name: lastName,
      phone_number: `email:${normalizedEmail}`,
      email: normalizedEmail,
      role: "user",
      status: "active",
      profile_complete: false,
    })
    .select("id")
    .single()

  if (error) {
    throw error
  }

  return createdUser?.id || null
}

export async function POST(request: NextRequest) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json({ error: "Supabase admin client unavailable" }, { status: 503 })
    }

    const body = await request.json()
    const rawHeaders = body?.headers && typeof body.headers === "object" ? body.headers : {}
    const subject = String(body?.subject || "").trim()
    const textBody = String(body?.textBody || body?.bodyText || "").trim()
    const htmlBody = String(body?.htmlBody || body?.bodyHtml || "").trim() || null
    const fromEmail = normalizeEmailAddress(body?.fromEmail || extractEmailAddresses(String(rawHeaders.from || rawHeaders.sender || ""))[0])
    const fromName = String(body?.fromName || rawHeaders["from-name"] || rawHeaders["reply-to-name"] || "").trim() || null
    const recipientEmail = normalizeEmailAddress(
      body?.recipientEmail || extractRecipientFromHeaders(rawHeaders) || rawHeaders.to || rawHeaders["x-original-to"] || null
    )
    const threadId = String(body?.externalThreadId || body?.threadId || rawHeaders["message-id"] || "").trim() || null
    const messageId = String(body?.externalMessageId || body?.messageId || rawHeaders["message-id"] || "").trim() || null
    const attachments = normalizeAttachments(body?.attachments)
    const receivedAt = String(body?.receivedAt || new Date().toISOString())

    if (!subject && !textBody) {
      return NextResponse.json({ error: "subject or body text is required" }, { status: 400 })
    }

    const departmentKey = resolveDepartmentKeyFromText({
      subject,
      body: textBody || htmlBody || "",
      senderEmail: fromEmail,
      recipientEmail,
    })

    if (!fromEmail) {
      return NextResponse.json({ error: "fromEmail is required for inbound CRM email" }, { status: 400 })
    }

    const { data: department } = await supabaseAdmin
      .from("crm_departments")
      .select("id, department_key, department_name")
      .eq("department_key", departmentKey)
      .single()

    const { data: emailAccount } = await supabaseAdmin
      .from("crm_email_accounts")
      .select("id, email_address, department_id, is_active")
      .eq("email_address", recipientEmail || body?.recipientEmail || "support@charterkeke.com")
      .maybeSingle()

    const effectiveDepartmentId = emailAccount?.department_id || department?.id || null

    const contactUserId = body?.senderUserId || (await resolveContactUserId(fromEmail, fromName))
    if (!contactUserId) {
      return NextResponse.json({ error: "Unable to resolve sender contact" }, { status: 400 })
    }

    const normalizedThreadKey = threadId || messageId || `${fromEmail}:${recipientEmail}:${subject}`.toLowerCase()
    let conversationId: string | null = null
    if (normalizedThreadKey) {
      const { data: existingConversation } = await supabaseAdmin
        .from("support_conversations")
        .select("id")
        .eq("source_channel", "email")
        .eq("external_thread_id", normalizedThreadKey)
        .maybeSingle()

      if (existingConversation?.id) {
        conversationId = existingConversation.id
      } else {
        const { data: createdConversation } = await supabaseAdmin
          .from("support_conversations")
          .insert({
            user_id: contactUserId,
            source_channel: "email",
            source_email: fromEmail || null,
            source_name: fromName,
            external_thread_id: normalizedThreadKey,
            subject: subject || `Email from ${fromEmail || "customer"}`,
            status: "open",
            last_message_at: receivedAt,
            metadata: { recipientEmail, departmentKey },
          })
          .select("id")
          .single()
        conversationId = createdConversation?.id || null
      }
    }

    let ticketId = body?.ticketId ? String(body.ticketId) : null
    if (!ticketId && threadId) {
      const { data: existingTicket } = await supabaseAdmin
        .from("support_tickets")
        .select("id")
        .or(`external_thread_id.eq.${threadId},external_message_id.eq.${messageId}`)
        .maybeSingle()
      ticketId = existingTicket?.id || null
    }

    let ticketRecord: Record<string, unknown> | null = null

    if (!ticketId) {
      const { data: createdTicket, error: ticketError } = await supabaseAdmin
        .from("support_tickets")
        .insert({
          user_id: contactUserId,
          conversation_id: conversationId,
          case_number: 1,
          case_source: "email",
          subject: subject || `Email from ${fromEmail || recipientEmail || "customer"}`,
          description: textBody || htmlBody || subject || "Incoming email",
          category: departmentKey,
          priority: String(body?.priority || "normal"),
          status: "open",
          assigned_to: null,
          department_id: effectiveDepartmentId,
          source_channel: "email",
          source_email: fromEmail || null,
          source_name: fromName,
          external_thread_id: threadId,
          external_message_id: messageId,
          routing_reason: `Inbound email routed to ${departmentKey}`,
          routing_confidence: Number(body?.routingConfidence || 100),
          crm_metadata: {
            emailAlias: recipientEmail,
            headers: rawHeaders,
            originalPayload: body,
            departmentKey,
            source: "namecheap_private_email",
          },
          user_last_read_at: receivedAt,
          last_message_at: receivedAt,
        })
        .select("*")
        .single()

      if (ticketError || !createdTicket) {
        return NextResponse.json({ error: ticketError?.message || "Failed to create ticket" }, { status: 400 })
      }

      ticketRecord = createdTicket
      ticketId = createdTicket.id
    }

    const { data: emailMessage, error: emailMessageError } = await supabaseAdmin
      .from("crm_email_messages")
      .insert({
        email_account_id: emailAccount?.id || null,
        ticket_id: ticketId,
        direction: "inbound",
        from_email: fromEmail || recipientEmail || "unknown@charterkeke.com",
        from_name: fromName,
        to_emails: recipientEmail ? [recipientEmail] : [],
        cc_emails: Array.isArray(body?.cc) ? body.cc : [],
        bcc_emails: Array.isArray(body?.bcc) ? body.bcc : [],
        subject,
        body_text: textBody || null,
        body_html: htmlBody,
        attachments,
        external_message_id: messageId,
        external_thread_id: threadId,
        processing_status: "processed",
        processing_reason: "Inbound email stored and routed into CRM",
        raw_headers: rawHeaders,
        raw_payload: body,
        received_at: receivedAt,
        processed_at: new Date().toISOString(),
      })
      .select("*")
      .single()

    if (emailMessageError) {
      return NextResponse.json({ error: emailMessageError.message }, { status: 400 })
    }

    await supabaseAdmin
      .from("support_tickets")
      .update({
        conversation_id: conversationId,
        source_channel: "email",
        department_id: effectiveDepartmentId,
        external_thread_id: threadId,
        external_message_id: messageId,
        last_message_at: receivedAt,
        updated_at: receivedAt,
      })
      .eq("id", ticketId)

    if (conversationId) {
      await supabaseAdmin
        .from("support_conversations")
        .update({ last_message_at: receivedAt, updated_at: receivedAt, status: "in_progress" })
        .eq("id", conversationId)
    }

    const { data: outboundAck } = await supabaseAdmin
      .from("crm_email_messages")
      .insert({
        email_account_id: emailAccount?.id || null,
        ticket_id: ticketId,
        direction: "outbound",
        from_email: recipientEmail || emailAccount?.email_address || "support@charterkeke.com",
        from_name: "Charter Keke Support",
        to_emails: fromEmail ? [fromEmail] : [],
        subject: `Ticket Received - ${ticketId}`,
        body_text: `Hello ${fromName || "there"}, your message has been received and assigned ticket ${ticketId}.`,
        attachments: [],
        external_thread_id: threadId,
        external_message_id: null,
        processing_status: "queued",
        processing_reason: "Queued acknowledgment for outbound delivery",
        raw_headers: {},
        raw_payload: { ticketId, type: "acknowledgment" },
        received_at: new Date().toISOString(),
      })
      .select("id")

    if (outboundAck?.length) {
      processOutboundQueue(10).catch((error) => console.error("[CRM][EMAIL][INBOUND][OUTBOUND_QUEUE]", error))
    }

    return NextResponse.json(
      {
        success: true,
        ticketId,
        ticket: ticketRecord,
        emailMessage,
        messageRecord: null,
        outboundAck,
        departmentKey,
        emailAlias: recipientEmail,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("[CRM][EMAIL][INBOUND]", error)
    return NextResponse.json({ error: "Failed to ingest inbound CRM email" }, { status: 500 })
  }
}
