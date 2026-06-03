import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const { driverId, reason } = await request.json()

    if (!driverId) {
      return NextResponse.json(
        { error: "Driver ID required" },
        { status: 400 }
      )
    }

    // Lock driver availability
    const { data: driver, error } = await supabase
      .from("drivers")
      .update({
        is_available: false,
        availability_locked_at: new Date().toISOString(),
        availability_lock_reason: reason || "unpaid_settlement",
      })
      .eq("id", driverId)
      .select()
      .single()

    if (error) throw error

    // Create notification for driver
    const { data: driverData } = await supabase
      .from("drivers")
      .select("user_id")
      .eq("id", driverId)
      .single()

    if (driverData?.user_id) {
      await supabase.from("notifications").insert({
        user_id: driverData.user_id,
        title: "Driver Status Locked",
        message:
          "Your driver status has been disabled due to unpaid settlement fees. Please complete your payment to restore access.",
        type: "admin",
        channel: "in_app",
        data: {
          event_type: "availability_locked",
          driverId,
          reason,
        },
      })
    }

    return NextResponse.json({
      success: true,
      message: "Driver availability locked",
      driver,
    })
  } catch (error) {
    console.error("Error locking driver availability:", error)
    return NextResponse.json(
      { error: "Failed to lock driver availability" },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { driverId } = await request.json()

    if (!driverId) {
      return NextResponse.json(
        { error: "Driver ID required" },
        { status: 400 }
      )
    }

    // Only overdue settlements should prevent unlocking. Current-day pending
    // remittance is allowed until midnight.
    const { data: unpaidSettlements } = await supabase
      .from("driver_daily_settlement")
      .select("id, payment_due_date, settlement_status")
      .eq("driver_id", driverId)
      .in("settlement_status", ["pending", "overdue"])

    const overdueSettlements = (unpaidSettlements || []).filter((settlement: any) =>
      settlement.settlement_status === "overdue" ||
      (settlement.payment_due_date && new Date(settlement.payment_due_date) <= new Date())
    )

    if (overdueSettlements.length) {
      return NextResponse.json(
        { error: "Driver has overdue settlements", unpaidCount: overdueSettlements.length },
        { status: 400 }
      )
    }

    // Unlock driver availability
    const { data: driver, error } = await supabase
      .from("drivers")
      .update({
        is_available: true,
        availability_locked_at: null,
        availability_lock_reason: null,
      })
      .eq("id", driverId)
      .select()
      .single()

    if (error) throw error

    // Create notification for driver
    const { data: driverData } = await supabase
      .from("drivers")
      .select("user_id")
      .eq("id", driverId)
      .single()

    if (driverData?.user_id) {
      await supabase.from("notifications").insert({
        user_id: driverData.user_id,
        title: "Driver Status Restored",
        message: "Your driver status has been restored. You can now accept rides.",
        type: "admin",
        channel: "in_app",
        data: {
          event_type: "availability_restored",
        },
      })
    }

    return NextResponse.json({
      success: true,
      message: "Driver availability unlocked",
      driver,
    })
  } catch (error) {
    console.error("Error unlocking driver availability:", error)
    return NextResponse.json(
      { error: "Failed to unlock driver availability" },
      { status: 500 }
    )
  }
}
