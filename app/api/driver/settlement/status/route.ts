import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import {
  getDateRangeForOffset,
  upsertSettlementForDate,
  updateOverdueSettlements,
  getOutstandingSettlements,
  summarizeSettlement,
} from "@/lib/driver-settlement"

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id || session.user.role !== "driver") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: driver } = await supabaseAdmin!
      .from("drivers")
      .select("id")
      .eq("user_id", session.user.id)
      .single()

    if (!driver?.id) {
      return NextResponse.json({ error: "Driver profile not found" }, { status: 404 })
    }

    await updateOverdueSettlements(driver.id)

    const todayRange = getDateRangeForOffset(0)
    const { dateString } = getDateRangeForOffset(-1)
    const todaySettlement = await upsertSettlementForDate(driver.id, todayRange.dateString)
    const settlement = await upsertSettlementForDate(driver.id, dateString)

    const outstanding = await getOutstandingSettlements(driver.id)
    const totalOutstanding = outstanding.reduce(
      (sum, entry) => sum + Number(entry.total_platform_fees || 0),
      0
    )

    const blocked = totalOutstanding > 0
    const { data: todayRides } = await supabaseAdmin!
      .from("rides")
      .select("id, platform_fee, remitted")
      .eq("driver_id", driver.id)
      .in("status", ["accepted", "in_progress", "completed"])
      .eq("remitted", false)
      .gte("updated_at", todayRange.start.toISOString())
      .lt("updated_at", todayRange.end.toISOString())

    const todayUnremittedAmount = (todayRides || []).reduce(
      (sum, ride) => sum + Number(ride.platform_fee || 0),
      0
    )
    const totalDueNow = totalOutstanding + todayUnremittedAmount
    const now = Date.now()
    const millisecondsUntilTodayDue = Math.max(todayRange.end.getTime() - now, 0)

    return NextResponse.json({
      blocked,
      reason: blocked
        ? "Please settle outstanding platform fees before accepting new rides."
        : null,
      currentSettlement: summarizeSettlement(settlement),
      todaySettlement: summarizeSettlement(todaySettlement),
      todayRemittance: {
        totalDue: todayUnremittedAmount,
        ridesDue: todayRides?.length || 0,
        dueAt: todayRange.end.toISOString(),
        millisecondsRemaining: millisecondsUntilTodayDue,
        isOverdue: millisecondsUntilTodayDue <= 0 && todayUnremittedAmount > 0,
      },
      outstandingSettlements: outstanding,
      totalOutstanding,
      totalDueNow,
    })
  } catch (error) {
    console.error("[SettlementStatus] error:", error)
    return NextResponse.json(
      { error: "Failed to fetch settlement status" },
      { status: 500 }
    )
  }
}
