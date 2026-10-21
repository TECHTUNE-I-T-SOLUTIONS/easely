import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { isCashlessEnabled } from "@/lib/cashless";

export async function POST(request: NextRequest) {
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
    const { amount, bank_name, account_number, account_name, bank_account_id } = await request.json().catch(() => ({}));
    const numericAmount = Number(amount);

    if (!numericAmount || numericAmount <= 0) {
      return NextResponse.json({ error: "invalid_amount", message: "Enter a valid positive amount." }, { status: 400 });
    }

    // Verify driver's current wallet balance
    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("id, balance")
      .eq("user_id", session.user.id)
      .single();

    if (!wallet) {
      return NextResponse.json({ error: "wallet_not_found", message: "Driver wallet does not exist." }, { status: 404 });
    }

    const currentBalance = Number(wallet.balance || 0);
    if (currentBalance < numericAmount) {
      return NextResponse.json(
        { error: "insufficient_funds", message: `Balance ₦${currentBalance.toLocaleString()} is less than requested withdrawal amount.` },
        { status: 400 }
      );
    }

    // Deduct amount immediately from available balance to prevent double-spending
    await supabaseAdmin
      .from("wallets")
      .update({ balance: currentBalance - numericAmount, updated_at: new Date().toISOString() })
      .eq("id", wallet.id);

    // Create withdrawal request
    const { data: withdrawal, error: insertError } = await supabaseAdmin
      .from("withdrawal_requests")
      .insert({
        driver_id: session.user.id,
        amount: numericAmount,
        bank_name: bank_name || null,
        account_number: account_number || null,
        account_name: account_name || null,
        bank_account_id: bank_account_id || null,
        status: "pending",
      })
      .select()
      .single();

    if (insertError) {
      // Revert wallet deduction
      await supabaseAdmin
        .from("wallets")
        .update({ balance: currentBalance })
        .eq("id", wallet.id);

      return NextResponse.json({ error: "database_error", message: "Could not create withdrawal request." }, { status: 500 });
    }

    // Log transaction
    await supabaseAdmin.from("wallet_transactions").insert({
      user_id: session.user.id,
      type: "withdrawal",
      amount: numericAmount,
      description: `Withdrawal request to ${bank_name || "bank account"} (Ref: #${withdrawal.id.slice(0, 8)})`,
    });

    return NextResponse.json({
      success: true,
      message: "Withdrawal request submitted for admin approval.",
      data: withdrawal,
    });
  } catch (error: any) {
    console.error("[Withdraw Error]:", error);
    return NextResponse.json({ error: "internal_error", message: error?.message }, { status: 500 });
  }
}
