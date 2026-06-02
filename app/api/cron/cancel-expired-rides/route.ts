import { NextRequest, NextResponse } from "next/server"
import { cancelExpiredOpenRides } from "@/lib/ride-expiry"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: "Database client not configured" },
        { status: 500 }
      )
    }

    const cronSecret = process.env.CRON_SECRET
    if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolved = await cancelExpiredOpenRides()
    const cancelled = resolved.filter((ride: any) => ["pending", "dispatched"].includes(ride.status))
    const completed = resolved.filter((ride: any) => ["accepted", "in_progress"].includes(ride.status))

    return NextResponse.json({
      success: true,
      resolvedCount: resolved.length,
      cancelledCount: cancelled.length,
      cancelledRideIds: cancelled.map((ride: any) => ride.id),
      completedCount: completed.length,
      completedRideIds: completed.map((ride: any) => ride.id),
      message: "Expired ride cleanup completed",
    })
  } catch (error) {
    console.error("[CronCancelExpiredRides] error:", error)
    return NextResponse.json(
      { error: "Failed to cancel expired rides" },
      { status: 500 }
    )
  }
}
