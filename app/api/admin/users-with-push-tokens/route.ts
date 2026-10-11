import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Fetch users with push tokens
    const { data: users, error } = await supabaseAdmin
      .from("users")
      .select("id, email, first_name, last_name, push_token")
      .not("push_token", "is", null)
      .not("push_token", "eq", "")
      .order("created_at", { ascending: false })
      .limit(50)

    if (error) {
      console.error("[UsersWithPushTokens] Error:", error)
      return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      users: users || [],
      count: users?.length || 0,
    })
  } catch (error) {
    console.error("[UsersWithPushTokens] Error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
