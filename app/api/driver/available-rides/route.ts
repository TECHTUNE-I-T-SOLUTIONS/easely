import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { cancelExpiredOpenRides } from "@/lib/ride-expiry";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);

    if (!session?.user?.id || session.user.role !== "driver") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get driver info
    const { data: driver } = await supabase
      .from("drivers")
      .select("*")
      .eq("user_id", session.user.id)
      .single();

    if (!driver) {
      return NextResponse.json(
        { error: "Driver profile not found" },
        { status: 404 }
      );
    }

    await cancelExpiredOpenRides().catch((expiryError) => {
      console.error("Available rides expiry cleanup error:", expiryError);
    });

    // Get available rides (pending status, not yet accepted by any driver)
    const { data: rides, error } = await supabase
      .from("rides")
      .select(`
        id,
        rider_id,
        pickup_zone,
        destination_zone,
        pickup_description,
        destination_description,
        fare_amount,
        driver_earnings,
        platform_fee,
        distance_km,
        status,
        pickup_time,
        created_at
      `)
      .eq("status", "pending")
      .gte("pickup_time", new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      console.error("Available rides fetch error:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }

    // Fetch user data separately for each ride
    let ridesWithUsers = [];
    if (rides && rides.length > 0) {
      ridesWithUsers = await Promise.all(
        rides.map(async (ride: any) => {
          const { data: user } = await supabase
            .from("users")
            .select("id, first_name, last_name, phone_number, profile_picture_url")
            .eq("id", ride.rider_id)
            .single();

          return {
            ...ride,
            users: user || {},
          };
        })
      );
    }

        return NextResponse.json({ rides: ridesWithUsers || [] });
      } catch (error) {
        console.error("Available rides error:", error);
        return NextResponse.json(
          { error: "Internal server error" },
          { status: 500 }
        );
      }
    }
