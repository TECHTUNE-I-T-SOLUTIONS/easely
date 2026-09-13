import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { getSessionFromRequest } from "@/lib/auth"

export async function GET(request: NextRequest) {
  try {
    console.log("🔵 [RIDE-HISTORY] Received request")
    // console.log("📋 [RIDE-HISTORY] Headers:", Object.fromEntries(request.headers))
    
    // Try NextAuth session first (for web app)
    let session = await getSessionFromRequest(request)
    let userId: string | null = null

    if (session?.user?.id) {
      console.log("✅ [RIDE-HISTORY] Found NextAuth session, userId:", session.user.id)
      userId = session.user.id
    } else {
      console.log("⚠️  [RIDE-HISTORY] No NextAuth session, trying Bearer token")
      // Fall back to custom Bearer token (for mobile app)
      const authHeader = request.headers.get("authorization")
      console.log("🔑 [RIDE-HISTORY] Authorization header:", authHeader)
      
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.substring(7)
        console.log("🔑 [RIDE-HISTORY] Bearer token found, length:", token.length)
        try {
          const decoded = Buffer.from(token, "base64").toString("utf-8")
          console.log("✅ [RIDE-HISTORY] Decoded token:", decoded)
          const [id] = decoded.split(":") // Format: userId:timestamp
          console.log("👤 [RIDE-HISTORY] Extracted userId:", id)
          if (id) {
            userId = id
          }
        } catch (e) {
          console.error("❌ [RIDE-HISTORY] Failed to decode Bearer token:", e)
        }
      } else {
        console.error("❌ [RIDE-HISTORY] No Bearer token in header")
      }
    }

    if (!userId) {
      console.error("❌ [RIDE-HISTORY] No userId found, returning 401")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get("page") || "1")
    const limit = parseInt(searchParams.get("limit") || "10")
    const offset = (page - 1) * limit

    // Get rider's completed/cancelled rides
    const { data: rides, error, count } = await supabase
      .from("rides")
      .select(
        `
        id,
        driver_id,
        pickup_zone,
        destination_zone,
        fare_amount,
        status,
        rating,
        review,
        pickup_time,
        dropoff_time,
        distance_km,
        duration_minutes,
        completed_at,
        created_at,
        drivers:driver_id (id, vehicle_picture_url, users:user_id (first_name, last_name, profile_picture_url))
      `,
        { count: "exact" }
      )
      .eq("rider_id", userId)
      .in("status", ["completed", "cancelled"])
      .order("completed_at", { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error("Failed to fetch ride history:", error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({
      rides: rides || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit),
      },
    })
  } catch (error) {
    console.error("API error:", error)
    return NextResponse.json(
      { error: "Failed to fetch ride history" },
      { status: 500 }
    )
  }
}
