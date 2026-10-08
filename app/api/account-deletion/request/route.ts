import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { sendAccountDeletionEmail } from "@/lib/account-deletion-email"
import crypto from "crypto"

// POST /api/account-deletion/request
// Body: { email: string, reason?: string }
export async function POST(request: NextRequest) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 })
    }

    const body = await request.json().catch(() => ({}))
    const email = (body?.email || "").trim().toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "A valid email address is required" }, { status: 400 })
    }

    // Rate limit: block if a pending request was made in the last 10 minutes
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { data: recentRequest } = await supabaseAdmin
      .from("account_deletion_requests")
      .select("id, requested_at")
      .eq("email", email)
      .eq("status", "pending")
      .gte("requested_at", tenMinsAgo)
      .maybeSingle()

    if (recentRequest) {
      return NextResponse.json(
        { error: "A deletion request was already sent to this email. Please check your inbox." },
        { status: 429 }
      )
    }

    // Look up the user account
    const { data: userRow } = await supabaseAdmin
      .from("users")
      .select("id, first_name, last_name, role, email")
      .eq("email", email)
      .maybeSingle()

    // Generate a secure token
    const token = crypto.randomBytes(32).toString("hex")
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    // Expire any existing pending requests for this email
    await supabaseAdmin
      .from("account_deletion_requests")
      .update({ status: "expired" })
      .eq("email", email)
      .eq("status", "pending")

    // Create the new request
    const { error: insertError } = await supabaseAdmin
      .from("account_deletion_requests")
      .insert({
        email,
        user_id: userRow?.id || null,
        role: userRow?.role || "unknown",
        token,
        token_expires_at: expiresAt,
        ip_address: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null,
        user_agent: request.headers.get("user-agent") || null,
        reason: body?.reason || null,
      })

    if (insertError) {
      console.error("[ACCOUNT_DELETION][REQUEST] Insert error:", insertError)
      return NextResponse.json({ error: "Failed to create deletion request" }, { status: 500 })
    }

    // Send confirmation email
    const firstName = userRow?.first_name || null
    await sendAccountDeletionEmail({ email, firstName, token }).catch((err) =>
      console.error("[ACCOUNT_DELETION][REQUEST] Email error:", err)
    )

    // Always return success (don't reveal if email exists)
    return NextResponse.json(
      {
        ok: true,
        message: "If an account with this email exists, a confirmation link has been sent to your inbox.",
      },
      { status: 200 }
    )
  } catch (error) {
    console.error("[ACCOUNT_DELETION][REQUEST] Error:", error)
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 })
  }
}
