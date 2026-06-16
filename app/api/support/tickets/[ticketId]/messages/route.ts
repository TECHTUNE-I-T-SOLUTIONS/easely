import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { notifyAdmins } from "@/lib/admin-notifications";
import { generateSupportAIReply } from "@/lib/gemini-support";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ ticketId: string }> };

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

async function getNextCaseNumber(conversationId: string | null) {
  if (!conversationId || !supabaseAdmin) return 1;
  const { count } = await supabaseAdmin
    .from("support_tickets")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId);
  return (count || 0) + 1;
}

function isLikelyCorrection(message: string) {
  const normalized = message.trim().toLowerCase();
  return (
    /\b(no|not that|actually|correction|i meant|what i said|it is|its|my name is|look it up)\b/i.test(normalized) &&
    !/\b(help|support)\b/i.test(normalized)
  );
}

async function saveAiCorrection(ticketId: string, userId: string, role: string, originalReply: string, userMessage: string, note?: string) {
  if (!supabaseAdmin) return;
  await supabaseAdmin.from("support_ai_feedback").insert({
    ticket_id: ticketId,
    user_id: userId,
    role,
    feedback_type: "corrected_answer",
    original_reply: originalReply,
    corrected_reply: userMessage,
    correction_note: note || "User corrected the assistant in support chat.",
    route: role === "driver" ? "/driver/wallet" : null,
    tags: ["correction", role],
    metadata: { source: "in_app_support" },
  });

  try {
    await supabaseAdmin.from("support_ai_memory").insert({
      memory_type: "correction",
      title: "User correction from support chat",
      content: userMessage,
      category: "other",
      audience: role === "driver" ? "driver" : "all",
      route: role === "driver" ? "/driver/wallet" : null,
      tags: ["correction", role],
      source: "support_feedback",
      source_entity_type: "ticket_message",
      source_entity_id: ticketId,
      confidence: 0.75,
      metadata: { note: note || "auto captured correction" },
    });
  } catch {
    return;
  }
}

