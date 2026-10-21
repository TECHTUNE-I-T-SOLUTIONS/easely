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
    const { reference } = await request.json().catch(() => ({}));
    if (!reference) {
      return NextResponse.json({ error: "missing_reference" }, { status: 400 });
    }

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
      },
    });

    const verifyData = await verifyRes.json();
    if (!verifyData.status || verifyData.data?.status !== "success") {
      return NextResponse.json(
        { success: false, status: verifyData.data?.status || "failed", message: "Transaction verification unsuccessful." },
        { status: 400 }
      );
    }

    const amountInNaira = Number(verifyData.data.amount) / 100;

    // Check if already processed
    const { data: existingTopup } = await supabaseAdmin
      .from("wallet_topups")
      .select("*")
      .eq("paystack_ref", reference)
      .single();

    if (existingTopup && existingTopup.status === "completed") {
      return NextResponse.json({
        success: true,
        alreadyProcessed: true,
        amount: existingTopup.amount,
      });
    }

    const userId = existingTopup?.user_id || verifyData.data.metadata?.user_id;
    if (!userId) {
      return NextResponse.json({ error: "user_not_identified" }, { status: 400 });
    }

    // Upsert / credit wallet
    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("id, balance")
      .eq("user_id", userId)
      .single();

    const currentBalance = Number(wallet?.balance || 0);
    const newBalance = currentBalance + amountInNaira;

    if (wallet) {
      await supabaseAdmin
        .from("wallets")
        .update({ balance: newBalance, updated_at: new Date().toISOString() })
        .eq("id", wallet.id);
    } else {
      await supabaseAdmin.from("wallets").insert({
        user_id: userId,
        balance: newBalance,
      });
    }

    // Update topup record
    if (existingTopup) {
      await supabaseAdmin
        .from("wallet_topups")
        .update({ status: "completed" })
        .eq("id", existingTopup.id);
    } else {
      await supabaseAdmin.from("wallet_topups").insert({
        user_id: userId,
        amount: amountInNaira,
        paystack_ref: reference,
        status: "completed",
      });
    }

    // Ledger record
    await supabaseAdmin.from("wallet_transactions").insert({
      user_id: userId,
      type: "topup",
      amount: amountInNaira,
      description: `Paystack wallet top-up (ref: ${reference})`,
    });

    return NextResponse.json({
      success: true,
      balance: newBalance,
      credited: amountInNaira,
    });
  } catch (error: any) {
    console.error("[Wallet Callback Error]:", error);
    return NextResponse.json({ error: "internal_error", message: error?.message }, { status: 500 });
  }
}
