import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { isCashlessEnabled } from "@/lib/cashless";

export async function GET(request: NextRequest) {
  const active = await isCashlessEnabled();
  if (!active) {
    return NextResponse.json(
      { enabled: false, message: "Cashless payments are not currently active." },
      { status: 200 }
    );
  }

  const session = await getSessionFromRequest(request);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data: withdrawals, error } = await supabaseAdmin
      .from("withdrawal_requests")
      .select("*")
      .eq("driver_id", session.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: "Failed to fetch withdrawals" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      withdrawals: withdrawals || [],
    });
  } catch (error: any) {
    console.error("[Driver Withdrawals Error]:", error);
    return NextResponse.json({ error: "internal_error", message: error?.message }, { status: 500 });
  }
}
