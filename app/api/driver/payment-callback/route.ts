import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"
import { sendPushNotification } from "@/lib/push-service"
import { verifyDriverPaymentReference } from "@/lib/driver-settlement"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const reference = searchParams.get("reference")

    console.log("💳 [PAYSTACK_CALLBACK_GET] Received Paystack redirect:", { reference })

    if (!reference) {
      return NextResponse.json(
        { error: "No payment reference provided" },
        { status: 400 }
      )
    }

    const { data: storedPayment } = await supabase
      .from("driver_payments")
      .select("metadata")
      .eq("payment_reference", reference)
      .maybeSingle()

    const storedReturnUrl = (storedPayment?.metadata as any)?.return_url
    if (typeof storedReturnUrl === "string" && storedReturnUrl.length > 0) {
      const redirectUrl = new URL(storedReturnUrl)
      redirectUrl.searchParams.set("reference", reference)
      return NextResponse.redirect(redirectUrl.toString(), 302)
    }

    // Check if requesting from mobile via deep link redirect
    const userAgent = request.headers.get("user-agent") || ""
    const isMobileContext = userAgent.toLowerCase().includes("mobile") || userAgent.toLowerCase().includes("android") || userAgent.toLowerCase().includes("iphone")

    // If mobile browser, redirect to deep link
    if (isMobileContext) {
      console.log("📱 [PAYSTACK_CALLBACK_GET] Detected mobile, redirecting to deep link")
      const deepLinkUrl = `charterkeke://payment-callback/${reference}`
      return NextResponse.redirect(deepLinkUrl, 308)
    }

    // For web (or any non-mobile context), return HTML page with deep link fallback
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Processing</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
          }
          .container {
            text-align: center;
            padding: 40px;
            background: white;
            border-radius: 12px;
            max-width: 400px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1);
          }
          h1 {
            margin: 0 0 20px 0;
            font-size: 28px;
            color: #10B981;
          }
          p {
            color: #666;
            margin: 10px 0;
            line-height: 1.6;
          }
          .reference {
            background: #f5f5f5;
            padding: 12px;
            border-radius: 6px;
            font-family: monospace;
            font-size: 12px;
            margin: 20px 0;
            word-break: break-all;
          }
          .button {
            display: inline-block;
            padding: 12px 24px;
            border-radius: 6px;
            text-decoration: none;
            margin-top: 20px;
            font-weight: 600;
            cursor: pointer;
            background: #D67E0B;
            color: white;
          }
          .button:hover {
            background: #C66E00;
          }
          .spinner {
            width: 40px;
            height: 40px;
            border: 4px solid #f3f3f3;
            border-top: 4px solid #D67E0B;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="spinner"></div>
          <h1>✅ Payment Processed</h1>
          <p>Your settlement payment has been received.</p>
          <p>Reference:</p>
          <div class="reference">${reference}</div>
          <p style="color: #888; font-size: 14px;">Attempting to redirect to app...</p>
          <a href="charterkeke://payment-callback/${reference}" class="button">Return to App</a>
          <p style="color: #999; font-size: 12px; margin-top: 30px;">If the app didn't open, please return manually.</p>
        </div>
        <script>
          // Attempt to open deep link (for mobile browsers)
          const deepLinkUrl = 'charterkeke://payment-callback/${reference}';
          const button = document.querySelector('.button');
          
          // Try to open deep link
          setTimeout(() => {
            window.location.href = deepLinkUrl;
          }, 500);
          
          // Fallback after 2 seconds
          setTimeout(() => {
            // Check if we're still on the page (deep link didn't work)
            // User can manually click the button
          }, 2000);
        </script>
      </body>
      </html>
    `

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html" },
    })
  } catch (error) {
    console.error("[PaymentCallbackGET] error:", error)
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error</title>
        <style>
          body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
          .container { text-align: center; padding: 40px; background: white; border-radius: 12px; max-width: 400px; }
          h1 { color: #FF6B6B; }
          p { color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Error</h1>
          <p>There was an error processing your payment callback.</p>
          <p>Please return to the app to check your payment status.</p>
        </div>
      </body>
      </html>
    `
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html" },
      status: 500,
    })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { reference } = await request.json()

    if (!reference) {
      return NextResponse.json(
        { error: "Reference required" },
        { status: 400 }
      )
    }

    const verification = await verifyDriverPaymentReference(reference)

    if (!verification.found || !verification.success) {
      return NextResponse.json(
        { error: "Payment verification failed" },
        { status: 400 }
      )
    }

    const paymentData = verification.transaction
    const { driverId } = paymentData.metadata || {}

    const { data: existingPayment } = await supabase
      .from("driver_payments")
      .select("id, amount, status")
      .eq("payment_reference", reference)
      .maybeSingle()

    const wasAlreadyCompleted = existingPayment?.status === "completed"

    const payment = verification.payment || existingPayment

    // Get driver user ID for push notification
    let driverUserId: string | null = null
    if (driverId) {
      const { data: driver } = await supabase
        .from("drivers")
        .select("user_id")
        .eq("id", driverId)
        .single()

      driverUserId = driver?.user_id || null
    }

    // Send push notification to driver
    if (driverUserId && !wasAlreadyCompleted) {
      try {
        const amount = paymentData.amount ? (paymentData.amount / 100) : payment?.amount || 0
        await sendPushNotification([driverUserId], {
          title: "💰 Payment Received",
          body: `Settlement of ₦${amount} has been confirmed`,
          type: "payment_received",
          data: {
            reference,
            amount,
            settlementIds: paymentData.metadata?.settlementIds || paymentData.metadata?.settlement_ids || [],
            paymentDate: new Date().toISOString(),
          },
        })
        console.log("[PaymentCallback] Push notification sent to driver", {
          driverId,
          reference,
          amount,
        })
      } catch (pushError) {
        console.error("[PaymentCallback] Failed to send push notification:", pushError)
        // Don't fail the entire request if push notification fails
      }
    }

    // Do not change availability after payment verification. Availability is only
    // forced offline by overdue remittance checks, and drivers can toggle online
    // themselves when no overdue balance remains.

    return NextResponse.json({
      success: true,
      paymentStatus: "success",
      reference,
      message: "Payment verified and settlement updated",
      payment,
    })
  } catch (error) {
    console.error("Error processing payment callback:", error)
    return NextResponse.json(
      { error: "Failed to process payment callback" },
      { status: 500 }
    )
  }
}
