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

async function getOrCreateInAppConversation(userId: string, subject: string) {
  if (!supabaseAdmin) return null;

  const { data: existing } = await supabaseAdmin
    .from("support_conversations")
    .select("id")
    .eq("user_id", userId)
    .eq("source_channel", "in_app")
    .neq("status", "closed")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing;

  const { data, error } = await supabaseAdmin
    .from("support_conversations")
    .insert({
      user_id: userId,
      source_channel: "in_app",
      subject,
      status: "open",
      metadata: { source: "mobile_app" },
    })
    .select("id")
    .single();

  if (error) {
    console.error("[SUPPORT][CONVERSATION][CREATE]", error);
    return null;
  }

  return data;
}

async function getNextCaseNumber(conversationId: string | null) {
  if (!conversationId || !supabaseAdmin) return 1;
  const { count } = await supabaseAdmin
    .from("support_tickets")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId);
  return (count || 0) + 1;
}

async function getRecentSupportContext(userId: string) {
  if (!supabaseAdmin) return { recentTickets: [], businessMemory: [] as any[] };

  const [{ data: recentTickets }, memoryResult] = await Promise.all([
    supabaseAdmin
      .from("support_tickets")
      .select("id, subject, category, status, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(5),
    supabaseAdmin
      .from("support_ai_memory")
      .select("title, content, category, audience, route")
      .order("updated_at", { ascending: false })
      .limit(8),
  ]);

  return {
    recentTickets: Array.isArray(recentTickets) ? recentTickets : [],
    businessMemory: Array.isArray(memoryResult?.data) ? memoryResult.data : [],
  };
}

async function getRelevantSupportMemory(query: string, audience?: string | null) {
  if (!supabaseAdmin) return [];
  const terms = Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .filter((term) => term.length >= 3)
        .slice(0, 8)
    )
  );
  if (!terms.length) return [];

  const filters = terms
    .map((term) => `title.ilike.%${term}%,content.ilike.%${term}%,tags.cs.{${term}}`)
    .join(",");

  let queryBuilder = supabaseAdmin
    .from("support_ai_memory")
    .select("title, content, category, audience, route")
    .eq("is_active", true)
    .order("usefulness_score", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(6);

  if (audience) {
    queryBuilder = queryBuilder.or(`audience.eq.all,audience.eq.${audience}`);
  }

  const { data } = await queryBuilder.or(filters);
  return Array.isArray(data) ? data : [];
}

