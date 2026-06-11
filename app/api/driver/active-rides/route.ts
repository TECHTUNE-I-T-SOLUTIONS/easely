import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { getSessionFromRequest } from "@/lib/auth"
import { requireVerifiedDriver } from "@/lib/driver-verification"

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id || session.user.role !== "driver") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const verification = await requireVerifiedDriver(session.user.id)
    if (!verification.allowed) {
      return NextResponse.json(
        { error: verification.message, code: verification.code, driver: verification.driver },
        { status: verification.status }
      )
    }

    // Get driver ID from users table
    const { data: driverData } = await supabase
      .from("drivers")
      .select("id")
      .eq("user_id", session.user.id)
      .single()

    if (!driverData?.id) {
      return NextResponse.json(
        { error: "Driver profile not found" },
        { status: 404 }
      )
    }

    // Get driver's active rides (in_progress or accepted)
    const { data: rides, error } = await supabase
      .from("rides")
      .select(
        `
        id,
        rider_id,
        pickup_zone,
        pickup_description,
        destination_zone,
        destination_description,
        fare_amount,
        driver_earnings,
        platform_fee,
        seats_booked,
        distance_km,
        status,
        pickup_time,
        created_at
      `
      )
      .eq("driver_id", driverData.id)
      .in("status", ["accepted", "in_progress"])
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Active rides fetch error:", error)
      return NextResponse.json(
        { error: "Failed to fetch rides" },
        { status: 500 }
      )
    }

    // Fetch user data separately for each ride
    let ridesWithUsers = []
    if (rides && rides.length > 0) {
      ridesWithUsers = await Promise.all(
        rides.map(async (ride: any) => {
          const { data: user } = await supabase
            .from("users")
            .select("id, first_name, last_name, phone_number, profile_picture_url")
            .eq("id", ride.rider_id)
            .single()

          return {
            ...ride,
            users: user || {},
          }
        })
      )
    }

    return NextResponse.json({ rides: ridesWithUsers || [] }, { status: 200 })
  } catch (error) {
    console.error("Get active rides error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
