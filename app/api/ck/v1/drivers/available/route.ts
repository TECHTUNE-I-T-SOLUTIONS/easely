import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { validateCkApiKey, withRateLimitHeaders } from "@/lib/ck-auth-middleware";

export async function GET(request: NextRequest) {
  const { auth, error } = await validateCkApiKey(request, "drivers.read");
  if (error || !auth) return error!;

  try {
    const { searchParams } = new URL(request.url);
    const zone = searchParams.get("zone");
    const vehicleType = searchParams.get("vehicle_type");

    let query = supabaseAdmin
      .from("drivers")
      .select(`
        id,
        vehicle_type,
        operating_zones,
        availability_status,
        verified,
        users:user_id(first_name, last_name)
      `)
      .eq("availability_status", "online")
      .eq("verified", true);

    if (vehicleType) {
      query = query.eq("vehicle_type", vehicleType);
    }

    if (zone) {
      query = query.contains("operating_zones", [zone]);
    }

    const { data: drivers, error: fetchError } = await query.limit(50);

    if (fetchError) {
      console.error("[Public API] Failed to fetch drivers:", fetchError);
      return NextResponse.json(
        { error: "database_error", message: "Failed to fetch available drivers." },
        { status: 500 }
      );
    }

    const formatted = (drivers || []).map((d: any) => {
      const u = Array.isArray(d.users) ? d.users[0] : d.users;
      return {
        driver_id: d.id,
        first_name: u?.first_name || "Driver",
        vehicle_type: d.vehicle_type || "keke",
        operating_zones: d.operating_zones || [],
        status: d.availability_status,
      };
    });

    const res = NextResponse.json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
    return withRateLimitHeaders(res, auth.keyId);
  } catch (err: any) {
    console.error("[Public API] Error in GET /api/ck/v1/drivers/available:", err);
    return NextResponse.json(
      { error: "internal_error", message: err?.message || "Unexpected server error." },
      { status: 500 }
    );
  }
}
