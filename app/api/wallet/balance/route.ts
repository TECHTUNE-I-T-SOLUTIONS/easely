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
    const { data: wallet, error } = await supabaseAdmin
      .from("wallets")
      .select("id, balance, currency, updated_at")
      .eq("user_id", session.user.id)
      .single();

    if (error && error.code !== "PGRST116") {
      // Postgres single row not found
      console.error("[Wallet Balance Error]:", error);
      return NextResponse.json({ error: "Failed to fetch balance" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      enabled: true,
      balance: Number(wallet?.balance || 0),
      currency: wallet?.currency || "NGN",
    });
  } catch (error: any) {
    console.error("[Wallet Balance Error]:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
