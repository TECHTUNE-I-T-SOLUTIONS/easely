import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

// GET /api/account-deletion/confirm?token=xxx
// Used by the confirm page to validate and display token info
export async function GET(request: NextRequest) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 })
    }

    const token = request.nextUrl.searchParams.get("token")?.trim()
    if (!token) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 })
    }

    const { data: req } = await supabaseAdmin
      .from("account_deletion_requests")
      .select("id, email, role, status, token_expires_at, confirmed_at")
      .eq("token", token)
      .maybeSingle()

    if (!req) {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 })
    }

    if (req.status === "completed") {
      return NextResponse.json({ error: "This account has already been deleted", status: "completed" }, { status: 410 })
    }

    if (req.status === "cancelled" || req.status === "expired") {
      return NextResponse.json({ error: "This link has expired or been cancelled", status: req.status }, { status: 410 })
    }

    if (req.status === "confirmed") {
      return NextResponse.json({ ok: true, status: "confirmed", email: req.email })
    }

    // Check token expiry
    if (new Date(req.token_expires_at) < new Date()) {
      await supabaseAdmin
        .from("account_deletion_requests")
        .update({ status: "expired" })
        .eq("id", req.id)
      return NextResponse.json({ error: "This link has expired. Please submit a new deletion request.", status: "expired" }, { status: 410 })
    }

    return NextResponse.json({
      ok: true,
      status: "pending",
      email: req.email,
      role: req.role,
      expiresAt: req.token_expires_at,
    })
  } catch (error) {
    console.error("[ACCOUNT_DELETION][CONFIRM][GET]", error)
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 })
  }
}

// POST /api/account-deletion/confirm
// Body: { token: string }  — final confirmation, triggers deletion
export async function POST(request: NextRequest) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 })
    }

    const body = await request.json().catch(() => ({}))
    const token = (body?.token || "").trim()
    if (!token) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 })
    }

    const { data: req } = await supabaseAdmin
      .from("account_deletion_requests")
      .select("id, email, user_id, role, status, token_expires_at")
      .eq("token", token)
      .maybeSingle()

    if (!req) {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 })
    }

    if (req.status === "completed") {
      return NextResponse.json({ ok: true, message: "Account already deleted" })
    }

    if (req.status !== "pending") {
      return NextResponse.json({ error: `Request is ${req.status}` }, { status: 409 })
    }

    if (new Date(req.token_expires_at) < new Date()) {
      await supabaseAdmin
        .from("account_deletion_requests")
        .update({ status: "expired" })
        .eq("id", req.id)
      return NextResponse.json({ error: "This link has expired. Please submit a new request." }, { status: 410 })
    }

    const now = new Date().toISOString()

    // Mark as confirmed
    await supabaseAdmin
      .from("account_deletion_requests")
      .update({ status: "confirmed", confirmed_at: now })
      .eq("id", req.id)

    // If we have the user_id — perform the actual deletion
    let deleted = false
    if (req.user_id) {
      try {
        // 1. Anonymise the user record (GDPR-compliant soft delete)
        const placeholder = `deleted_${req.user_id.replace(/-/g, "").slice(0, 12)}@deleted.charterkeke.com`
        await supabaseAdmin
          .from("users")
          .update({
            email: placeholder,
            phone: null,
            first_name: "Deleted",
            last_name: "User",
            profile_picture_url: null,
            is_active: false,
            deleted_at: now,
          })
          .eq("id", req.user_id)

        // 2. Hard delete auth user (removes login access)
        await supabaseAdmin.auth.admin.deleteUser(req.user_id)

        // 3. Mark request completed
        await supabaseAdmin
          .from("account_deletion_requests")
          .update({ status: "completed", completed_at: now })
          .eq("id", req.id)

        deleted = true
      } catch (deleteErr) {
        console.error("[ACCOUNT_DELETION][CONFIRM][DELETE] Error during deletion:", deleteErr)
        // Don't fail the request — the confirmed state is recorded, admin can complete manually
      }
    }

    return NextResponse.json({
      ok: true,
      deleted,
      message: deleted
        ? "Your account and personal data have been permanently deleted."
        : "Your deletion request has been confirmed. Your account will be deleted within 24 hours.",
    })
  } catch (error) {
    console.error("[ACCOUNT_DELETION][CONFIRM][POST]", error)
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 })
  }
}
