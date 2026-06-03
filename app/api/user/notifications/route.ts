import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { getSessionFromRequest } from "@/lib/auth"

const parseMaybeJson = (value: any) => {
  if (!value || typeof value !== "string") return value || {}
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

const buildNotificationLink = (notification: any, role: "rider" | "driver") => {
  const metadata = parseMaybeJson(notification?.metadata)
  const data = parseMaybeJson(notification?.data)
  const payload = { ...metadata, ...data, ...notification }
  const explicit = payload.deep_link || payload.deeplink || payload.action_url
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim()

  const rideId = payload.rideId || payload.ride_id || payload.ride?.id
  const ticketId = payload.ticketId || payload.ticket_id || payload.support_ticket_id
  const chatId = payload.chatId || payload.chat_id
  const type = String(payload.type || payload.notification_type || "").toLowerCase()
  const relatedTable = String(payload.related_table || payload.table || "").toLowerCase()

  if (relatedTable === "messages" || chatId) {
    return "/rider/chat" + (rideId ? "?rideId=" + rideId : chatId ? "?chatId=" + chatId : "")
  }
  if (["ride_accepted", "ride_update", "driver_arrived", "trip_started"].includes(type)) {
    return rideId ? "/rider/active-ride?rideId=" + rideId : "/rider/rides-history"
  }
  if (["ride", "ride_completed", "ride_cancelled"].includes(type)) {
    return rideId ? "/rider/ride-details?rideId=" + rideId : "/rider/rides-history"
  }
  if (["message", "chat_message"].includes(type)) {
    return "/rider/chat" + (rideId ? "?rideId=" + rideId : chatId ? "?chatId=" + chatId : "")
  }
  if (["support_message", "support_ticket"].includes(type)) {
    return "/rider/help-and-support" + (ticketId ? "?ticketId=" + ticketId : "")
  }
  return null
}

const enrichNotification = (notification: any, role: "rider" | "driver") => {
  const metadata = parseMaybeJson(notification?.metadata)
  const deepLink = buildNotificationLink(notification, role)
  return {
    ...notification,
    metadata,
    deep_link: notification.deep_link || deepLink,
    action_url: notification.action_url || deepLink,
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id || session.user.role !== "user") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const unreadOnly = searchParams.get("unread") === "true"

    let query = supabase
      .from("notifications")
      .select("*")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })

    if (unreadOnly) {
      query = query.eq("read", false)
    }

    const { data: notifications, error } = await query

    if (error) {
      console.error("Failed to fetch notifications:", error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // Count unread
    const unreadCount = (notifications || []).filter((n) => !n.read).length

    const enrichedNotifications = (notifications || []).map((notification) =>
      enrichNotification(notification, "rider")
    )

    return NextResponse.json({
      notifications: enrichedNotifications,
      unreadCount,
    })
  } catch (error) {
    console.error("API error:", error)
    return NextResponse.json(
      { error: "Failed to fetch notifications" },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id || session.user.role !== "user") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { notificationId, markAsRead } = body

    if (!notificationId) {
      return NextResponse.json(
        { error: "Notification ID required" },
        { status: 400 }
      )
    }

    // Update notification
    const { error } = await supabase
      .from("notifications")
      .update({
        read: markAsRead || true,
        read_at: markAsRead ? new Date().toISOString() : null,
      })
      .eq("id", notificationId)
      .eq("user_id", session.user.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("API error:", error)
    return NextResponse.json(
      { error: "Failed to update notification" },
      { status: 500 }
    )
  }
}
