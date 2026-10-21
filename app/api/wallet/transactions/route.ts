import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { isCashlessEnabled } from "@/lib/cashless";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "20");
    const type = searchParams.get("type");

    const cashlessActive = await isCashlessEnabled();

    if (cashlessActive) {
      // Query enriched ledger from wallet_transactions
      let query = supabaseAdmin
        .from("wallet_transactions")
        .select("*")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (type) {
        query = query.eq("type", type);
      }

      const { data: walletTransactions } = await query;
      if (walletTransactions && walletTransactions.length > 0) {
        const formatted = walletTransactions.map((tx: any) => ({
          id: tx.id,
          amount: Number(tx.amount),
          transaction_type: ["topup", "ride_earning", "refund"].includes(tx.type) ? "credit" : "debit",
          source: tx.type,
          description: tx.description || tx.type,
          created_at: tx.created_at,
          status: "completed",
        }));
        return NextResponse.json({ transactions: formatted, source: "wallet_transactions" });
      }
    }

    // Default legacy transactions fallback (unchanged behavior)
    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("id")
      .eq("user_id", session.user.id)
      .single();

    if (!wallet) {
      return NextResponse.json({ transactions: [] });
    }

    let query = supabaseAdmin
      .from("transactions")
      .select("*")
      .eq("wallet_id", wallet.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (type) {
      query = query.eq("transaction_type", type);
    }

    const { data: transactions, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch transactions" },
        { status: 500 }
      );
    }

    return NextResponse.json({ transactions: transactions || [] });
  } catch (error) {
    console.error("Transaction fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
