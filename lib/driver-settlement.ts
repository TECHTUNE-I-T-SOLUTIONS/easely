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

  return settlements || []
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
