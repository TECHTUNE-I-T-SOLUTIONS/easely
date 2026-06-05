import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { verifyDriverPaymentReference } from "@/lib/driver-settlement"

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id || session.user.role !== "driver") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get("limit") || "50")
    const offset = parseInt(searchParams.get("offset") || "0")
    const status = searchParams.get("status") // Filter by status: pending, completed, failed

    const { data: wallet } = await supabaseAdmin!
      .from("wallets")
      .select("id")
      .eq("user_id", session.user.id)
      .single()

    if (!wallet?.id) {
      return NextResponse.json({ success: true, payments: [], statistics: {
        total_payments: 0,
        completed: 0,
        pending: 0,
        failed: 0,
        total_amount_paid: 0,
        total_amount_pending: 0,
      }, total: 0, limit, offset })
    }

    const { data: driver } = await supabaseAdmin!
      .from("drivers")
      .select("id")
      .eq("user_id", session.user.id)
      .single()

    if (!driver?.id) {
      return NextResponse.json({ error: "Driver not found" }, { status: 404 })
    }

    const { data: pendingPayments } = await supabaseAdmin!
      .from("driver_payments")
      .select("payment_reference")
      .eq("driver_id", driver.id)
      .eq("status", "pending")
      .order("payment_date", { ascending: false })
      .limit(10)

    for (const payment of pendingPayments || []) {
      if (!payment.payment_reference) continue
      try {
        await verifyDriverPaymentReference(payment.payment_reference, driver.id)
      } catch (verifyError) {
        console.warn("[PaymentHistory] Pending payment reverification failed:", payment.payment_reference, verifyError)
      }
    }

    const { data: allPayments, error: paymentsError } = await supabaseAdmin!
      .from("driver_payments")
      .select("id, amount, payment_method, payment_reference, status, payment_date, confirmed_at, created_at, metadata")
      .eq("driver_id", driver.id)
      .order("payment_date", { ascending: false })

    if (paymentsError) {
      throw paymentsError
    }

    const paymentList = allPayments || []
    const normalized = paymentList.map((payment) => {
      const normalizedStatus =
        payment.status === "completed"
          ? "completed"
          : payment.status === "failed"
            ? "failed"
            : "pending"

      return {
        id: payment.id,
        amount: Number(payment.amount || 0),
        payment_method: payment.payment_method || "paystack",
        payment_reference: payment.payment_reference || payment.id,
        status: normalizedStatus,
        payment_date: payment.payment_date || payment.created_at,
        confirmed_at: payment.confirmed_at || null,
        created_at: payment.created_at || payment.payment_date,
        description: "Settlement payment",
      }
    })

    const filtered = status ? normalized.filter((tx) => tx.status === status) : normalized
    const payments = filtered.slice(offset, offset + limit)

    const statistics = {
      total_payments: normalized.length,
      completed: normalized.filter((p) => p.status === "completed").length,
      pending: normalized.filter((p) => p.status === "pending").length,
      failed: normalized.filter((p) => p.status === "failed").length,
      total_amount_paid: normalized
        .filter((p) => p.status === "completed")
        .reduce((sum, p) => sum + Number(p.amount || 0), 0),
      total_amount_pending: normalized
        .filter((p) => p.status === "pending")
        .reduce((sum, p) => sum + Number(p.amount || 0), 0),
    }

    return NextResponse.json({
      success: true,
      payments: payments || [],
      statistics,
      total: filtered.length,
      limit,
      offset,
    })
  } catch (error) {
    console.error("[PaymentHistory] error:", error)
    return NextResponse.json({ error: "Failed to fetch payment history" }, { status: 500 })
  }
}
