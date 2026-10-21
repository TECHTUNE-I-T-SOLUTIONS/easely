import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { validateCkApiKey, withRateLimitHeaders } from "@/lib/ck-auth-middleware";

export async function POST(request: NextRequest) {
  const { auth, error } = await validateCkApiKey(request, "rides.create");
  if (error || !auth) return error!;

  try {
    const body = await request.json().catch(() => ({}));
    const {
      pickup_zone,
      pickup_description,
      destination_zone,
      destination_description,
      ride_type = "single",
      fare_amount,
      rider_name,
      rider_phone,
      notes,
    } = body;

    if (!pickup_zone || !destination_zone) {
      return NextResponse.json(
        {
          error: "invalid_payload",
          message: "Both 'pickup_zone' and 'destination_zone' are mandatory.",
        },
        { status: 400 }
      );
    }

    const { data: ride, error: insertError } = await supabaseAdmin
      .from("rides")
      .insert({
        pickup_zone,
        pickup_description: pickup_description || null,
        destination_zone,
        destination_description: destination_description || null,
        ride_type,
        fare_amount: fare_amount ? Number(fare_amount) : null,
        status: "pending",
        metadata: {
          source: "public_api",
          partner_id: auth.partnerId,
          partner_name: auth.partnerName,
          key_id: auth.keyId,
          external_rider: {
            name: rider_name || null,
            phone: rider_phone || null,
          },
          notes: notes || null,
        },
      })
      .select()
      .single();

    if (insertError) {
      console.error("[Public API] Failed to create ride:", insertError);
      return NextResponse.json(
        { error: "database_error", message: "Failed to book ride request." },
        { status: 500 }
      );
    }

    const res = NextResponse.json(
      {
        success: true,
        message: "Ride request created successfully.",
        data: ride,
      },
      { status: 201 }
    );
    return withRateLimitHeaders(res, auth.keyId);
  } catch (err: any) {
    console.error("[Public API] Error in POST /api/ck/v1/rides:", err);
    return NextResponse.json(
      { error: "internal_error", message: err?.message || "Unexpected server error." },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { auth, error } = await validateCkApiKey(request, "rides.read");
  if (error || !auth) return error!;

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")));
    const offset = Math.max(0, parseInt(searchParams.get("offset") || "0"));
    const status = searchParams.get("status");

    let query = supabaseAdmin
      .from("rides")
      .select("id, pickup_zone, pickup_description, destination_zone, destination_description, ride_type, fare_amount, status, assigned_driver_id, created_at, updated_at, completed_at, metadata", { count: "exact" })
      .eq("metadata->>partner_id", auth.partnerId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq("status", status);
    }

    const { data: rides, count, error: fetchError } = await query;

    if (fetchError) {
      console.error("[Public API] Failed to list rides:", fetchError);
      return NextResponse.json(
        { error: "database_error", message: "Unable to retrieve rides." },
        { status: 500 }
      );
    }

    const res = NextResponse.json({
      success: true,
      data: rides || [],
      pagination: {
        limit,
        offset,
        total: count || 0,
      },
    });
    return withRateLimitHeaders(res, auth.keyId);
  } catch (err: any) {
    console.error("[Public API] Error in GET /api/ck/v1/rides:", err);
    return NextResponse.json(
      { error: "internal_error", message: err?.message || "Unexpected server error." },
      { status: 500 }
    );
  }
}
