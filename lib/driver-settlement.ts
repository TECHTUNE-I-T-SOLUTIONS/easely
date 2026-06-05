import { supabaseAdmin } from "@/lib/supabase"

export type SettlementStatus = "pending" | "paid" | "overdue"

export interface DriverSettlementSummary {
  settlementDate: string
  totalRides: number
  totalFareAmount: number
  totalPlatformFees: number
  totalDriverEarnings: number
  status: SettlementStatus
  paymentDueDate: string
}

export const PLATFORM_FEE_RATE = 0.15
export const LAGOS_TIME_OFFSET_MS = 60 * 60 * 1000

export function getLagosDateString(date = new Date()) {
  return new Date(date.getTime() + LAGOS_TIME_OFFSET_MS).toISOString().slice(0, 10)
}

export function getLagosDayRange(dateString: string) {
  const lagosMidnightAsUtc = new Date(`${dateString}T00:00:00.000Z`)
  const start = new Date(lagosMidnightAsUtc.getTime() - LAGOS_TIME_OFFSET_MS)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start, end, dateString, dueDate: end }
}

export function getDateRangeForOffset(offsetDays: number) {
  const todayInLagos = new Date(`${getLagosDateString()}T00:00:00.000Z`)
  todayInLagos.setUTCDate(todayInLagos.getUTCDate() + offsetDays)
  return getLagosDayRange(todayInLagos.toISOString().slice(0, 10))
}

export function normalizePaystackStatus(status?: string | null) {
  if (status === "success") return "completed"
  if (status === "failed" || status === "abandoned" || status === "cancelled") return "failed"
  return "pending"
}

export async function markPaidSettlementRides(
  driverId: string,
  settlementIds: string[] = [],
  rideIds: string[] = [],
  paymentId?: string | null
) {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client not initialized")
  }

  const uniqueSettlementIds = Array.from(new Set((settlementIds || []).filter(Boolean)))
  const uniqueRideIds = Array.from(new Set((rideIds || []).filter(Boolean)))
  const now = new Date().toISOString()

  if (!uniqueSettlementIds.length && uniqueRideIds.length > 0) {
    await supabaseAdmin
      .from("rides")
      .update({
        remitted: true,
        remitted_at: now,
        remitted_by_payment_id: paymentId || null,
      })
      .in("id", uniqueRideIds)
      .eq("driver_id", driverId)
    return
  }

  for (const settlementId of uniqueSettlementIds) {
    const { data: settlement } = await supabaseAdmin
      .from("driver_daily_settlement")
      .select("id, settlement_date")
      .eq("id", settlementId)
      .eq("driver_id", driverId)
      .maybeSingle()

    if (!settlement?.settlement_date) continue

    const { start, end } = getLagosDayRange(settlement.settlement_date)
    let rideIdsForThisSettlement: string[] = []

    if (uniqueRideIds.length > 0) {
      const { data: matchingRides, error: matchingError } = await supabaseAdmin
        .from("rides")
        .select("id")
        .in("id", uniqueRideIds)
        .eq("driver_id", driverId)
        .in("status", ["accepted", "in_progress", "completed"])
        .gte("updated_at", start.toISOString())
        .lt("updated_at", end.toISOString())

      if (matchingError) throw matchingError
      rideIdsForThisSettlement = (matchingRides || []).map((ride) => ride.id)
    }

    if (rideIdsForThisSettlement.length > 0) {
      await supabaseAdmin
        .from("rides")
        .update({
          remitted: true,
          remitted_at: now,
          remitted_by_payment_id: paymentId || null,
        })
        .in("id", rideIdsForThisSettlement)
        .eq("driver_id", driverId)
    } else {
      await supabaseAdmin
        .from("rides")
        .update({
          remitted: true,
          remitted_at: now,
          remitted_by_payment_id: paymentId || null,
        })
        .eq("driver_id", driverId)
        .eq("remitted", false)
        .in("status", ["accepted", "in_progress", "completed"])
        .gte("updated_at", start.toISOString())
        .lt("updated_at", end.toISOString())
    }

    const { data: remaining, error: remainingError } = await supabaseAdmin
      .from("rides")
      .select("id")
      .eq("driver_id", driverId)
      .eq("remitted", false)
      .in("status", ["accepted", "in_progress", "completed"])
      .gte("updated_at", start.toISOString())
      .lt("updated_at", end.toISOString())
      .limit(1)

    if (remainingError) throw remainingError

    if (!remaining?.length) {
      await supabaseAdmin
        .from("driver_daily_settlement")
        .update({
          settlement_status: "paid",
          paid_at: now,
          updated_at: now,
        })
        .eq("id", settlementId)
        .eq("driver_id", driverId)
    }
  }
}