async function getDriverContext(userId: string) {
  if (!supabaseAdmin) return null;

  const { data: driver } = await supabaseAdmin
    .from("drivers")
    .select(
      `
        id,
        verified,
        availability_status,
        user_id,
        users:user_id (
          first_name,
          last_name,
          phone_number
        )
      `
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (!driver) return null;

  const { data: latestSettlement } = await supabaseAdmin
    .from("driver_daily_settlement")
    .select("settlement_status, payment_due_date, total_platform_fees")
    .eq("driver_id", driver.id)
    .order("payment_due_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const user = Array.isArray(driver.users) ? driver.users[0] : driver.users;
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();

  return {
    driverId: driver.id,
    fullName: fullName || null,
    phoneNumber: user?.phone_number || null,
    walletRoute: "/driver/wallet",
    currentAvailability: driver.availability_status || null,
    verified: Boolean(driver.verified),
    settlementStatus: latestSettlement?.settlement_status || null,
    settlementDueDate: latestSettlement?.payment_due_date || null,
    overdueAmount: Number(latestSettlement?.total_platform_fees || 0),
    lastPaymentAt: null,
  };
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
    const conversation = await getOrCreateInAppConversation(session.user.id, subject);
    const caseNumber = await getNextCaseNumber(conversation?.id || null);
    const aiContext = await getRecentSupportContext(session.user.id).catch(() => ({ recentTickets: [], businessMemory: [] }));
    const driverContext = session.user.role === "driver" ? await getDriverContext(session.user.id).catch(() => null) : null;

    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from("support_tickets")
      .insert({
        user_id: session.user.id,
        conversation_id: conversation?.id || null,
        case_number: caseNumber,
        case_source: "manual",
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

    if (conversation?.id) {
      await supabaseAdmin
        .from("support_conversations")
        .update({ last_message_at: now, updated_at: now, status: "in_progress" })
        .eq("id", conversation.id);
    }

    const firstMessageText = (initialMessage || description || "").trim();
    const memoryContext = await getRelevantSupportMemory(firstMessageText || subject, session.user.role).catch(() => []);
    if (firstMessageText) {
      const { error: msgError } = await supabaseAdmin.from("ticket_messages").insert({
        ticket_id: ticket.id,
        sender_id: session.user.id,
        message: firstMessageText,
        attachments,
        message_type: attachments?.length ? "image" : "text",
        sender_type: "user",
        sender_label: session.user.firstName || "Customer",
        metadata: { conversationId: conversation?.id || null, caseNumber },
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
        userRole: session.user.role,
        latestMessage: firstMessageText,
        history: [{ role: "customer", content: firstMessageText }],
        driverContext,
        recentTickets: aiContext.recentTickets,
        businessMemory: [...aiContext.businessMemory, ...(memoryContext || [])],
      }).catch((error) => {
        console.error("[SUPPORT][TICKETS][AI]", error);
        return null;
      });

      const aiResult = ai?.ok ? ai : null;

      if (aiResult?.reply) {
        const senderId = await getAutomationSenderId();
        if (senderId) {
          await supabaseAdmin.from("ticket_messages").insert({
            ticket_id: ticket.id,
            sender_id: senderId,
            message: aiResult.reply,
            message_type: "text",
            is_internal: false,
            sender_type: "assistant",
            sender_label: "Dapo - Charter Keke assistant",
            department_key: aiResult.department || "support",
            metadata: {
              conversationId: conversation?.id || null,
              caseNumber,
              model: aiResult.model,
              category: aiResult.category,
              deepLink: aiResult.department === "billing" && session.user.role === "driver" ? "/driver/wallet" : null,
            },
          });
        }
        try {
          await supabaseAdmin.from("support_ai_memory").insert({
            memory_type: "knowledge",
            title: subject,
            content: aiResult.reply,
            category: aiResult.category || null,
            audience: session.user.role === "driver" ? "driver" : "all",
            route: aiResult.department === "billing" && session.user.role === "driver" ? "/driver/wallet" : null,
            tags: [aiResult.category || "other", session.user.role || "all"],
            source: "ai_reply",
            confidence: aiResult.confidence || 0.5,
            metadata: {
              ticketId: ticket.id,
              conversationId: conversation?.id || null,
              model: aiResult.model,
            },
          });
        } catch {
          // Ignore memory write failures; the reply itself already succeeded.
        }
      }

      if (aiResult?.shouldEscalate) {
        await notifyAdmins({
          allAdmins: true,
          department: aiResult.department || "support",
          title: "AI escalated support ticket",
          body: aiResult.reason || `${session.user.firstName || "A customer"} needs human support.`,
          type: "support_ai_escalation",
          actionUrl: `/admin/crm?ticket=${ticket.id}`,
          metadata: { ticketId: ticket.id, userId: session.user.id, category: aiResult.category, model: aiResult.model },
          sourceEventId: `support_ai_escalation:${ticket.id}:${aiResult.category || "other"}`,
        }).catch((error) => console.error("[SUPPORT][TICKETS][AI_ESCALATE]", error));
      }

      if (aiResult?.shouldResolve) {
        await supabaseAdmin
          .from("support_tickets")
          .update({
            status: "resolved",
            resolved_at: new Date().toISOString(),
            resolution_requested_at: new Date().toISOString(),
            resolution_note: aiResult.reason || "Dapo marked this case resolved after customer confirmation.",
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
