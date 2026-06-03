import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"

async function markPaidSettlementRides(driverId: string, settlementIds: string[] = [], rideIds: string[] = [], paymentId?: string | null) {
  const uniqueRideIds = Array.from(new Set((rideIds || []).filter(Boolean)))

  if (uniqueRideIds.length > 0) {
    await supabaseAdmin!
      .from("rides")
      .update({
        remitted: true,
        remitted_at: new Date().toISOString(),
        remitted_by_payment_id: paymentId || null,
      })
      .in("id", uniqueRideIds)
      .eq("driver_id", driverId)
  }

  for (const settlementId of settlementIds || []) {
    const { data: settlement } = await supabaseAdmin!
      .from("driver_daily_settlement")
      .select("id, settlement_date")
      .eq("id", settlementId)
      .eq("driver_id", driverId)
      .maybeSingle()

    if (!settlement?.settlement_date) continue

    const start = new Date(`${settlement.settlement_date}T00:00:00.000Z`)
    const end = new Date(start)
    end.setUTCDate(start.getUTCDate() + 1)

    if (uniqueRideIds.length === 0) {
      await supabaseAdmin!
        .from("rides")
        .update({
          remitted: true,
          remitted_at: new Date().toISOString(),
          remitted_by_payment_id: paymentId || null,
        })
        .eq("driver_id", driverId)
        .eq("remitted", false)
        .in("status", ["accepted", "in_progress", "completed"])
        .gte("updated_at", start.toISOString())
        .lt("updated_at", end.toISOString())
    }

    const { data: remaining } = await supabaseAdmin!
      .from("rides")
      .select("id")
      .eq("driver_id", driverId)
      .eq("remitted", false)
      .in("status", ["accepted", "in_progress", "completed"])
      .gte("updated_at", start.toISOString())
      .lt("updated_at", end.toISOString())
      .limit(1)

    if (!remaining?.length) {
      await supabaseAdmin!
        .from("driver_daily_settlement")
        .update({
          settlement_status: "paid",
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", settlementId)
    }
  }
}

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

    const verifyUrl = `https://api.paystack.co/transaction/verify/${reference}`

    const verifyResponse = await fetch(verifyUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    })

    const verifyData = await verifyResponse.json()

    if (!verifyData.status) {
      return NextResponse.json({ error: "Payment not found", paymentStatus: "pending" }, { status: 404 })
    }

    const transaction = verifyData.data
    const { settlementIds, rideIds } = transaction.metadata || {}

    // Normalize Paystack status to our DB status values
    const paymentStatus = transaction.status
    const normalizedPaymentStatus =
      paymentStatus === "success"
        ? "completed"
        : paymentStatus === "failed" || paymentStatus === "abandoned" || paymentStatus === "cancelled"
          ? "failed"
          : "pending"
    const updatePayload: any = { status: normalizedPaymentStatus }
    if (normalizedPaymentStatus === "completed") {
      updatePayload.confirmed_at = new Date().toISOString()
    }

    await supabaseAdmin!
      .from("driver_payments")
      .update(updatePayload)
      .eq("payment_reference", reference)
      .eq("driver_id", driver.id)

    const { data: localPayment } = await supabaseAdmin!
      .from("driver_payments")
      .select("id")
      .eq("payment_reference", reference)
      .eq("driver_id", driver.id)
      .maybeSingle()

    // Update transaction status in transactions table
    const { data: transactions } = await supabaseAdmin!
      .from("transactions")
      .select("id")
      .eq("reference", reference)

    if (transactions?.length) {
      const transactionStatus = normalizedPaymentStatus === "completed" ? "completed" : normalizedPaymentStatus === "failed" ? "failed" : "pending"
      await supabaseAdmin!
        .from("transactions")
        .update({ status: transactionStatus, updated_at: new Date().toISOString() })
        .eq("reference", reference)
    }

    // If payment successful, mark paid ride remittance and close settlement only when fully remitted.
    if (normalizedPaymentStatus === "completed" && (Array.isArray(settlementIds) || Array.isArray(rideIds))) {
      await markPaidSettlementRides(driver.id, settlementIds || [], rideIds || [], localPayment?.id || null)

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

    // Verify with Paystack
    const verifyUrl = `https://api.paystack.co/transaction/verify/${reference}`
    const verifyResponse = await fetch(verifyUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    })

    const verifyData = await verifyResponse.json()

    if (!verifyData.status) {
      return NextResponse.json(
        { success: false, paymentStatus: "pending", verified: false },
        { status: 404 }
      )
    }

    const transaction = verifyData.data
    const paymentStatus = transaction.status
    const normalizedPaymentStatus =
      paymentStatus === "success"
        ? "completed"
        : paymentStatus === "failed" || paymentStatus === "abandoned" || paymentStatus === "cancelled"
          ? "failed"
          : "pending"

    // Update local payment record with current Paystack status
    if (payment) {
      await supabaseAdmin!
        .from("driver_payments")
        .update({
          status: normalizedPaymentStatus,
          ...(normalizedPaymentStatus === "completed" ? { confirmed_at: new Date().toISOString() } : {}),
        })
        .eq("id", payment.id)

      // Update transaction status
      const transactionStatus = normalizedPaymentStatus === "completed" ? "completed" : normalizedPaymentStatus === "failed" ? "failed" : "pending"
      await supabaseAdmin!
        .from("transactions")
        .update({ status: transactionStatus, updated_at: new Date().toISOString() })
        .eq("reference", reference)

      const metadata = (payment.metadata as any) || transaction.metadata || {}
      if (normalizedPaymentStatus === "completed") {
        await markPaidSettlementRides(
          driver.id,
          metadata.settlement_ids || metadata.settlementIds || [],
          metadata.ride_ids || metadata.rideIds || [],
          payment.id
        )
      }

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
