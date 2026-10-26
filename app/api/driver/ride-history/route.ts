import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { getSessionFromRequest } from "@/lib/auth"

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id || session.user.role !== "driver") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get("page") || "1")
    const filter = searchParams.get("filter") || "all"

    // Get driver
    const { data: driver } = await supabase
      .from("drivers")
      .select("id")
      .eq("user_id", session.user.id)
      .single()

    if (!driver) {
      return NextResponse.json(
        { error: "Driver profile not found" },
        { status: 404 }
      )
    }

    // Build date filter
    let query = supabase
      .from("rides")
      .select(
        `
        id,
        pickup_zone,
        destination_zone,
        fare_amount,
        driver_earnings,
        platform_fee,
        distance_km,
        completed_at,
        created_at,
        status,
        rating,
        users:rider_id (first_name, last_name)
      `
      )
      .eq("driver_id", driver.id)
      .in("status", ["completed", "accepted", "in_progress"])
      .order("completed_at", { ascending: false })

    // Apply date filter
    const now = new Date()
    if (filter === "today") {
      const startOfDay = new Date(now)
      startOfDay.setHours(0, 0, 0, 0)
      query = query.gte("completed_at", startOfDay.toISOString())
    } else if (filter === "week") {
      const weekAgo = new Date(now)
      weekAgo.setDate(weekAgo.getDate() - 7)
      query = query.gte("completed_at", weekAgo.toISOString())
    }

    // Pagination
    const limit = 10
    const offset = (page - 1) * limit
    query = query.range(offset, offset + limit - 1)

    const { data: rides, error } = await query

    if (error) {
      console.error("Fetch error:", error)
      return NextResponse.json(
        { error: "Failed to fetch ride history" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      rides: rides || [],
      page,
      hasMore: (rides || []).length === limit,
    })
  } catch (error) {
    console.error("API error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