export async function verifyDriverPaymentReference(reference: string, driverId?: string | null) {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client not initialized")
  }

  const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    },
  })
  const verifyData = await verifyResponse.json()

  if (!verifyData.status) {
    return {
      found: false,
      success: false,
      paymentStatus: "not_found",
      normalizedStatus: "pending",
      transaction: null,
      payment: null,
    }
  }

  const transaction = verifyData.data
  const normalizedStatus = normalizePaystackStatus(transaction.status)
  const updatePayload: any = {
    status: normalizedStatus,
    updated_at: new Date().toISOString(),
  }
  if (normalizedStatus === "completed") {
    updatePayload.confirmed_at = new Date().toISOString()
  }

  let paymentQuery = supabaseAdmin
    .from("driver_payments")
    .update(updatePayload)
    .eq("payment_reference", reference)
    .select()

  if (driverId) paymentQuery = paymentQuery.eq("driver_id", driverId)
  const { data: payments, error: paymentUpdateError } = await paymentQuery

  if (paymentUpdateError) throw paymentUpdateError

  const transactionStatus = normalizedStatus === "completed" ? "completed" : normalizedStatus === "failed" ? "failed" : "pending"
  await supabaseAdmin
    .from("transactions")
    .update({ status: transactionStatus, updated_at: new Date().toISOString() })
    .eq("reference", reference)

  const payment = payments?.[0] || null
  const metadata = (payment?.metadata as any) || transaction.metadata || {}
  const resolvedDriverId = driverId || transaction.metadata?.driverId || payment?.driver_id || null

  if (normalizedStatus === "completed" && resolvedDriverId) {
    await markPaidSettlementRides(
      resolvedDriverId,
      metadata.settlement_ids || metadata.settlementIds || transaction.metadata?.settlementIds || [],
      metadata.ride_ids || metadata.rideIds || transaction.metadata?.rideIds || [],
      payment?.id || null
    )
  }

  return {
    found: true,
    success: normalizedStatus === "completed",
    paymentStatus: transaction.status,
    normalizedStatus,
    transaction,
    payment,
  }
}

