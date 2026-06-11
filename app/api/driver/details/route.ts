import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);

    if (!session?.user?.id || session.user.role !== "driver") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user and driver details together
    const { data: driver, error: driverError } = await supabase
      .from("drivers")
      .select(`
        *,
        users (
          id,
          first_name,
          last_name,
          email,
          phone_number,
          profile_picture_url
        )
      `)
      .eq("user_id", session.user.id)
      .single();

    if (driverError || !driver) {
      console.error("Driver fetch error:", driverError);
      return NextResponse.json(
        { error: "Driver record not found" },
        { status: 404 }
      );
    }

    // Also get user data directly
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("id", session.user.id)
      .single();

    if (userError) {
      console.error("User fetch error:", userError);
      return NextResponse.json(
        { error: "User record not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ 
      driver,
      user,
      combined: {
        ...user,
        ...driver,
      }
    }, { status: 200 });
  } catch (error) {
    console.error("Get driver details error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);

    if (!session?.user?.id || session.user.role !== "driver") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!supabaseAdmin) {
      return NextResponse.json({ error: "Database client not configured" }, { status: 500 });
    }

    const payload = await request.json();

    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("user_id", session.user.id)
      .single();

    if (driverError || !driver?.id) {
      return NextResponse.json({ error: "Driver record not found" }, { status: 404 });
    }

    const driverUpdates: Record<string, any> = {};
    const allowedDriverFields = [
      "vehicle_type",
      "plate_number",
      "guarantor_name",
      "guarantor_phone",
      "guarantor_address",
      "bank_name",
      "bank_code",
      "bank_account_number",
      "account_name",
      "emergency_contact",
    ];

    for (const field of allowedDriverFields) {
      if (payload[field] !== undefined) {
        driverUpdates[field] = payload[field];
      }
    }

    if (Object.keys(driverUpdates).length) {
      driverUpdates.updated_at = new Date().toISOString();
      const { error: updateDriverError } = await supabaseAdmin
        .from("drivers")
        .update(driverUpdates)
        .eq("id", driver.id);

      if (updateDriverError) {
        console.error("Driver update error:", updateDriverError);
        return NextResponse.json({ error: "Failed to update driver details" }, { status: 500 });
      }
    }

    const { data: updated, error: fetchUpdatedError } = await supabaseAdmin
      .from("drivers")
      .select("*")
      .eq("id", driver.id)
      .single();

    if (fetchUpdatedError) {
      return NextResponse.json({ error: "Updated details fetch failed" }, { status: 500 });
    }

    return NextResponse.json({ success: true, driver: updated }, { status: 200 });
  } catch (error) {
    console.error("Update driver details error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
