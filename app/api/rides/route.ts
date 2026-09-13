import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { notifyDriverAboutRide } from "@/lib/notifications";
import { emitRideRequest, emitRideUpdate } from "@/lib/push-emitters";
import { sendRideRequestSMS, toTermiiPhoneNumber } from "@/lib/termii";
import { sendPushNotification } from "@/lib/push-service";

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      pickup_zone,
      pickup_description,
      destination_zone,
      destination_description,
      pickup_time,
      ride_type = "single",
      fare,
      estimated_distance,
    } = body;

    // Validate required fields
    if (!pickup_zone || !destination_zone) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const parsedFare = Number.isFinite(Number(fare)) ? Number(fare) : 0;
    const parsedDistance = Number.isFinite(Number(estimated_distance))
      ? Number(estimated_distance)
      : 0;

    // Create ride
    const { data: ride, error: rideError } = await supabaseAdmin!
      .from("rides")
      .insert([
        {
          rider_id: session.user.id,
          pickup_zone,
          pickup_description,
          destination_zone,
          destination_description,
          ride_type,
          fare: parsedFare,
          estimated_distance: parsedDistance,
          status: "pending",
        },
      ])
      .select()
      .single();

    if (rideError || !ride) {
      return NextResponse.json(
        { error: "Failed to create ride" },
        { status: 500 }
      );
    }

    // Find available drivers in the zone
    const { data: zoneDrivers } = await supabaseAdmin!
      .from("drivers")
      .select("id, user_id")
      .contains("operating_zones", [pickup_zone])
      .eq("availability_status", "online")
      .eq("verified", true)
      .limit(5);

    let drivers = zoneDrivers || [];

    if (drivers.length === 0) {
      console.log("[RideDispatch] No zone-matched drivers found, using online fallback", {
        pickup_zone,
      });

      const { data: fallbackDrivers } = await supabaseAdmin!
        .from("drivers")
        .select("id, user_id")
        .eq("availability_status", "online")
        .eq("verified", true)
        .limit(5);

      drivers = fallbackDrivers || [];
    }

    console.log("[RideDispatch] Candidate drivers count", {
      rideId: ride.id,
      count: drivers.length,
      pickup_zone,
    });

    // Emit push notification to all nearby drivers
    if (ride) {
      await emitRideRequest(
        ride.id,
        pickup_description || pickup_zone,
        destination_description || destination_zone,
        Number(ride.fare || 0),
        Number(ride.estimated_distance || 0)
      );

      await emitRideUpdate(
        session.user.id,
        ride.id,
        "status",
        `Your ride request from ${pickup_zone} to ${destination_zone} has been created successfully.`
      );
    }

    // Notify drivers
    if (drivers && drivers.length > 0) {
      const driverUserIds = drivers.map((driver: any) => driver.user_id);
      const { data: driverUsers } = await supabaseAdmin!
        .from("users")
        .select("id, phone_number")
        .in("id", driverUserIds);

      const phoneByUserId = new Map<string, string>();
      for (const user of driverUsers || []) {
        if (user.phone_number) {
          phoneByUserId.set(user.id, user.phone_number);
        }
      }

      if (!phoneByUserId.size) {
        console.log("[RideDispatch] No driver phone numbers available for SMS", {
          rideId: ride.id,
          drivers: drivers.length,
        });
      }

      // Send push notification to all drivers with rich features
      try {
        await sendPushNotification(driverUserIds, {
          title: "🚗 New Ride Request",
          body: `Pickup: ${pickup_description || pickup_zone} | Dropoff: ${destination_description || destination_zone} | Fare: ₦${parsedFare.toLocaleString()}`,
          type: "ride_request",
          categoryId: "ride_request_action",
          imageUrl: "https://example.com/ride-request-icon.png", // Replace with actual image URL
          actions: [
            {
              id: "accept_ride",
              title: "Accept",
              action: "accept",
            },
            {
              id: "reject_ride",
              title: "Reject",
              action: "reject",
            },
          ],
          data: {
            rideId: ride.id,
            pickup: pickup_description || pickup_zone,
            destination: destination_description || destination_zone,
            fare: parsedFare,
            distance: parsedDistance,
            deeplink: `/driver/ride-details?rideId=${ride.id}`,
            action: "accept_ride",
          },
        });
        console.log("[RideDispatch] Rich push notification sent to drivers", {
          rideId: ride.id,
          driverCount: driverUserIds.length,
        });
      } catch (pushError) {
        console.error("[RideDispatch] Failed to send push notifications:", pushError);
      }

      const smsTasks: Promise<any>[] = [];

      for (const driver of drivers) {
        await notifyDriverAboutRide(
          driver.user_id,
          ride.id,
          pickup_zone,
          destination_zone
        );

        // Log dispatch
        await supabaseAdmin!.from("ride_dispatch_logs").insert([
          {
            ride_id: ride.id,
            driver_id: driver.id,
            dispatch_method: "push",
            created_at: new Date().toISOString(),
          },
        ]);

        const driverPhone = phoneByUserId.get(driver.user_id);
        if (driverPhone) {
          const normalized = toTermiiPhoneNumber(driverPhone);
          if (!normalized) {
            console.log("[RideDispatch] Invalid driver phone for SMS", {
              rideId: ride.id,
              driverId: driver.id,
            });
          }
          smsTasks.push(
            sendRideRequestSMS({
              to: driverPhone,
              rideId: ride.id,
              pickup: pickup_description || pickup_zone,
              destination: destination_description || destination_zone,
              pickupTime: (ride as any).pickup_time || pickup_time || (ride as any).created_at,
              fare: Number((ride as any).fare_amount || (ride as any).fare || parsedFare || 0),
            }).then(() =>
              supabaseAdmin!.from("ride_dispatch_logs").insert([
                {
                  ride_id: ride.id,
                  driver_id: driver.id,
                  dispatch_method: "sms",
                  created_at: new Date().toISOString(),
                },
              ])
            )
          );
        }
      }

      const smsResults = await Promise.allSettled(smsTasks);
      let smsSuccessCount = 0;
      for (const result of smsResults) {
        if (result.status === "rejected") {
          console.error("SMS dispatch failed:", result.reason);
        } else {
          smsSuccessCount += 1;
        }
      }

      console.log("[RideDispatch] SMS dispatch summary", {
        rideId: ride.id,
        attempted: smsTasks.length,
        successful: smsSuccessCount,
      });

      // Update ride status to dispatched
      await supabaseAdmin!
        .from("rides")
        .update({ status: "dispatched" })
        .eq("id", ride.id);
    } else {
      console.log("[RideDispatch] No online verified drivers available for dispatch", {
        rideId: ride.id,
        pickup_zone,
      });
    }

    return NextResponse.json(
      {
        message: "Ride created successfully",
        ride,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Ride creation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") || "10");

    // Fetch rides with driver details using Supabase joins
    let query = supabaseAdmin!
      .from("rides")
      .select(`
        *,
        drivers:driver_id (
          id,
          user_id,
          vehicle_type,
          plate_number,
          vehicle_picture_url,
          average_rating,
          users:user_id (
            first_name,
            last_name,
            phone_number,
            profile_picture_url
          )
        )
      `)
      .eq("rider_id", session.user.id)
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    // Apply limit
    query = query.limit(limit);

    const { data: rides, error } = await query;

    if (error) {
      console.error("Ride fetch error from Supabase:", error);
      return NextResponse.json(
        { error: "Failed to fetch rides", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ rides });
  } catch (error) {
    console.error("Ride fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: (error as Error).message },
      { status: 500 }
    );
  }
}
