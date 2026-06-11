import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ ticketId: string }> };

async function getAdminIdForUser(userId: string): Promise<string | null> {
  if (!supabaseAdmin) return null;
  const { data } = await supabaseAdmin
    .from("admins")
    .select("id")
    .eq("user_id", userId)
    .single();
  return data?.id || null;
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json({ error: "Supabase admin client unavailable" }, { status: 503 });
    }

    const session = await getSessionFromRequest(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { ticketId } = await params;
    const isAdmin = session.user.role === "admin" || session.user.role === "super_admin";

    let ticketQuery = supabaseAdmin.from("support_tickets").select(
        `
          id,
          user_id,
          subject,
          description,
          category,
          priority,
          status,
          assigned_to,
          related_ride_id,
          created_at,
          updated_at,
          resolved_at,
          resolution_note,
          resolution_requested_at,
          resolution_confirmed_at,
          user_last_read_at,
          admin_last_read_at,
          last_message_at,
          closed_by_user,
          users:user_id (
            id,
            first_name,
            last_name,
            email,
            role,
            profile_picture_url
          ),
          admins:assigned_to (
            id,
            user_id
          )
        `
      )
      .eq("id", ticketId);

    if (!isAdmin) {
      ticketQuery = ticketQuery.eq("user_id", session.user.id);
    }

    const { data: ticket, error: ticketError } = await ticketQuery.single();
    if (ticketError || !ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const { data: messages, error: msgError } = await supabaseAdmin
      .from("ticket_messages")
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
          sender_type,
          sender_label,
          department_key,
          metadata,
          users:sender_id (
            id,
            first_name,
            last_name,
            role,
            profile_picture_url
          )
        `
      )
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });

    if (msgError) {
      return NextResponse.json({ error: msgError.message }, { status: 400 });
    }

    const now = new Date().toISOString();
    const readPatch = isAdmin
      ? { admin_last_read_at: now }
      : { user_last_read_at: now };

    await supabaseAdmin.from("support_tickets").update(readPatch).eq("id", ticketId);

    return NextResponse.json({ ticket, messages: messages || [] });
  } catch (error) {
    console.error("[SUPPORT][TICKET][GET]", error);
    return NextResponse.json({ error: "Failed to fetch support ticket" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
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
      status,
      priority,
      assignedTo,
      resolutionNote,
      confirmResolved,
      closeByUser,
    } = body || {};

    const isAdmin = session.user.role === "admin" || session.user.role === "super_admin";

    let baseQuery = supabaseAdmin.from("support_tickets").select("*").eq("id", ticketId);
    if (!isAdmin) {
      baseQuery = baseQuery.eq("user_id", session.user.id);
    }

    const { data: existing, error: existingError } = await baseQuery.single();
    if (existingError || !existing) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const updates: Record<string, any> = {};

    if (isAdmin) {
      if (status) updates.status = status;
      if (priority) updates.priority = priority;
      if (typeof assignedTo === "string") updates.assigned_to = assignedTo;
      if (typeof resolutionNote === "string") updates.resolution_note = resolutionNote;

      if (status === "resolved") {
        updates.resolved_at = new Date().toISOString();
        updates.resolution_requested_at = new Date().toISOString();
      }
    } else {
      if (confirmResolved === true) {
        updates.resolution_confirmed_at = new Date().toISOString();
        updates.status = "closed";
      }

      if (closeByUser === true) {
        updates.closed_by_user = true;
        updates.status = "closed";
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("support_tickets")
      .update(updates)
      .eq("id", ticketId)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({ ticket: updated });
  } catch (error) {
    console.error("[SUPPORT][TICKET][PATCH]", error);
    return NextResponse.json({ error: "Failed to update support ticket" }, { status: 500 });
  }
}
