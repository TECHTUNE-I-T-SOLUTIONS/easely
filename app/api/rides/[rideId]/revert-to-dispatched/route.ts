import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { sendRideRequestSMS, toTermiiPhoneNumber } from "@/lib/termii";
import { sendPushNotification } from "@/lib/push-service";
import { emitRideRequest } from "@/lib/push-emitters";

type Params = { params: Promise<{ rideId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const session = await getSessionFromRequest(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { rideId } = await params;
    const body = await request.json();
    const { reason } = body || {};

    if (!rideId) {
      return NextResponse.json({ error: "Ride ID is required" }, { status: 400 });
    }

    // Fetch the ride details
    const { data: ride, error: rideError } = await supabaseAdmin!
      .from("rides")
      .select("id, rider_id, status, driver_id, pickup_zone, fare_amount, assigned_driver_id, metadata")
      .eq("id", rideId)
      .single();

    if (rideError || !ride) {
      return NextResponse.json({ error: "Ride not found" }, { status: 404 });
    }

    // Verify the rider owns this ride
    if (ride.rider_id !== session.user.id) {
      return NextResponse.json({ error: "You can only revert your own rides" }, { status: 403 });
    }

    // Check if ride is in accepted status
    if (ride.status !== "accepted") {
      return NextResponse.json({ error: "Ride must be in accepted status to revert" }, { status: 400 });
    }

    const previousDriverId = ride.driver_id || ride.assigned_driver_id;

    // Add 10% penalty to driver's next remittance
    if (previousDriverId) {
      try {
        const penaltyAmount = ride.fare_amount * 0.10; // 10% of fare

        const { data: driverData } = await supabaseAdmin
          .from("drivers")
          .select("pending_lateness_penalty")
          .eq("id", previousDriverId)
          .single();

        const currentPenalty = Number(driverData?.pending_lateness_penalty || 0);
        const newPenalty = currentPenalty + penaltyAmount;

        await supabaseAdmin
          .from("drivers")
          .update({
            pending_lateness_penalty: newPenalty,
          })
          .eq("id", previousDriverId);

        // Record driver penalty history
        await supabaseAdmin.from("driver_penalties").insert({
          driver_id: previousDriverId,
          ride_id: rideId,
          penalty_type: "lateness",
          penalty_amount: penaltyAmount,
          penalty_percent: 0.10,
          ride_fare_amount: ride.fare_amount,
          status: "pending",
          metadata: {
            reason: "Driver failed to arrive within 15 minutes without communication",
            reverted_reason: reason,
          },
        });

        // Get driver user_id for notification
        const { data: driver } = await supabaseAdmin
          .from("drivers")
          .select("user_id")
          .eq("id", previousDriverId)
          .single();

        if (driver?.user_id) {
          // Send penalty notification to driver
          await supabaseAdmin.from("notifications").insert({
            user_id: driver.user_id,
            title: "Lateness Penalty Applied",
            message: `A 10% penalty fee (₦${penaltyAmount.toLocaleString()}) has been added to your next remittance for failing to arrive within 15 minutes.`,
            type: "penalty",
            channel: "in_app",
            related_table: "rides",
            related_id: rideId,
            data: {
              penalty_amount: penaltyAmount,
              penalty_percent: 10,
              ride_id: rideId,
            },
            deep_link: "/driver/earnings",
          });
        }

        console.log(`[RIDE_REVERT] Added ${penaltyAmount} penalty to driver ${previousDriverId}`);
      } catch (error) {
        console.error("[RIDE_REVERT] Failed to add driver penalty:", error);
      }
    }

    // Revert ride to dispatched status
    const { error: updateError } = await supabaseAdmin!
      .from("rides")
      .update({
        status: "dispatched",
        driver_id: null,
        assigned_driver_id: null,
        accepted_at: null,
        updated_at: new Date().toISOString(),
        metadata: {
          ...ride.metadata,
          reverted_reason: reason,
          reverted_from_driver: previousDriverId,
          reverted_at: new Date().toISOString(),
        },
      })
      .eq("id", rideId);

    if (updateError) {
      return NextResponse.json({ error: "Failed to revert ride" }, { status: 500 });
    }

    // Find available drivers in the zone (excluding the previous driver)
    const { data: zoneDrivers } = await supabaseAdmin!
      .from("drivers")
      .select("id, user_id, phone_number")
      .contains("operating_zones", [ride.pickup_zone])
      .eq("availability_status", "online")
      .eq("verified", true)
      .neq("id", previousDriverId) // Exclude the previous driver
      .limit(5);

    const drivers = zoneDrivers || [];

    // Send SMS and push notifications to new drivers
    for (const driver of drivers) {
      try {
        // Send SMS notification
        if (driver.phone_number) {
          const normalizedPhone = toTermiiPhoneNumber(driver.phone_number);
          if (normalizedPhone) {
            await sendRideRequestSMS({
              to: normalizedPhone,
              rideId,
              pickup: ride.pickup_zone,
              destination: ride.pickup_zone, // Using pickup_zone as destination since we don't have dropoff
              fare: ride.fare_amount,
            });
          }
        }

        // Send push notification
        await sendPushNotification(driver.user_id, {
          title: "New Ride Request",
          body: `Ride request in ${ride.pickup_zone}`,
          type: "ride_request",
          data: { rideId, type: "ride_request" },
        });
      } catch (error) {
        console.error(`[RIDE_REVERT] Failed to notify driver ${driver.id}:`, error);
      }
    }

    // Notify the rider about the re-dispatch and credit
    const creditAmount = ride.fare_amount * 0.10; // 10% credit
    await sendPushNotification(ride.rider_id, {
      title: "Ride Re-dispatched",
      body: drivers.length > 0
        ? `Your ride has been sent to ${drivers.length} new drivers. You'll receive a ₦${creditAmount.toLocaleString()} credit due to driver lateness.`
        : "We're looking for new drivers for your ride. You'll receive a ₦${creditAmount.toLocaleString()} credit due to driver lateness.",
      type: "ride_update",
      data: { rideId, type: "ride_redispatched", creditAmount },
    });

    // Send in-app notification about the credit
    await supabaseAdmin.from("notifications").insert({
      user_id: ride.rider_id,
      title: "Driver Lateness Credit",
      message: `Since the driver failed to arrive within 15 minutes without communication, you'll receive a ₦${creditAmount.toLocaleString()} credit on your next booking.`,
      type: "credit_earned",
      channel: "in_app",
      related_table: "rides",
      related_id: rideId,
      data: {
        credit_amount: creditAmount,
        credit_percent: 10,
        ride_id: rideId,
      },
      deep_link: "/rider/booking",
    });

    return NextResponse.json({
      success: true,
      message: "Ride reverted to dispatched status",
      rideId,
      previousDriverId,
      newDriversNotified: drivers.length,
    });
  } catch (error) {
    console.error("[RIDE_REVERT]", error);
    return NextResponse.json({ error: "Failed to revert ride" }, { status: 500 });
  }
}
