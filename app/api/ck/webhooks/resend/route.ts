import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { signWebhookPayload } from "@/lib/ck-auth-middleware";

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    const role = (session?.user as any)?.role;

    if (!session?.user?.id || !["admin", "super_admin"].includes(role)) {
      return NextResponse.json({ error: "Unauthorized. Admin privileges required." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { delivery_id } = body;

    if (!delivery_id) {
      return NextResponse.json({ error: "missing_delivery_id", message: "'delivery_id' is required." }, { status: 400 });
    }

    const { data: delivery, error: fetchErr } = await supabaseAdmin
      .from("webhook_deliveries")
      .select("*, webhooks(url, secret, active)")
      .eq("id", delivery_id)
      .single();

    if (fetchErr || !delivery) {
      return NextResponse.json({ error: "not_found", message: "Webhook delivery record not found." }, { status: 404 });
    }

    const webhook = Array.isArray(delivery.webhooks) ? delivery.webhooks[0] : (delivery.webhooks as any);
    if (!webhook?.url) {
      return NextResponse.json({ error: "invalid_webhook", message: "Target webhook URL is missing." }, { status: 400 });
    }

    const payloadString = JSON.stringify(delivery.payload);
    const signature = signWebhookPayload(payloadString, webhook.secret || "default_secret");

    const startTime = Date.now();
    let status = "failed";
    let statusCode = 0;

    try {
      const response = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ck-Signature": signature,
          "X-Ck-Event": delivery.event,
        },
        body: payloadString,
      });
      statusCode = response.status;
      status = response.ok ? "delivered" : "failed";
    } catch (sendErr: any) {
      console.error("[Webhook Resend Error]:", sendErr);
    }

    await supabaseAdmin
      .from("webhook_deliveries")
      .update({
        status,
        attempt: (delivery.attempt || 0) + 1,
        next_retry_at: status === "failed" ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null,
      })
      .eq("id", delivery_id);

    return NextResponse.json({
      success: status === "delivered",
      status,
      status_code: statusCode,
      duration_ms: Date.now() - startTime,
    });
  } catch (error: any) {
    console.error("[Public API] Webhook resend failed:", error);
    return NextResponse.json({ error: "internal_error", message: error?.message }, { status: 500 });
  }
}
