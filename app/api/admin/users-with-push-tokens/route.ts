import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Fetch users with push tokens from push_subscriptions table
    const { data: subscriptions, error } = await supabaseAdmin
      .from("push_subscriptions")
      .select(`
        user_id,
        push_token,
        platform,
        is_active,
        users!inner(id, email, first_name, last_name)
      `)
      .eq("is_active", true)
      .order("subscribed_at", { ascending: false })
      .limit(50)

    if (error) {
      console.error("[UsersWithPushTokens] Error:", error)
      return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 })
    }

    // Transform the data to include user info and push token
    const users = subscriptions?.map((sub: any) => ({
      id: sub.users.id,
      email: sub.users.email,
      first_name: sub.users.first_name,
      last_name: sub.users.last_name,
      push_token: sub.push_token,
      platform: sub.platform,
    })) || []

    return NextResponse.json({
      success: true,
      users,
      count: users.length,
    })
  } catch (error) {
    console.error("[UsersWithPushTokens] Error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
