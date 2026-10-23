import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import {
  getDateRangeForOffset,
  upsertSettlementForDate,
  getDriverRemittanceSummary,
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

    const { dateString } = getDateRangeForOffset(-1)
    
    let settlement = null
    let summary = { blocked: false, overdueTotal: 0, todayTotal: 0, grandTotal: 0, todayRemittance: null, outstandingSettlements: [] }
    
    try {
      settlement = await upsertSettlementForDate(driver.id, dateString)
      summary = await getDriverRemittanceSummary(driver.id)
    } catch (settlementError) {
      console.error("[SettlementStatus] Settlement operations failed:", settlementError)
      // Return partial data rather than failing completely
    }

    return NextResponse.json({
      blocked: summary.blocked,
      reason: summary.blocked
        ? "Please settle outstanding platform fees before accepting new rides."
        : null,
      currentSettlement: settlement ? summarizeSettlement(settlement) : null,
      todaySettlement: summary.todaySettlement ? summarizeSettlement(summary.todaySettlement) : null,
      todayRemittance: summary.todayRemittance,
      outstandingSettlements: summary.outstandingSettlements,
      totalOverdue: summary.overdueTotal,
      totalOutstanding: summary.overdueTotal,
      totalTodayDue: summary.todayTotal,
      totalDueNow: summary.grandTotal,
      remittanceSummary: {
        overdueTotal: summary.overdueTotal,
        todayTotal: summary.todayTotal,
        grandTotal: summary.grandTotal,
        serverTime: new Date().toISOString(),
        timezone: "Africa/Lagos",
      },
    })
  } catch (error) {
    console.error("[SettlementStatus] error:", error)
    return NextResponse.json(
      { error: "Failed to fetch settlement status" },
      { status: 500 }
    )
  }
}
