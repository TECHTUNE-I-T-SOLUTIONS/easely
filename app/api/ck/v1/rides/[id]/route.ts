import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { validateCkApiKey, withRateLimitHeaders } from "@/lib/ck-auth-middleware";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { auth, error } = await validateCkApiKey(request, "rides.read");
  if (error || !auth) return error!;

  const { id } = await context.params;

  if (!id) {
    return NextResponse.json(
      { error: "missing_id", message: "Ride ID is required." },
      { status: 400 }
    );
  }

  try {
    const { data: ride, error: fetchError } = await supabaseAdmin
      .from("rides")
      .select(`
        id,
        pickup_zone,
        pickup_description,
        destination_zone,
        destination_description,
        ride_type,
        fare_amount,
        status,
        assigned_driver_id,
        created_at,
        completed_at,
        updated_at,
        metadata
      `)
      .eq("id", id)
      .single();

    if (fetchError || !ride) {
      return NextResponse.json(
        { error: "ride_not_found", message: `Ride with ID ${id} not found.` },
        { status: 404 }
      );
    }

    // Safety check: ensure the ride belongs to this partner if created via API
    const partnerIdInMeta = (ride.metadata as any)?.partner_id;
    if (partnerIdInMeta && partnerIdInMeta !== auth.partnerId) {
      return NextResponse.json(
        { error: "forbidden", message: "You do not have access to view this ride." },
        { status: 403 }
      );
    }

    let driverDetails = null;
    if (ride.assigned_driver_id) {
      const { data: driver } = await supabaseAdmin
        .from("drivers")
        .select(`
          id,
          vehicle_type,
          plate_number,
          availability_status,
          users:user_id(first_name, last_name, phone_number)
        `)
        .eq("id", ride.assigned_driver_id)
        .single();

      if (driver) {
        const u = Array.isArray(driver.users) ? driver.users[0] : (driver.users as any);
        driverDetails = {
          id: driver.id,
          vehicle_type: driver.vehicle_type,
          plate_number: driver.plate_number,
          driver_name: u ? `${u.first_name || ""} ${u.last_name || ""}`.trim() : null,
          phone_number: u?.phone_number || null,
        };
      }
    }

    const res = NextResponse.json({
      success: true,
      data: {
        ...ride,
        driver: driverDetails,
      },
    });
    return withRateLimitHeaders(res, auth.keyId);
  } catch (err: any) {
    console.error(`[Public API] Error in GET /api/ck/v1/rides/${id}:`, err);
    return NextResponse.json(
      { error: "internal_error", message: err?.message || "Unexpected server error." },
      { status: 500 }
    );
  }
}
