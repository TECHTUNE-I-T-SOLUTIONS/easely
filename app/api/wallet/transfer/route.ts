import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { isCashlessEnabled } from "@/lib/cashless";

export async function POST(request: NextRequest) {
  const active = await isCashlessEnabled();
  if (!active) {
    return NextResponse.json(
      { enabled: false, message: "Cashless payments are not currently active." },
      { status: 200 }
    );
  }

  try {
    const { ride_id, rider_id, driver_id, fare_amount } = await request.json().catch(() => ({}));

    if (!ride_id || !rider_id || !driver_id || !fare_amount) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    }

    const fare = Number(fare_amount);
    const platformFee = Math.round(fare * 0.15 * 100) / 100; // 15% platform fee
    const driverCredit = fare - platformFee;

    // Check rider balance
    const { data: riderWallet } = await supabaseAdmin
      .from("wallets")
      .select("id, balance")
      .eq("user_id", rider_id)
      .single();

    if (!riderWallet) {
      return NextResponse.json(
        { error: "rider_wallet_not_found", message: "Rider wallet does not exist or has zero balance." },
        { status: 400 }
      );
    }

    const riderBalance = Number(riderWallet.balance || 0);
    if (riderBalance < fare) {
      return NextResponse.json(
        { error: "insufficient_balance", message: "Rider wallet balance is lower than ride fare." },
        { status: 400 }
      );
    }

    // Deduct rider
    await supabaseAdmin
      .from("wallets")
      .update({ balance: riderBalance - fare, updated_at: new Date().toISOString() })
      .eq("id", riderWallet.id);

    // Credit driver
    const { data: driverWallet } = await supabaseAdmin
      .from("wallets")
      .select("id, balance")
      .eq("user_id", driver_id)
      .single();

    const currentDriverBalance = Number(driverWallet?.balance || 0);
    if (driverWallet) {
      await supabaseAdmin
        .from("wallets")
        .update({ balance: currentDriverBalance + driverCredit, updated_at: new Date().toISOString() })
        .eq("id", driverWallet.id);
    } else {
      await supabaseAdmin.from("wallets").insert({
        user_id: driver_id,
        balance: driverCredit,
      });
    }

    // Transactions log
    await supabaseAdmin.from("wallet_transactions").insert([
      {
        user_id: rider_id,
        type: "ride_payment",
        amount: fare,
        ride_id,
        description: `Ride fare payment (Ride #${ride_id.slice(0, 8)})`,
      },
      {
        user_id: driver_id,
        type: "ride_earning",
        amount: driverCredit,
        ride_id,
        description: `Earning for Ride #${ride_id.slice(0, 8)} (Net after 15% fee)`,
      },
      {
        user_id: driver_id,
        type: "platform_fee",
        amount: platformFee,
        ride_id,
        description: `Platform share 15% for Ride #${ride_id.slice(0, 8)}`,
      },
    ]);

    // Driver payouts ledger
    await supabaseAdmin.from("driver_payouts").insert({
      driver_id,
      amount: driverCredit,
      ride_id,
      status: "paid",
    });

    return NextResponse.json({
      success: true,
      fare,
      driverCredit,
      platformFee,
    });
  } catch (error: any) {
    console.error("[Wallet Transfer Error]:", error);
    return NextResponse.json({ error: "internal_error", message: error?.message }, { status: 500 });
  }
}
