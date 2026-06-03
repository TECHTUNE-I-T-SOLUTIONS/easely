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
    const rideId = searchParams.get('rideId');
    const chatId = searchParams.get('chatId');

    if (!rideId && !chatId) {
      return NextResponse.json({ error: "Ride ID or chat ID required" }, { status: 400 });
    }

    // Get chat for this ride/chat. If a ride has no dedicated chat yet, fall back
    // to the existing participant conversation so repeat rider-driver messages
    // stay in one thread.
    let chatQuery = supabaseAdmin!
      .from("chats")
      .select(`
        id,
        ride_id,
        rider_id,
        driver_id,
        created_at,
        updated_at,
        rides (
          id,
          rider_id,
          driver_id,
          status,
          pickup_zone,
          destination_zone
        )
      `);

    chatQuery = chatId ? chatQuery.eq('id', chatId) : chatQuery.eq('ride_id', rideId);

    const { data: chat, error: chatError } = await chatQuery.single();
    let chatRecord: any = chat;

    if (!chatRecord && rideId && chatError?.code === 'PGRST116') {
      const { data: ride } = await supabaseAdmin!
        .from("rides")
        .select("id, rider_id, driver_id")
        .eq("id", rideId)
        .single();

      let driverUserId = null;
      if (ride?.driver_id) {
        const { data: driverById } = await supabaseAdmin!
          .from("drivers")
          .select("user_id")
          .eq("id", ride.driver_id)
          .single();
        driverUserId = driverById?.user_id || ride.driver_id;
      }

      if (ride?.rider_id && driverUserId) {
        const { data: existingParticipantChat } = await supabaseAdmin!
          .from("chats")
          .select(`
            id,
            ride_id,
            rider_id,
            driver_id,
            created_at,
            updated_at,
            rides (
              id,
              rider_id,
              driver_id,
              status,
              pickup_zone,
              destination_zone
            )
          `)
          .eq("rider_id", ride.rider_id)
          .eq("driver_id", driverUserId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        chatRecord = existingParticipantChat;
      }
    }

    // Get rider and driver details separately
    let riderData = null;
    let driverData = null;

    if (chatRecord) {
      if (chatRecord.rider_id) {
        const { data: rider } = await supabaseAdmin!
          .from("users")
          .select("id, first_name, last_name, profile_picture_url")
          .eq("id", chatRecord.rider_id)
          .single();
        riderData = rider;
      }

      if (chatRecord.driver_id) {
        const { data: driver } = await supabaseAdmin!
          .from("users")
          .select("id, first_name, last_name, profile_picture_url")
          .eq("id", chatRecord.driver_id)
          .single();
        driverData = driver;
      }
    }

    if (chatError && chatError.code !== 'PGRST116') { // PGRST116 is "not found"
      console.error('Chat fetch error:', chatError);
      return NextResponse.json({ error: "Failed to fetch chat" }, { status: 500 });
    }

    // Check if user is part of this ride
    if (chatRecord) {
      const isParticipant = chatRecord.rider_id === session.user.id || chatRecord.driver_id === session.user.id;
      if (!isParticipant) {
        return NextResponse.json({ error: "Not authorized for this chat" }, { status: 403 });
      }
    }

    return NextResponse.json({ 
      chat: {
        ...chatRecord,
        rider: riderData,
        driver: driverData
      }
    });
  } catch (error) {
    console.error('Chat GET error:', error);
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
    const { rideId } = body;

    if (!rideId) {
      return NextResponse.json({ error: "Ride ID required" }, { status: 400 });
    }

    // Check if ride exists and user is participant
    const { data: ride, error: rideError } = await supabaseAdmin!
      .from("rides")
      .select(`
        id, 
        rider_id, 
        driver_id, 
        status,
        drivers (
          id,
          user_id
        )
      `)
      .eq('id', rideId)
      .single();

    if (rideError || !ride) {
      console.error('Ride fetch error:', rideError);
      return NextResponse.json({ error: "Ride not found" }, { status: 404 });
    }

    // Get the driver's user_id from the drivers table
    let driverUserId = null;
    if (ride.driver_id) {
      const { data: driver, error: driverError } = await supabaseAdmin!
        .from("drivers")
        .select('user_id')
        .eq('id', ride.driver_id)
        .single();

      if (!driverError && driver) {
        driverUserId = driver.user_id;
      }
    }

    // Check if user is rider or driver
    const isRider = ride.rider_id === session.user.id;
    const isDriver = driverUserId === session.user.id;

    if (!isRider && !isDriver) {
      return NextResponse.json({ error: "Not authorized for this ride" }, { status: 403 });
    }

    // Check if ride is in appropriate status
    if (!['accepted', 'in_progress'].includes(ride.status)) {
      return NextResponse.json({ error: "Chat only available for active rides" }, { status: 400 });
    }

    // Check if chat already exists for this ride
    const { data: existingChat, error: existingError } = await supabaseAdmin!
      .from("chats")
      .select('id')
      .eq('ride_id', rideId)
      .single();

    if (existingChat) {
      return NextResponse.json({ chat: existingChat });
    }

    // Reuse the conversation between the same rider and driver instead of
    // creating a new thread for every ride between the same people.
    if (ride.rider_id && driverUserId) {
      const { data: participantChat } = await supabaseAdmin!
        .from("chats")
        .select("id, ride_id, rider_id, driver_id, created_at, updated_at")
        .eq("rider_id", ride.rider_id)
        .eq("driver_id", driverUserId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (participantChat?.id) {
        return NextResponse.json({ chat: participantChat });
      }
    }

    // Verify both rider and driver (users) exist before creating chat
    if (ride.rider_id) {
      const { data: rider, error: riderError } = await supabaseAdmin!
        .from("users")
        .select('id')
        .eq('id', ride.rider_id)
        .single();

      if (riderError || !rider) {
        return NextResponse.json({ 
          error: "Rider not found in system" 
        }, { status: 404 });
      }
    }

    if (driverUserId) {
      const { data: driver, error: driverError } = await supabaseAdmin!
        .from("users")
        .select('id')
        .eq('id', driverUserId)
        .single();

      if (driverError || !driver) {
        return NextResponse.json({ 
          error: "Driver not found in system. Please ensure driver is accepting rides." 
        }, { status: 404 });
      }
    } else {
      return NextResponse.json({ 
        error: "Chat only available after driver accepts the ride" 
      }, { status: 400 });
    }

    // Create new chat with driver's user_id (not driver table id)
    const { data: chat, error: chatCreateError } = await supabaseAdmin!
      .from("chats")
      .insert([{
        ride_id: rideId,
        rider_id: ride.rider_id,
        driver_id: driverUserId  // Use driver's user_id, not driver table id
      }])
      .select()
      .single();

    if (chatCreateError) {
      console.error('Chat creation error:', chatCreateError);
      
      // More specific error messages
      if (chatCreateError.code === '23503') {
        return NextResponse.json({ 
          error: "Cannot create chat: driver or rider not found in system" 
        }, { status: 404 });
      }
      
      return NextResponse.json({ error: "Failed to create chat" }, { status: 500 });
    }

    return NextResponse.json({ chat });
  } catch (error) {
    console.error('Chat POST error:', error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