async function getRecentSupportContext(userId: string) {
  if (!supabaseAdmin) return { recentTickets: [], businessMemory: [] as any[] };

  const [{ data: recentTickets }, { data: businessMemory }] = await Promise.all([
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
    businessMemory: Array.isArray(businessMemory) ? businessMemory : [],
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

    let ticketQuery = supabaseAdmin
      .from("support_tickets")
      .select("id, user_id, status, subject, category, priority, conversation_id")
      .eq("id", ticketId);
    if (!isAdmin) {
      ticketQuery = ticketQuery.eq("user_id", session.user.id);
    }

    let { data: ticket, error: ticketError } = await ticketQuery.single();
    if (ticketError || !ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const now = new Date().toISOString();
    let targetTicketId = ticketId;
    let reopenedSameTicket = false;

    if (!isAdmin && (ticket.status === "resolved" || ticket.status === "closed")) {
      const { data: reopenedTicket, error: reopenError } = await supabaseAdmin
        .from("support_tickets")
        .update({
          status: "open",
          resolution_confirmed_at: null,
          resolved_at: null,
          resolution_requested_at: null,
          closed_by_user: false,
          updated_at: now,
          last_message_at: now,
          user_last_read_at: now,
        })
        .eq("id", ticket.id)
        .select("id, user_id, status, subject, category, priority, conversation_id")
        .single();

      if (reopenError || !reopenedTicket) {
        return NextResponse.json(
          { error: "Failed to reopen support ticket", details: reopenError?.message || "Unknown error" },
          { status: 500 }
        );
      }

      ticket = reopenedTicket;
      targetTicketId = reopenedTicket.id;
      reopenedSameTicket = true;
    }

    const payload = {
      ticket_id: targetTicketId,
      sender_id: session.user.id,
      message: text || "[attachment]",
      attachments,
      message_type: messageType || (attachmentUrl || attachments?.length ? "image" : "text"),
      attachment_url: attachmentUrl || null,
      attachment_name: attachmentName || null,
      attachment_mime_type: attachmentMimeType || null,
      attachment_size: attachmentSize || null,
      is_internal: isAdmin ? !!isInternal : false,
      sender_type: isAdmin ? (isInternal ? "admin" : "support") : "user",
      sender_label: isAdmin
        ? `${session.user.firstName || "Support"} - Charter Keke support`
        : session.user.firstName || "Customer",
      department_key: isAdmin ? "support" : null,
      metadata: { conversationId: ticket.conversation_id || null },
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
      if (reopenedSameTicket || ticket.status === "resolved" || ticket.status === "closed") {
        ticketUpdate.status = "in_progress";
        ticketUpdate.resolution_confirmed_at = null;
        ticketUpdate.resolved_at = null;
        ticketUpdate.resolution_requested_at = null;
        ticketUpdate.closed_by_user = false;
      }
    }

    await supabaseAdmin.from("support_tickets").update(ticketUpdate).eq("id", targetTicketId);
    if (ticket.conversation_id) {
      await supabaseAdmin
        .from("support_conversations")
        .update({ status: "in_progress", last_message_at: now, updated_at: now })
        .eq("id", ticket.conversation_id);
    }

    if (!isAdmin) {
      await notifyAdmins({
        allAdmins: true,
        department: "support",
        title: "New support message",
        body: `${session.user.firstName || "A customer"} replied to a support ticket.`,
        type: "support_message",
        actionUrl: `/admin/crm?ticket=${targetTicketId}`,
        metadata: { ticketId: targetTicketId, conversationId: ticket.conversation_id, userId: session.user.id, messageId: created?.id },
        sourceEventId: `support_message:${created?.id || targetTicketId}`,
      }).catch((error) => console.error("[SUPPORT][MESSAGES][ADMIN_NOTIFY]", error));

      const { data: recentMessages } = await supabaseAdmin
        .from("ticket_messages")
        .select("message, sender_id, users:sender_id(role)")
        .eq("ticket_id", targetTicketId)
        .eq("is_internal", false)
        .order("created_at", { ascending: false })
        .limit(12);

      const aiContext = await getRecentSupportContext(session.user.id).catch(() => ({ recentTickets: [], businessMemory: [] }));
      const memoryContext = await getRelevantSupportMemory(text || ticket.subject, session.user.role).catch(() => []);

      const history = (recentMessages || [])
        .reverse()
        .map((item: any) => {
          const user = Array.isArray(item.users) ? item.users[0] : item.users;
          const role: "customer" | "assistant" | "admin" =
            user?.role === "admin" || user?.role === "super_admin"
              ? "admin"
              : item.sender_id === session.user.id
                ? "customer"
                : "assistant";
          return { role, content: String(item.message || "") };
        });

      const ai = await generateSupportAIReply({
        channel: "in_app",
        subject: ticket.subject,
        customerName: session.user.firstName,
        userRole: session.user.role,
        latestMessage: text || "[attachment]",
        history,
        recentTickets: aiContext.recentTickets,
        businessMemory: [...aiContext.businessMemory, ...(memoryContext || [])],
      }).catch((error) => {
        console.error("[SUPPORT][MESSAGES][AI]", error);
        return null;
      });

      const senderId = await getAutomationSenderId();
      if (ai?.ok && ai.reply && senderId) {
          await supabaseAdmin.from("ticket_messages").insert({
            ticket_id: targetTicketId,
            sender_id: senderId,
            message: ai.reply,
            message_type: "text",
            is_internal: false,
            sender_type: "assistant",
            sender_label: "Dapo - Charter Keke assistant",
            department_key: ai.department || "support",
            metadata: {
              conversationId: ticket.conversation_id || null,
              model: ai.model,
              category: ai.category,
              deepLink: ai.department === "billing" && session.user.role === "driver" ? "/driver/wallet" : null,
            },
          });
      }

      if (isLikelyCorrection(text) && ai?.reply) {
        await saveAiCorrection(
          targetTicketId,
          session.user.id,
          session.user.role,
          ai.reply,
          text,
          "User corrected the assistant after a support reply."
        );
      }

      if (ai?.shouldEscalate) {
        await notifyAdmins({
          allAdmins: true,
          department: ai.department || "support",
          title: "AI escalated support reply",
          body: ai.reason || `${session.user.firstName || "A customer"} needs human support.`,
          type: "support_ai_escalation",
          actionUrl: `/admin/crm?ticket=${targetTicketId}`,
          metadata: { ticketId: targetTicketId, conversationId: ticket.conversation_id, userId: session.user.id, messageId: created?.id, category: ai.category, model: ai.model },
          sourceEventId: `support_ai_escalation:${created?.id || targetTicketId}`,
        }).catch((error) => console.error("[SUPPORT][MESSAGES][AI_ESCALATE]", error));
      }

      if (ai?.shouldResolve) {
        const resolvedAt = new Date().toISOString();
        await supabaseAdmin
          .from("support_tickets")
          .update({
            status: "resolved",
            resolved_at: resolvedAt,
            resolution_requested_at: resolvedAt,
            resolution_note: ai.reason || "Dapo marked this case resolved after customer confirmation.",
            updated_at: resolvedAt,
          })
          .eq("id", targetTicketId);
      }
    }

    return NextResponse.json({
      message: created,
      ticketId: targetTicketId,
      reopened: reopenedSameTicket,
    }, { status: 201 });
  } catch (error) {
    console.error("[SUPPORT][MESSAGES][POST]", error);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}
