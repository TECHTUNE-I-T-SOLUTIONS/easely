import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import {
  getDateRangeForOffset,
  upsertSettlementForDate,
  updateOverdueSettlements,
  getOutstandingSettlements,
} from "@/lib/driver-settlement"

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
      return NextResponse.json({ error: "Driver profile not found" }, { status: 404 })
    }

    let payload: { date?: string; returnUrl?: string } = {}
    try {
      payload = (await request.json()) || {}
    } catch {
      payload = {}
    }

    const requestedDate = payload?.date
    const mobileReturnUrl = typeof payload?.returnUrl === "string" ? payload.returnUrl : null

    await updateOverdueSettlements(driver.id)

    let settlementIds: string[] = []
    let amount = 0

    if (requestedDate) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/
      if (!dateRegex.test(requestedDate)) {
        return NextResponse.json(
          { error: "Invalid date format. Use YYYY-MM-DD" },
          { status: 400 }
        )
      }

      const settlement = await upsertSettlementForDate(driver.id, requestedDate)
      const settlementAmount = Number(settlement?.total_platform_fees || 0)

      if (settlement?.settlement_status === "paid" || settlementAmount <= 0) {
        return NextResponse.json({ error: "No settlement due for selected date" }, { status: 400 })
      }

      settlementIds = [settlement.id]
      amount = settlementAmount
    } else {
      const { dateString } = getDateRangeForOffset(-1)
      await upsertSettlementForDate(driver.id, dateString)

      const outstanding = await getOutstandingSettlements(driver.id)
      settlementIds = outstanding.map((entry) => entry.id)
      amount = outstanding.reduce(
        (sum, entry) => sum + Number(entry.total_platform_fees || 0),
        0
      )

      if (!settlementIds.length || amount <= 0) {
        return NextResponse.json({ error: "No settlement due" }, { status: 400 })
      }
    }

    const { data: user } = await supabaseAdmin!
      .from("users")
      .select("email")
      .eq("id", session.user.id)
      .single()

    if (!user?.email) {
      return NextResponse.json({ error: "User email not found" }, { status: 404 })
    }

    const paystackUrl = "https://api.paystack.co/transaction/initialize"

    const requestOrigin = new URL(request.url).origin
    const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL
    const callbackOrigin =
      configuredOrigin && !configuredOrigin.includes("localhost")
        ? configuredOrigin
        : requestOrigin
    const callbackUrl = `${callbackOrigin}/api/driver/payment-callback`

    const paystackResponse = await fetch(paystackUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: user.email,
        amount: Math.round(amount * 100),
        metadata: {
          driverId: driver.id,
          settlementIds,
          type: "settlement_payment",
          returnUrl: mobileReturnUrl,
        },
        callback_url: callbackUrl || undefined,
      }),
    })

    const paystackData = await paystackResponse.json()

    if (!paystackData.status) {
      throw new Error(paystackData.message || "Paystack initialization failed")
    }

    // Save payment record to driver_payments table
    const { data: payment, error: paymentError } = await supabaseAdmin!
      .from("driver_payments")
      .insert({
        driver_id: driver.id,
        settlement_id: settlementIds.length === 1 ? settlementIds[0] : null,
        amount,
        payment_method: "paystack",
        payment_reference: paystackData.data.reference,
        status: "pending",
        payment_date: new Date().toISOString(),
        metadata: {
          paystack_access_code: paystackData.data.access_code,
          settlement_ids: settlementIds,
          return_url: mobileReturnUrl,
        },
      })
      .select()
      .single()

    if (paymentError) {
      throw paymentError
    }

    // Get user's wallet
    const { data: wallet } = await supabaseAdmin!
      .from("wallets")
      .select("id")
      .eq("user_id", session.user.id)
      .single()

    // Save transaction record to transactions table for logging
    if (wallet?.id) {
      const { error: transactionError } = await supabaseAdmin!
        .from("transactions")
        .insert({
          wallet_id: wallet.id,
          amount,
          transaction_type: "debit",
          reference: paystackData.data.reference,
          source: "payout",
          status: "pending",
          description: `Settlement payment for ${requestedDate || 'outstanding settlements'}`,
        })

      if (transactionError) {
        console.warn("[SettlementInitiate] Transaction logging failed:", transactionError)
        // Don't fail the payment if transaction logging fails
      }
    }

    return NextResponse.json({
      authUrl: paystackData.data.authorization_url,
      accessCode: paystackData.data.access_code,
      reference: paystackData.data.reference,
      paymentId: payment.id,
      amount,
      settlementIds,
      requestedDate: requestedDate || null,
      success: true,
    })
  } catch (error) {
    console.error("[SettlementInitiate] error:", error)
    return NextResponse.json({ error: "Failed to initiate payment" }, { status: 500 })
  }
}
