import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"
import { getDriverRemittanceSummary, verifyDriverPaymentReference } from "@/lib/driver-settlement"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const driverIdParam = searchParams.get("driver_id")

    if (!driverIdParam) {
      return NextResponse.json({ error: "Driver ID required" }, { status: 400 })
    }

    const { data: driverRecord, error: driverError } = await supabase
      .from("drivers")
      .select("id, user_id")
      .or(`id.eq.${driverIdParam},user_id.eq.${driverIdParam}`)
      .maybeSingle()

    if (driverError) throw driverError

    const resolvedDriverId = driverRecord?.id || driverIdParam

    const { data: settlements, error } = await supabase
      .from("driver_daily_settlement")
      .select(
        `
        id,
        settlement_date,
        total_rides,
        total_platform_fees,
        settlement_status,
        payment_due_date,
        paid_at
      `
      )
      .eq("driver_id", resolvedDriverId)
      .order("settlement_date", { ascending: false })
      .limit(30)

    if (error) throw error

    const { data: payments, error: paymentError } = await supabase
      .from("driver_payments")
      .select("*")
      .eq("driver_id", resolvedDriverId)
      .order("payment_date", { ascending: false })
      .limit(20)

    if (paymentError) throw paymentError

    for (const payment of payments || []) {
      if (payment.status !== "pending" || !payment.payment_reference) continue
      try {
        await verifyDriverPaymentReference(payment.payment_reference, resolvedDriverId)
      } catch (verifyError) {
        console.warn("[PaymentStatus] Pending payment reverification failed:", payment.payment_reference, verifyError)
      }
    }

    const { data: refreshedPayments, error: refreshedPaymentError } = await supabase
      .from("driver_payments")
      .select("*")
      .eq("driver_id", resolvedDriverId)
      .order("payment_date", { ascending: false })
      .limit(20)

    if (refreshedPaymentError) throw refreshedPaymentError

    const remittanceSummary = await getDriverRemittanceSummary(resolvedDriverId)

    return NextResponse.json({
      settlements,
      payments: refreshedPayments || payments,
      totalPending: remittanceSummary.grandTotal,
      remittanceSummary,
      success: true,
    })
  } catch (error) {
    console.error("Error fetching payment status:", error)
    return NextResponse.json({ error: "Failed to fetch payment status" }, { status: 500 })
  }
}
