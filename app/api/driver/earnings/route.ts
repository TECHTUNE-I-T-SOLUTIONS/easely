import { NextRequest, NextResponse } from "next/server"
import { supabase, supabaseAdmin } from "@/lib/supabase"
import { getSessionFromRequest } from "@/lib/auth"

// Platform fee: 15% of each ride amount
const PLATFORM_FEE_PERCENTAGE = 0.15

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id || session.user.role !== "driver") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const timeframe = searchParams.get("timeframe") || "month" // day, week, month, year, all

    // Calculate date range
    let startDate = new Date()
    switch (timeframe) {
      case "day":
        startDate.setDate(startDate.getDate() - 1)
        break
      case "week":
        startDate.setDate(startDate.getDate() - 7)
        break
      case "month":
        startDate.setMonth(startDate.getMonth() - 1)
        break
      case "year":
        startDate.setFullYear(startDate.getFullYear() - 1)
        break
      case "all":
        startDate = new Date("2000-01-01")
        break
    }

    // Get driver record
    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id, user_id, bank_account_number, bank_name")
      .eq("user_id", session.user.id)
      .single()

    if (driverError) {
      return NextResponse.json({ error: "Driver not found" }, { status: 404 })
    }

    // Get all rides accepted by this driver in the timeframe (completed, in_progress, or accepted)
    const { data: rides, error: ridesError } = await supabaseAdmin
      .from("rides")
      .select(`
        id,
        fare_amount,
        driver_earnings,
        platform_fee,
        status,
        created_at,
        completed_at,
        pickup_zone,
        destination_zone,
        distance_km,
        rating,
        users:rider_id (first_name, last_name)
      `)
      .eq("driver_id", driver.id)
      .gte("created_at", startDate.toISOString())
      .in("status", ["accepted", "in_progress", "completed"])
      .order("created_at", { ascending: false })

    if (ridesError) {
      return NextResponse.json({ error: ridesError.message }, { status: 400 })
    }

    // Calculate earnings statistics
    let totalRideAmount = 0
    let totalPlatformFee = 0
    let totalDriverEarnings = 0
    let totalDistance = 0
    let totalRatings = 0
    let ratedRides = 0

    rides?.forEach((ride) => {
      totalRideAmount += ride.fare_amount || 0
      totalPlatformFee += ride.platform_fee || Math.round((ride.fare_amount || 0) * PLATFORM_FEE_PERCENTAGE)
      totalDriverEarnings += ride.driver_earnings || 0
      totalDistance += ride.distance_km || 0
      if (ride.rating) {
        totalRatings += ride.rating
        ratedRides += 1
      }
    })

    const averageRating = ratedRides > 0 ? (totalRatings / ratedRides).toFixed(1) : "0.0"

    return NextResponse.json({
      earnings: {
        timeframe,
        total_rides_accepted: rides?.length || 0,
        total_ride_earnings: totalRideAmount, // What riders paid
        platform_fee_percentage: PLATFORM_FEE_PERCENTAGE * 100,
        total_platform_fee: totalPlatformFee, // Total platform fees
        total_driver_earnings: totalDriverEarnings, // What driver actually earned
        driver_payable_to_platform: totalPlatformFee, // For potential payment
        average_rating: parseFloat(averageRating),
        total_distance: totalDistance,
        driver_bank_details: {
          account_number: driver.bank_account_number,
          bank_name: driver.bank_name,
        },
      },
      rides: (rides || []).map((ride) => ({
        id: ride.id,
        status: ride.status,
        pickup_zone: ride.pickup_zone,
        destination_zone: ride.destination_zone,
        fare_amount: ride.fare_amount,
        driver_earnings: ride.driver_earnings,
        platform_fee: ride.platform_fee,
        distance_km: ride.distance_km,
        rating: ride.rating,
        created_at: ride.created_at,
        completed_at: ride.completed_at,
        users: ride.users,
      })),
    })
  } catch (error) {
    console.error("API error:", error)
    return NextResponse.json(
      { error: "Failed to fetch earnings data" },
      { status: 500 }
    )
  }
}
