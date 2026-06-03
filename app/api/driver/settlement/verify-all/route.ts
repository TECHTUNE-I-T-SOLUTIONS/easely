import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function POST(request: NextRequest) {
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
      return NextResponse.json({ error: "Driver not found" }, { status: 404 })
    }

    // Get all pending payments for this driver
    const { data: pendingPayments, error: paymentsError } = await supabaseAdmin!
      .from("driver_payments")
      .select("*")
      .eq("driver_id", driver.id)
      .eq("status", "pending")

    if (paymentsError) {
      throw paymentsError
    }

    if (!pendingPayments?.length) {
      return NextResponse.json({
        success: true,
        message: "No pending payments to verify",
        verified: 0,
        updated: 0,
      })
    }

    console.log(`[VerifyAll] Found ${pendingPayments.length} pending payments for driver ${driver.id}`)

    let verifiedCount = 0
    let updatedCount = 0
    const results: any[] = []

    for (const payment of pendingPayments) {
      try {
        console.log(`[VerifyAll] Verifying payment ${payment.id} with reference ${payment.payment_reference}`)

        // Verify with Paystack
        const verifyUrl = `https://api.paystack.co/transaction/verify/${payment.payment_reference}`
        const verifyResponse = await fetch(verifyUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          },
        })

        const verifyData = await verifyResponse.json()

        if (!verifyData.status) {
          console.log(`[VerifyAll] Payment ${payment.id} not found in Paystack`)
          results.push({
            paymentId: payment.id,
            reference: payment.payment_reference,
            status: "not_found",
          })
          continue
        }

        const transaction = verifyData.data
        const paystackStatus = transaction.status

        console.log(`[VerifyAll] Paystack status for ${payment.payment_reference}: ${paystackStatus}`)

        verifiedCount++

        // Normalize status
        const normalizedStatus =
          paystackStatus === "success"
            ? "completed"
            : paystackStatus === "failed" || paystackStatus === "abandoned" || paystackStatus === "cancelled"
              ? "failed"
              : "pending"

        // Update payment status
        const updatePayload: any = { status: normalizedStatus, updated_at: new Date().toISOString() }
        if (normalizedStatus === "completed") {
          updatePayload.confirmed_at = new Date().toISOString()
        }

        const { error: updateError } = await supabaseAdmin!
          .from("driver_payments")
          .update(updatePayload)
          .eq("id", payment.id)

        if (updateError) {
          console.error(`[VerifyAll] Failed to update payment ${payment.id}:`, updateError)
          results.push({
            paymentId: payment.id,
            reference: payment.payment_reference,
            status: "update_failed",
            error: updateError.message,
          })
          continue
        }

        updatedCount++

        // Update transaction status
        await supabaseAdmin!
          .from("transactions")
          .update({ 
            status: normalizedStatus === "completed" ? "completed" : normalizedStatus === "failed" ? "failed" : "pending",
            updated_at: new Date().toISOString() 
          })
          .eq("reference", payment.payment_reference)

        // If payment successful, update settlement status
        if (normalizedStatus === "completed") {
          const settlementIds = (payment.metadata as any)?.settlement_ids || []
          if (payment.settlement_id) {
            settlementIds.push(payment.settlement_id)
          }

          if (settlementIds.length > 0) {
            console.log(`[VerifyAll] Updating settlements: ${settlementIds.join(", ")}`)
            
            await supabaseAdmin!
              .from("driver_daily_settlement")
              .update({
                settlement_status: "paid",
                paid_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .in("id", settlementIds)
              .eq("driver_id", driver.id)
          }
        }

        results.push({
          paymentId: payment.id,
          reference: payment.payment_reference,
          status: normalizedStatus,
          amount: payment.amount,
        })
      } catch (error: any) {
        console.error(`[VerifyAll] Error verifying payment ${payment.id}:`, error)
        results.push({
          paymentId: payment.id,
          reference: payment.payment_reference,
          status: "error",
          error: error.message,
        })
      }
    }

    // Check remaining overdue settlements. Same-day pending remittance should not
    // affect availability until it passes its due time.
    const { data: stillOutstanding } = await supabaseAdmin!
      .from("driver_daily_settlement")
      .select("id, payment_due_date, settlement_status")
      .eq("driver_id", driver.id)
      .in("settlement_status", ["pending", "overdue"])

    const overdueSettlements = (stillOutstanding || []).filter((settlement: any) =>
      settlement.settlement_status === "overdue" ||
      (settlement.payment_due_date && new Date(settlement.payment_due_date) <= new Date())
    )

    console.log(`[VerifyAll] Still overdue: ${overdueSettlements.length} settlements`)

    return NextResponse.json({
      success: true,
      message: `Verified ${verifiedCount} payments, updated ${updatedCount} records`,
      verified: verifiedCount,
      updated: updatedCount,
      results,
      outstandingSettlements: overdueSettlements.length,
    })
  } catch (error) {
    console.error("[VerifyAll] error:", error)
    return NextResponse.json({ error: "Failed to verify payments" }, { status: 500 })
  }
}