export async function upsertSettlementForDate(driverId: string, dateString: string) {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client not initialized")
  }

  const { start: rangeStart, end: rangeEnd } = getLagosDayRange(dateString)

  // Query rides directly - these are rides the driver actually accepted/completed
  const { data: rides, error: ridesError } = await supabaseAdmin
    .from("rides")
    .select("id, fare_amount, platform_fee, driver_earnings, status, updated_at, created_at")
    .eq("driver_id", driverId)
    .in("status", ["accepted", "in_progress", "completed"])
    .gte("updated_at", rangeStart.toISOString())
    .lt("updated_at", rangeEnd.toISOString())

  if (ridesError) {
    throw ridesError
  }

  let totalRides = 0
  let totalFareAmount = 0
  let totalPlatformFees = 0
  let totalDriverEarnings = 0

  for (const ride of rides || []) {
    totalRides += 1

    const fare = Number(ride.fare_amount ?? 0)
    const platformFee = Number(ride.platform_fee ?? fare * PLATFORM_FEE_RATE)
    const driverEarning = Number(ride.driver_earnings ?? fare - platformFee)

    totalFareAmount += fare
    totalPlatformFees += platformFee
    totalDriverEarnings += driverEarning
  }

  const paymentDueDate = rangeEnd.toISOString()

  // Check for existing settlement to avoid overwriting a paid status
  const { data: existingSettlement, error: existingError } = await supabaseAdmin
    .from("driver_daily_settlement")
    .select("*")
    .eq("driver_id", driverId)
    .eq("settlement_date", dateString)
    .maybeSingle()

  if (existingError) {
    throw existingError
  }

  const computedStatus: SettlementStatus = totalPlatformFees > 0 ? "pending" : "paid"

  // Preserve 'paid' status if already paid; otherwise use computed status
  const settlementStatusToSave: SettlementStatus = existingSettlement
    ? (existingSettlement.settlement_status === "paid" ? "paid" : computedStatus)
    : computedStatus

  if (existingSettlement) {
    const { error: updateError } = await supabaseAdmin
      .from("driver_daily_settlement")
      .update({
        total_rides: totalRides,
        total_fare_amount: totalFareAmount,
        total_platform_fees: totalPlatformFees,
        total_driver_earnings: totalDriverEarnings,
        settlement_status: settlementStatusToSave,
        payment_due_date: paymentDueDate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingSettlement.id)

    if (updateError) throw updateError

    const { data: settlement, error: selError } = await supabaseAdmin
      .from("driver_daily_settlement")
      .select("*")
      .eq("id", existingSettlement.id)
      .single()

    if (selError) throw selError
    return settlement
  }

  // No existing settlement: insert
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("driver_daily_settlement")
    .insert([
      {
        driver_id: driverId,
        settlement_date: dateString,
        total_rides: totalRides,
        total_fare_amount: totalFareAmount,
        total_platform_fees: totalPlatformFees,
        total_driver_earnings: totalDriverEarnings,
        settlement_status: settlementStatusToSave,
        payment_due_date: paymentDueDate,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ])
    .select()
    .single()

  if (insertError) {
    if ((insertError as any).code !== "23505") {
      throw insertError
    }

    const { data: racedSettlement, error: racedFetchError } = await supabaseAdmin
      .from("driver_daily_settlement")
      .select("*")
      .eq("driver_id", driverId)
      .eq("settlement_date", dateString)
      .single()

    if (racedFetchError) throw racedFetchError

    const racedStatusToSave: SettlementStatus =
      racedSettlement.settlement_status === "paid" ? "paid" : settlementStatusToSave

    const { data: updatedAfterRace, error: racedUpdateError } = await supabaseAdmin
      .from("driver_daily_settlement")
      .update({
        total_rides: totalRides,
        total_fare_amount: totalFareAmount,
        total_platform_fees: totalPlatformFees,
        total_driver_earnings: totalDriverEarnings,
        settlement_status: racedStatusToSave,
        payment_due_date: paymentDueDate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", racedSettlement.id)
      .select()
      .single()

    if (racedUpdateError) throw racedUpdateError
    return updatedAfterRace
  }
  return inserted
}

export async function updateOverdueSettlements(driverId: string) {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client not initialized")
  }

  const today = getLagosDateString()

  await supabaseAdmin
    .from("driver_daily_settlement")
    .update({ settlement_status: "overdue", updated_at: new Date().toISOString() })
    .eq("driver_id", driverId)
    .lt("settlement_date", today)
    .eq("settlement_status", "pending")
}

export async function getOutstandingSettlements(driverId: string) {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client not initialized")
  }

  const today = getLagosDateString()

  const { data: settlements, error } = await supabaseAdmin
    .from("driver_daily_settlement")
    .select("id, settlement_date, total_platform_fees, settlement_status, payment_due_date")
    .eq("driver_id", driverId)
    .lt("settlement_date", today)
    .in("settlement_status", ["pending", "overdue"])
    .order("settlement_date", { ascending: false })

  if (error) {
    throw error
  }

  const resolvedSettlements = []
  for (const settlement of settlements || []) {
    const { start, end } = getLagosDayRange(settlement.settlement_date)
    const { data: unpaidRides, error: unpaidRidesError } = await supabaseAdmin
      .from("rides")
      .select("id, platform_fee")
      .eq("driver_id", driverId)
      .eq("remitted", false)
      .in("status", ["accepted", "in_progress", "completed"])
      .gte("updated_at", start.toISOString())
      .lt("updated_at", end.toISOString())

    if (unpaidRidesError) {
      throw unpaidRidesError
    }

    const outstandingPlatformFees = (unpaidRides || []).reduce(
      (sum, ride) => sum + Number(ride.platform_fee || 0),
      0
    )

    if (outstandingPlatformFees <= 0) {
      await supabaseAdmin
        .from("driver_daily_settlement")
        .update({
          settlement_status: "paid",
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", settlement.id)
        .eq("driver_id", driverId)
      continue
    }

    resolvedSettlements.push({
      ...settlement,
      total_platform_fees: outstandingPlatformFees,
      outstanding_platform_fees: outstandingPlatformFees,
      unpaid_ride_count: unpaidRides?.length || 0,
    })
  }

  return resolvedSettlements
}

export async function getDriverRemittanceSummary(driverId: string) {
  const todayRange = getDateRangeForOffset(0)
  await updateOverdueSettlements(driverId)
  const todaySettlement = await upsertSettlementForDate(driverId, todayRange.dateString)
  const outstandingSettlements = await getOutstandingSettlements(driverId)

  const overdueTotal = outstandingSettlements.reduce(
    (sum, entry) => sum + Number(entry.total_platform_fees || 0),
    0
  )

  const { data: todayRides, error: todayRidesError } = await supabaseAdmin
    .from("rides")
    .select("id, platform_fee, remitted")
    .eq("driver_id", driverId)
    .in("status", ["accepted", "in_progress", "completed"])
    .eq("remitted", false)
    .gte("updated_at", todayRange.start.toISOString())
    .lt("updated_at", todayRange.end.toISOString())

  if (todayRidesError) {
    throw todayRidesError
  }

  const todayTotal = (todayRides || []).reduce(
    (sum, ride) => sum + Number(ride.platform_fee || 0),
    0
  )
  const now = Date.now()
  const millisecondsUntilTodayDue = Math.max(todayRange.end.getTime() - now, 0)

  return {
    blocked: overdueTotal > 0,
    overdueTotal,
    todayTotal,
    grandTotal: overdueTotal + todayTotal,
    outstandingSettlements,
    todaySettlement,
    todayRemittance: {
      totalDue: todayTotal,
      ridesDue: todayRides?.length || 0,
      dueAt: todayRange.end.toISOString(),
      millisecondsRemaining: millisecondsUntilTodayDue,
      isOverdue: millisecondsUntilTodayDue <= 0 && todayTotal > 0,
    },
  }
}

export function summarizeSettlement(settlement: any): DriverSettlementSummary {
  return {
    settlementDate: settlement.settlement_date,
    totalRides: settlement.total_rides || 0,
    totalFareAmount: Number(settlement.total_fare_amount || 0),
    totalPlatformFees: Number(settlement.total_platform_fees || 0),
    totalDriverEarnings: Number(settlement.total_driver_earnings || 0),
    status: settlement.settlement_status as SettlementStatus,
    paymentDueDate: settlement.payment_due_date,
  }
}
