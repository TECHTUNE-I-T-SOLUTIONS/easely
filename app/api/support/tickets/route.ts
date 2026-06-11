import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { notifyAdmins } from "@/lib/admin-notifications";
import { generateSupportAIReply } from "@/lib/gemini-support";
import { supabaseAdmin } from "@/lib/supabase";

async function getAdminIdForUser(userId: string): Promise<string | null> {
  if (!supabaseAdmin) return null;
  const { data } = await supabaseAdmin
    .from("admins")
    .select("id")
    .eq("user_id", userId)
    .single();
  return data?.id || null;
}

async function getAutomationSenderId(): Promise<string | null> {
  if (!supabaseAdmin) return null;
  const { data } = await supabaseAdmin
    .from("admins")
    .select("user_id")
    .or("department.eq.support,admin_level.eq.super,admin_level.eq.super_admin,admin_level.eq.super-admin")
    .limit(1)
    .maybeSingle();
  return data?.user_id || null;
}

export async function GET(request: NextRequest) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json({ error: "Supabase admin client unavailable" }, { status: 503 });
    }

    const session = await getSessionFromRequest(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const category = searchParams.get("category");
    const priority = searchParams.get("priority");
    const includeClosed = searchParams.get("includeClosed") === "true";
    const search = searchParams.get("search");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);

    const isAdmin = session.user.role === "admin" || session.user.role === "super_admin";

    let query = supabaseAdmin
      .from("support_tickets")
      .select(
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
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (!isAdmin) {
      query = query.eq("user_id", session.user.id);
    }

    if (!includeClosed) {
      query = query.not("status", "in", "(closed)");
    }

    if (status) query = query.eq("status", status);
    if (category) query = query.eq("category", category);
    if (priority) query = query.eq("priority", priority);
    if (search) {
      query = query.or(`subject.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const tickets = Array.isArray(data) ? data : [];

    return NextResponse.json({ tickets });
  } catch (error) {
    console.error("[SUPPORT][TICKETS][GET]", error);
    return NextResponse.json({ error: "Failed to fetch tickets" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json({ error: "Supabase admin client unavailable" }, { status: 503 });
    }

    const session = await getSessionFromRequest(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      subject,
      description,
      category,
      priority = "normal",
      relatedRideId,
      attachments = [],
      initialMessage,
    } = body || {};

    if (!subject || !description || !category) {
      return NextResponse.json(
        { error: "subject, description and category are required" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from("support_tickets")
      .insert({
        user_id: session.user.id,
        subject,
        description,
        category,
        priority,
        status: "open",
        source_channel: "in_app",
        related_ride_id: relatedRideId || null,
        user_last_read_at: now,
        admin_last_read_at: null,
        last_message_at: now,
        crm_metadata: {
          source: "mobile_app",
          channel: "in_app",
        },
      })
      .select("*")
      .single();

    if (ticketError || !ticket) {
      return NextResponse.json({ error: ticketError?.message || "Failed to create ticket" }, { status: 400 });
    }

    const firstMessageText = (initialMessage || description || "").trim();
    if (firstMessageText) {
      const { error: msgError } = await supabaseAdmin.from("ticket_messages").insert({
        ticket_id: ticket.id,
        sender_id: session.user.id,
        message: firstMessageText,
        attachments,
        message_type: attachments?.length ? "image" : "text",
      });

      if (msgError) {
        console.error("[SUPPORT][TICKETS][POST] failed to insert first message", msgError);
      }
    }

    await notifyAdmins({
      allAdmins: true,
      department: "support",
      title: "New support ticket",
      body: `${session.user.firstName || "A customer"} opened "${subject}".`,
      type: "support_ticket",
      actionUrl: `/admin/crm?ticket=${ticket.id}`,
      metadata: { ticketId: ticket.id, userId: session.user.id, category, priority },
      sourceEventId: `support_ticket_created:${ticket.id}`,
    }).catch((error) => console.error("[SUPPORT][TICKETS][ADMIN_NOTIFY]", error));

    if (firstMessageText) {
      const ai = await generateSupportAIReply({
        channel: "in_app",
        subject,
        customerName: session.user.firstName,
        latestMessage: firstMessageText,
        history: [{ role: "customer", content: firstMessageText }],
      }).catch((error) => {
        console.error("[SUPPORT][TICKETS][AI]", error);
        return null;
      });

      if (ai?.ok && ai.reply) {
        const senderId = await getAutomationSenderId();
        if (senderId) {
          await supabaseAdmin.from("ticket_messages").insert({
            ticket_id: ticket.id,
            sender_id: senderId,
            message: ai.reply,
            message_type: "text",
            is_internal: false,
          });
        }
      }

      if (ai?.shouldEscalate) {
        await notifyAdmins({
          allAdmins: true,
          department: ai.department || "support",
          title: "AI escalated support ticket",
          body: ai.reason || `${session.user.firstName || "A customer"} needs human support.`,
          type: "support_ai_escalation",
          actionUrl: `/admin/crm?ticket=${ticket.id}`,
          metadata: { ticketId: ticket.id, userId: session.user.id, category: ai.category, model: ai.model },
          sourceEventId: `support_ai_escalation:${ticket.id}:${ai.category || "other"}`,
        }).catch((error) => console.error("[SUPPORT][TICKETS][AI_ESCALATE]", error));
      }

      if (ai?.shouldResolve) {
        await supabaseAdmin
          .from("support_tickets")
          .update({
            status: "resolved",
            resolved_at: new Date().toISOString(),
            resolution_requested_at: new Date().toISOString(),
            resolution_note: ai.reason || "Dapo marked this case resolved after customer confirmation.",
          })
          .eq("id", ticket.id);
      }
    }

    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    console.error("[SUPPORT][TICKETS][POST]", error);
    return NextResponse.json({ error: "Failed to create support ticket" }, { status: 500 });
  }
}
