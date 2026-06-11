import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getSessionFromRequest } from "@/lib/auth"
import {
  getDateRangeForOffset,
  upsertSettlementForDate,
  updateOverdueSettlements,
  getDriverRemittanceSummary,
} from "@/lib/driver-settlement"
import { requireVerifiedDriver } from "@/lib/driver-verification"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
)

function isMissingManualOffColumn(error: any) {
  const text = `${error?.message || ""} ${error?.details || ""}`
  return text.includes("manual_availability_off")
}

async function getDriverForUser(userId: string) {
  const withManualOff = await supabase
    .from("drivers")
    .select("id, verified, availability_status, updated_at, manual_availability_off")
    .eq("user_id", userId)
    .single()

  if (!withManualOff.error || !isMissingManualOffColumn(withManualOff.error)) {
    return { ...withManualOff, hasManualOffColumn: true }
  }

  const fallback = await supabase
    .from("drivers")
    .select("id, verified, availability_status, updated_at")
    .eq("user_id", userId)
    .single()

  return { ...fallback, hasManualOffColumn: false }
}

async function updateDriverAvailability(
  userId: string,
  status: string,
  manualOff?: boolean
) {
  const payload: Record<string, any> = {
    availability_status: status,
    updated_at: new Date().toISOString(),
  }

  if (typeof manualOff === "boolean") {
    payload.manual_availability_off = manualOff
  }

  const update = await supabase
    .from("drivers")
    .update(payload)
    .eq("user_id", userId)
    .select("availability_status, updated_at")
    .single()

  if (!update.error || !isMissingManualOffColumn(update.error)) {
    return update
  }

  delete payload.manual_availability_off
  return supabase
    .from("drivers")
    .update(payload)
    .eq("user_id", userId)
    .select("availability_status, updated_at")
    .single()
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const { data: driver, error, hasManualOffColumn } = await getDriverForUser(session.user.id)

    if (error || !driver) {
      return NextResponse.json(
        { error: "Driver not found" },
        { status: 404 }
      )
    }

    if (!driver.verified) {
      if (driver.availability_status !== "offline") {
        await updateDriverAvailability(session.user.id, "offline").catch(() => undefined)
      }
      return NextResponse.json({
        status: "offline",
        updatedAt: driver.updated_at,
        driverId: driver.id,
        blocked: true,
        code: "driver_not_verified",
        verificationStatus: "pending",
        message: "Your driver account is awaiting Charter Keke verification.",
        manualAvailabilityOff: true,
      })
    }

    // Auto-verify any pending payments before checking settlement status
    try {
      const { data: pendingPayments } = await supabase
        .from("driver_payments")
        .select("id, payment_reference, settlement_id, metadata")
        .eq("driver_id", driver.id)
        .eq("status", "pending")

      if (pendingPayments && pendingPayments.length > 0) {
        console.log(`[DriverStatus] Auto-verifying ${pendingPayments.length} pending payments`)

        for (const payment of pendingPayments) {
          try {
            const verifyUrl = `https://api.paystack.co/transaction/verify/${payment.payment_reference}`
            const verifyResponse = await fetch(verifyUrl, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
              },
            })

            const verifyData = await verifyResponse.json()

            if (verifyData.status && verifyData.data.status === "success") {
              console.log(`[DriverStatus] Payment ${payment.payment_reference} verified as successful`)

              // Update payment status
              await supabase
                .from("driver_payments")
                .update({
                  status: "completed",
                  confirmed_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq("id", payment.id)

              // Update transaction status
              await supabase
                .from("transactions")
                .update({
                  status: "completed",
                  updated_at: new Date().toISOString(),
                })
                .eq("reference", payment.payment_reference)

              // Update settlement status
              const settlementIds = (payment.metadata as any)?.settlement_ids || []
              if (payment.settlement_id) {
                settlementIds.push(payment.settlement_id)
              }

              if (settlementIds.length > 0) {
                await supabase
                  .from("driver_daily_settlement")
                  .update({
                    settlement_status: "paid",
                    paid_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  })
                  .in("id", settlementIds)
              }
            }
          } catch (verifyError) {
            console.error(`[DriverStatus] Error verifying payment ${payment.payment_reference}:`, verifyError)
          }
        }
      }
    } catch (verifyError) {
      console.error("[DriverStatus] Error in auto-verification:", verifyError)
    }

    const { dateString } = getDateRangeForOffset(-1)
    await upsertSettlementForDate(driver.id, dateString)
    const remittance = await getDriverRemittanceSummary(driver.id)

    let status = driver.availability_status || "offline"
    let updatedAt = driver.updated_at
    const manualOff = Boolean((driver as any).manual_availability_off)

    if (remittance.blocked) {
      if (status !== "offline") {
        const update = await updateDriverAvailability(session.user.id, "offline")
        if (!update.error) {
          status = update.data?.availability_status || "offline"
          updatedAt = update.data?.updated_at || updatedAt
        } else {
          status = "offline"
        }
      }
    } else if (!manualOff && status !== "online") {
      const update = await updateDriverAvailability(
        session.user.id,
        "online",
        hasManualOffColumn ? false : undefined
      )
      if (!update.error) {
        status = update.data?.availability_status || "online"
        updatedAt = update.data?.updated_at || updatedAt
      }
    }

    return NextResponse.json({
      status,
      updatedAt,
      driverId: driver.id,
      blocked: remittance.blocked,
      totalOverdue: remittance.overdueTotal,
      totalOutstanding: remittance.overdueTotal,
      totalTodayDue: remittance.todayTotal,
      totalDueNow: remittance.grandTotal,
      remittanceSummary: {
        overdueTotal: remittance.overdueTotal,
        todayTotal: remittance.todayTotal,
        grandTotal: remittance.grandTotal,
        todayRemittance: remittance.todayRemittance,
        timezone: "Africa/Lagos",
        serverTime: new Date().toISOString(),
      },
      manualAvailabilityOff: manualOff,
    })
  } catch (error) {
    console.error("Failed to fetch driver status:", error)
    return NextResponse.json(
      { error: "Failed to fetch driver status" },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { status } = body

    if (!["online", "offline", "busy"].includes(status)) {
      return NextResponse.json(
        { error: "Invalid status" },
        { status: 400 }
      )
    }

    const verification = await requireVerifiedDriver(session.user.id)
    if (!verification.allowed) {
      return NextResponse.json(
        { error: verification.message, code: verification.code, driver: verification.driver },
        { status: verification.status }
      )
    }

    const driverRecord = verification.driver

    if (status === "online") {
      const remittance = await getDriverRemittanceSummary(driverRecord.id)

      if (remittance.blocked) {
        return NextResponse.json(
          {
            error: "Outstanding settlements must be paid before going online",
            code: "settlement_overdue",
            totalOverdue: remittance.overdueTotal,
            totalOutstanding: remittance.overdueTotal,
            totalTodayDue: remittance.todayTotal,
            totalDueNow: remittance.grandTotal,
            remittanceSummary: {
              overdueTotal: remittance.overdueTotal,
              todayTotal: remittance.todayTotal,
              grandTotal: remittance.grandTotal,
              timezone: "Africa/Lagos",
              serverTime: new Date().toISOString(),
            },
          },
          { status: 403 }
        )
      }
    }

    const manualOff = status === "offline"
    const { data: driver, error } = await updateDriverAvailability(
      session.user.id,
      status,
      status === "busy" ? undefined : manualOff
    )

    if (error || !driver) {
      return NextResponse.json(
        { error: "Failed to update status" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      status: driver.availability_status,
      updatedAt: driver.updated_at,
      manualAvailabilityOff: status === "offline",
    })
  } catch (error) {
    console.error("Failed to update driver status:", error)
    return NextResponse.json(
      { error: "Failed to update driver status" },
      { status: 500 }
    )
  }
}
