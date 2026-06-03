import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get('chatId');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!chatId) {
      return NextResponse.json({ error: "Chat ID required" }, { status: 400 });
    }

    // Verify user has access to this chat
    const { data: chat, error: chatError } = await supabaseAdmin!
      .from("chats")
      .select('id, rider_id, driver_id')
      .eq('id', chatId)
      .single();

    if (chatError || !chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const isParticipant = chat.rider_id === session.user.id || chat.driver_id === session.user.id;
    if (!isParticipant) {
      return NextResponse.json({ error: "Not authorized for this chat" }, { status: 403 });
    }

    const { data: participantChats, error: participantChatsError } = await supabaseAdmin!
      .from("chats")
      .select("id")
      .eq("rider_id", chat.rider_id)
      .eq("driver_id", chat.driver_id);

    if (participantChatsError) {
      console.error('Participant chats fetch error:', participantChatsError);
      return NextResponse.json({ error: "Failed to fetch conversation" }, { status: 500 });
    }

    const chatIds = (participantChats || []).map((participantChat) => participantChat.id);

    if (chatIds.length === 0) {
      return NextResponse.json({ messages: [] });
    }

    // Get all messages between these two users, including older ride-scoped chat rows.
    const { data: messages, error: messagesError } = await supabaseAdmin!
      .from("messages")
      .select(`
        id,
        chat_id,
        sender_id,
        content,
        message_type,
        location_data,
        sent_at,
        read_by_rider,
        read_by_driver,
        users!messages_sender_id_fkey (
          id,
          first_name,
          last_name
        )
      `)
      .in('chat_id', chatIds)
      .order('sent_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (messagesError) {
      console.error('Messages fetch error:', messagesError);
      return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
    }

    // Mark ALL messages as read for the current user viewing them
    // (This includes their own messages since they're viewing them)
    const isRider = chat.rider_id === session.user.id;
    
    // Find messages that need to be marked as read
    const unreadMessageIds = messages
      .filter(msg => {
        // For rider: mark as read if not already read by rider
        if (isRider) {
          return !msg.read_by_rider;
        }
        // For driver: mark as read if not already read by driver
        return !msg.read_by_driver;
      })
      .map(msg => msg.id);

    if (unreadMessageIds.length > 0) {
      console.log('[MESSAGES] Marking messages as read:', {
        isRider,
        messageCount: unreadMessageIds.length,
        userId: session.user.id,
      });

      const updateData = isRider
        ? { read_by_rider: true }
        : { read_by_driver: true };

      const { error: updateError } = await supabaseAdmin!
        .from("messages")
        .update(updateData)
        .in('id', unreadMessageIds);

      if (updateError) {
        console.error('[MESSAGES] Error marking messages as read:', updateError);
      } else {
        console.log('[MESSAGES] Successfully marked messages as read');
      }
    }

    return NextResponse.json({ messages: messages.reverse() }); // Reverse to show oldest first
  } catch (error) {
    console.error('Messages GET error:', error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { chatId, content, messageType = 'text', locationData } = body;

    if (!chatId) {
      return NextResponse.json({ error: "Chat ID required" }, { status: 400 });
    }

    if (messageType === 'text' && !content?.trim()) {
      return NextResponse.json({ error: "Message content required" }, { status: 400 });
    }

    if (messageType === 'location' && !locationData) {
      return NextResponse.json({ error: "Location data required" }, { status: 400 });
    }

    // Verify user has access to this chat
    const { data: chat, error: chatError } = await supabaseAdmin!
      .from("chats")
      .select('id, rider_id, driver_id')
      .eq('id', chatId)
      .single();

    if (chatError || !chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const isParticipant = chat.rider_id === session.user.id || chat.driver_id === session.user.id;
    if (!isParticipant) {
      return NextResponse.json({ error: "Not authorized for this chat" }, { status: 403 });
    }

    // Create message
    const messageData: any = {
      chat_id: chatId,
      sender_id: session.user.id,
      message_type: messageType,
      sent_at: new Date().toISOString()
    };

    if (messageType === 'text') {
      messageData.content = content.trim();
    } else if (messageType === 'location') {
      messageData.location_data = locationData;
    }

    const { data: message, error: messageError } = await supabaseAdmin!
      .from("messages")
      .insert([messageData])
      .select(`
        id,
        chat_id,
        sender_id,
        content,
        message_type,
        location_data,
        sent_at,
        read_by_rider,
        read_by_driver,
        users!messages_sender_id_fkey (
          id,
          first_name,
          last_name
        )
      `)
      .single();

    if (messageError) {
      console.error('Message creation error:', messageError);
      return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
    }

    return NextResponse.json({ message });
  } catch (error) {
    console.error('Messages POST error:', error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
