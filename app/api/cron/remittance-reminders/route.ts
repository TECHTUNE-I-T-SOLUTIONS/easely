import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import {
  getDateRangeForOffset,
  getOutstandingSettlements,
  summarizeSettlement,
  updateOverdueSettlements,
  upsertSettlementForDate,
} from "@/lib/driver-settlement"
import { sendPushNotification } from "@/lib/push-service"

export async function GET(request: NextRequest) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json({ error: "Database client not configured" }, { status: 500 })
    }

    const { searchParams } = new URL(request.url)
    const token = searchParams.get("token")
    const configuredToken = process.env.CRON_PUBLIC_TOKEN
    if (configuredToken && token !== configuredToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: drivers, error } = await supabaseAdmin
      .from("drivers")
      .select("id, user_id")
      .eq("verified", true)

    if (error) throw error

    const { dateString } = getDateRangeForOffset(0)
    let notified = 0
    let blocked = 0

    for (const driver of drivers || []) {
      await upsertSettlementForDate(driver.id, dateString)
      await updateOverdueSettlements(driver.id)

      const outstanding = await getOutstandingSettlements(driver.id)
      const todaySettlement = await upsertSettlementForDate(driver.id, dateString)
      const due = Number(todaySettlement.total_platform_fees || 0)
      const overdueDue = outstanding.reduce((sum, item) => sum + Number(item.total_platform_fees || 0), 0)
      const totalDue = due + overdueDue

      if (totalDue <= 0) continue

      const dueDate = new Date(todaySettlement.payment_due_date)
      const hoursRemaining = Math.max(0, Math.ceil((dueDate.getTime() - Date.now()) / 3600000))
      const isBlocked = overdueDue > 0 || todaySettlement.settlement_status === "overdue"

      if (isBlocked) {
        blocked += 1
        await supabaseAdmin
          .from("drivers")
          .update({ availability_status: "offline", updated_at: new Date().toISOString() })
          .eq("id", driver.id)
      }

      await supabaseAdmin.from("notifications").insert({
        user_id: driver.user_id,
        title: isBlocked ? "Remittance Due" : "Remittance Reminder",
        message: isBlocked
          ? `Remittance of ₦${totalDue.toLocaleString("en-US")} is due. Pay before accepting new rides.`
          : `Today's remittance is ₦${totalDue.toLocaleString("en-US")}. Due in about ${hoursRemaining} hour(s).`,
        type: "payment",
        channel: "in_app",
        deep_link: "/driver/wallet",
        action_url: "/driver/wallet",
        metadata: {
          event_type: isBlocked ? "remittance_due" : "remittance_reminder",
          totalDue,
          hoursRemaining,
          blocked: isBlocked,
          settlement: summarizeSettlement(todaySettlement),
          overdueSettlements: outstanding,
        },
      })

      await sendPushNotification([driver.user_id], {
        title: isBlocked ? "Remittance Due" : "Remittance Reminder",
        body: isBlocked
          ? `₦${totalDue.toLocaleString("en-US")} is due. Pay to accept rides.`
          : `₦${totalDue.toLocaleString("en-US")} due in about ${hoursRemaining} hour(s).`,
        type: isBlocked ? "remittance_due" : "remittance_reminder",
        data: {
          deeplink: "/driver/wallet",
          totalDue,
          hoursRemaining,
          blocked: isBlocked,
        },
      })

      notified += 1
    }

    return NextResponse.json({ success: true, checked: drivers?.length || 0, notified, blocked })
  } catch (error) {
    console.error("[RemittanceCron] error:", error)
    return NextResponse.json({ error: "Failed to send remittance reminders" }, { status: 500 })
  }
}
