import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { notifyAdmins } from "@/lib/admin-notifications";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ ticketId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json({ error: "Supabase admin client unavailable" }, { status: 503 });
    }

    const session = await getSessionFromRequest(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { ticketId } = await params;
    const body = await request.json();
    const {
      message,
      attachments = [],
      messageType,
      attachmentUrl,
      attachmentName,
      attachmentMimeType,
      attachmentSize,
      isInternal = false,
    } = body || {};

    const text = (message || "").trim();
    if (!text && !attachments?.length && !attachmentUrl) {
      return NextResponse.json({ error: "Message or attachment is required" }, { status: 400 });
    }

    const isAdmin = session.user.role === "admin" || session.user.role === "super_admin";

    let ticketQuery = supabaseAdmin.from("support_tickets").select("id, user_id, status").eq("id", ticketId);
    if (!isAdmin) {
      ticketQuery = ticketQuery.eq("user_id", session.user.id);
    }

    const { data: ticket, error: ticketError } = await ticketQuery.single();
    if (ticketError || !ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const now = new Date().toISOString();

    const payload = {
      ticket_id: ticketId,
      sender_id: session.user.id,
      message: text || "[attachment]",
      attachments,
      message_type: messageType || (attachmentUrl || attachments?.length ? "image" : "text"),
      attachment_url: attachmentUrl || null,
      attachment_name: attachmentName || null,
      attachment_mime_type: attachmentMimeType || null,
      attachment_size: attachmentSize || null,
      is_internal: isAdmin ? !!isInternal : false,
    };

    const { data: created, error: createError } = await supabaseAdmin
      .from("ticket_messages")
      .insert(payload)
      .select(
        `
          id,
          ticket_id,
          sender_id,
          message,
          attachments,
          created_at,
          message_type,
          attachment_url,
          attachment_name,
          attachment_mime_type,
          attachment_size,
          is_internal,
          users:sender_id (
            id,
            first_name,
            last_name,
            role,
            profile_picture_url
          )
        `
      )
      .single();

    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 400 });
    }

    const ticketUpdate: Record<string, any> = {
      last_message_at: now,
      updated_at: now,
    };

    if (isAdmin) {
      ticketUpdate.admin_last_read_at = now;
      if (ticket.status === "open") ticketUpdate.status = "in_progress";
    } else {
      ticketUpdate.user_last_read_at = now;
      if (ticket.status === "resolved" || ticket.status === "closed") {
        ticketUpdate.status = "in_progress";
        ticketUpdate.resolution_confirmed_at = null;
        ticketUpdate.closed_by_user = false;
      }
    }

    await supabaseAdmin.from("support_tickets").update(ticketUpdate).eq("id", ticketId);

    if (!isAdmin) {
      await notifyAdmins({
        allAdmins: true,
        department: "support",
        title: "New support message",
        body: `${session.user.firstName || "A customer"} replied to a support ticket.`,
        type: "support_message",
        actionUrl: `/admin/crm?ticket=${ticketId}`,
        metadata: { ticketId, userId: session.user.id, messageId: created?.id },
        sourceEventId: `support_message:${created?.id || ticketId}`,
      }).catch((error) => console.error("[SUPPORT][MESSAGES][ADMIN_NOTIFY]", error));
    }

    return NextResponse.json({ message: created }, { status: 201 });
  } catch (error) {
    console.error("[SUPPORT][MESSAGES][POST]", error);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}
