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
    const { amount } = await request.json().catch(() => ({}));
    const numericAmount = Number(amount);

    if (!numericAmount || numericAmount < 100) {
      return NextResponse.json(
        { error: "invalid_amount", message: "Minimum top-up amount is ₦100." },
        { status: 400 }
      );
    }

    const { data: user } = await supabaseAdmin
      .from("users")
      .select("email, first_name, last_name")
      .eq("id", session.user.id)
      .single();

    const userEmail = user?.email || session.user.email;
    if (!userEmail) {
      return NextResponse.json(
        { error: "missing_email", message: "User account must have a valid email for Paystack transactions." },
        { status: 400 }
      );
    }

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecret) {
      return NextResponse.json(
        { error: "config_error", message: "Paystack secret key is missing." },
        { status: 500 }
      );
    }

    const reference = `topup_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: userEmail,
        amount: Math.round(numericAmount * 100), // in kobo
        reference,
        metadata: {
          user_id: session.user.id,
          type: "wallet_topup",
        },
      }),
    });

    const paystackData = await paystackRes.json();
    if (!paystackData.status) {
      return NextResponse.json(
        { error: "paystack_error", message: paystackData.message || "Paystack initialization failed." },
        { status: 400 }
      );
    }

    // Save pending top-up row
    await supabaseAdmin.from("wallet_topups").insert({
      user_id: session.user.id,
      amount: numericAmount,
      paystack_ref: reference,
      status: "pending",
    });

    return NextResponse.json({
      success: true,
      authUrl: paystackData.data.authorization_url,
      reference,
      accessCode: paystackData.data.access_code,
    });
  } catch (error: any) {
    console.error("[Wallet Topup] Initiation error:", error);
    return NextResponse.json({ error: "internal_error", message: error?.message }, { status: 500 });
  }
}
