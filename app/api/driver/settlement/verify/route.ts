import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { verifyDriverPaymentReference } from "@/lib/driver-settlement"

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id || session.user.role !== "driver") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { reference } = await request.json()

    if (!reference) {
      return NextResponse.json({ error: "Reference required" }, { status: 400 })
    }

    const { data: driver } = await supabaseAdmin!
      .from("drivers")
      .select("id")
      .eq("user_id", session.user.id)
      .single()

    if (!driver?.id) {
      return NextResponse.json({ error: "Driver not found" }, { status: 404 })
    }

    const verification = await verifyDriverPaymentReference(reference, driver.id)

    if (!verification.found) {
      return NextResponse.json({ error: "Payment not found", paymentStatus: "pending" }, { status: 404 })
    }

    const transaction = verification.transaction
    const paymentStatus = verification.paymentStatus
    const normalizedPaymentStatus = verification.normalizedStatus

    if (normalizedPaymentStatus === "completed") {
      // Check if driver has remaining unpaid settlements
      const { data: unpaidSettlements } = await supabaseAdmin!
        .from("driver_daily_settlement")
        .select("id")
        .eq("driver_id", driver.id)
        .in("settlement_status", ["pending", "overdue"])

      // If no more unpaid, set driver online
      if (!unpaidSettlements?.length) {
        await supabaseAdmin!
          .from("drivers")
          .update({ availability_status: "online", updated_at: new Date().toISOString() })
          .eq("id", driver.id)
      }

      // Add notification for successful payment
      await supabaseAdmin!
        .from("notifications")
        .insert({
          user_id: session.user.id,
          title: "Payment Successful",
          message: `Your settlement payment of ₦${(transaction.amount / 100).toLocaleString("en-US")} has been confirmed`,
          type: "payment",
          channel: "in_app",
          related_table: "driver_payments",
          related_id: driver.id,
          data: {
            reference,
            amount: transaction.amount / 100,
            status: "success",
          },
        })
    } else if (normalizedPaymentStatus === "failed") {
      // Add notification for failed payment
      await supabaseAdmin!
        .from("notifications")
        .insert({
          user_id: session.user.id,
          title: "Payment Failed",
          message: `Your settlement payment could not be processed. Please try again.`,
          type: "payment",
          channel: "in_app",
          related_table: "driver_payments",
          related_id: driver.id,
          data: {
            reference,
            amount: transaction.amount / 100,
            status: "failed",
          },
        })
    }

    return NextResponse.json({
      success: normalizedPaymentStatus === "completed",
      message: paymentStatus === "success" ? "Payment verified and settlement updated" : `Payment status: ${paymentStatus}`,
      paymentStatus,
      transaction,
    })
  } catch (error) {
    console.error("[SettlementVerify] error:", error)
    return NextResponse.json({ error: "Failed to verify payment" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id || session.user.role !== "driver") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const reference = searchParams.get("reference")

    if (!reference) {
      return NextResponse.json({ error: "Reference required" }, { status: 400 })
    }

    const { data: driver } = await supabaseAdmin!
      .from("drivers")
      .select("id")
      .eq("user_id", session.user.id)
      .single()

    if (!driver?.id) {
      return NextResponse.json({ error: "Driver not found" }, { status: 404 })
    }

    // Check local payment records
    const { data: payment } = await supabaseAdmin!
      .from("driver_payments")
      .select("*")
      .eq("payment_reference", reference)
      .eq("driver_id", driver.id)
      .single()

    // If already verified as success on second check, return immediately
    if (payment?.status === "completed") {
      return NextResponse.json({
        success: true,
        paymentStatus: "success",
        payment,
        verified: true,
      })
    }

    const verification = await verifyDriverPaymentReference(reference, driver.id)

    if (!verification.found) {
      return NextResponse.json(
        { success: false, paymentStatus: "pending", verified: false },
        { status: 404 }
      )
    }

    const transaction = verification.transaction
    const paymentStatus = verification.paymentStatus
    const normalizedPaymentStatus = verification.normalizedStatus

    if (payment) {
      // Add notification if status changed to success
      if (normalizedPaymentStatus === "completed" && payment.status !== "completed") {
        await supabaseAdmin!
          .from("notifications")
          .insert({
            user_id: session.user.id,
            title: "Payment Successful",
            message: `Your settlement payment of ₦${(transaction.amount / 100).toLocaleString("en-US")} has been confirmed`,
            type: "payment",
            channel: "in_app",
            related_table: "driver_payments",
            related_id: payment.id,
            data: {
              reference,
              amount: transaction.amount / 100,
              status: "success",
            },
          })
      }
    }

    return NextResponse.json({
      success: normalizedPaymentStatus === "completed",
      paymentStatus,
      payment,
      transaction,
      verified: normalizedPaymentStatus === "completed",
    })
  } catch (error) {
    console.error("[SettlementVerifyGET] error:", error)
    return NextResponse.json(
      { success: false, paymentStatus: "error" },
      { status: 500 }
    )
  }
}
