import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { createHash } from "crypto"
import { getSessionFromRequest } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"

function hashIdentifier(value?: string | null) {
  const normalized = String(value || "").trim().toLowerCase()
  return normalized ? createHash("sha256").update(normalized).digest("hex") : null
}

function maskEmail(email?: string | null) {
  const [name, domain] = String(email || "").split("@")
  if (!name || !domain) return null
  return `${name.slice(0, 2)}***@${domain}`
}

function maskPhone(phone?: string | null) {
  const value = String(phone || "").trim()
  if (value.length < 5) return null
  return `${value.slice(0, 4)}***${value.slice(-3)}`
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (!supabaseAdmin) {
      return NextResponse.json({ error: "Database client not configured" }, { status: 500 })
    }

    const userId = session.user.id
    const deletedStamp = new Date().toISOString()
    const anonymizedEmail = `deleted-${userId}@deleted.charterkeke.local`
    const anonymizedPhone = `deleted-${userId.slice(0, 18)}`
    const passwordHash = await bcrypt.hash(`deleted:${userId}:${deletedStamp}:${crypto.randomUUID()}`, 10)

    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("id, first_name, last_name, email, phone_number, role, status, created_at")
      .eq("id", userId)
      .single()

    if (existingUser) {
      await supabaseAdmin.from("deleted_accounts").insert({
        original_user_id: existingUser.id,
        role: existingUser.role,
        previous_status: existingUser.status,
        masked_email: maskEmail(existingUser.email),
        masked_phone: maskPhone(existingUser.phone_number),
        email_hash: hashIdentifier(existingUser.email),
        phone_hash: hashIdentifier(existingUser.phone_number),
        account_created_at: existingUser.created_at,
        deleted_at: deletedStamp,
        deletion_reason: "user_requested",
        metadata: {
          name: `${existingUser.first_name || ""} ${existingUser.last_name || ""}`.trim() || null,
          source: "mobile_app",
        },
      }).then(({ error }) => {
        if (error && error.code !== "42P01") {
          console.warn("[AccountDeletion] Failed to write deleted account ledger:", error)
        }
      })
    }

    await Promise.allSettled([
      supabaseAdmin.from("push_subscriptions").delete().eq("user_id", userId),
      supabaseAdmin.from("notification_preferences").delete().eq("user_id", userId),
      supabaseAdmin.from("notifications").delete().eq("user_id", userId),
      supabaseAdmin.from("otps").delete().eq("user_id", userId),
      supabaseAdmin.from("user_locations").delete().eq("user_id", userId),
    ])

    await supabaseAdmin
      .from("drivers")
      .update({
        availability_status: "offline",
        bank_name: null,
        bank_account_number: null,
        account_name: null,
        emergency_contact: null,
        vehicle_picture_url: null,
        license_picture_url: null,
        verified: false,
        updated_at: deletedStamp,
      })
      .eq("user_id", userId)

    const userDeletionPayload = {
      first_name: "Deleted",
      last_name: "User",
      email: anonymizedEmail,
      phone_number: anonymizedPhone,
      password_hash: passwordHash,
      profile_picture_url: null,
      emergency_contact: null,
      emergency_phone: null,
      password_reset_token: null,
      password_reset_expiry: null,
      profile_complete: false,
      status: "deleted",
      updated_at: deletedStamp,
      deleted_at: deletedStamp,
      deletion_reason: "user_requested",
    }

    let { error: userError } = await supabaseAdmin
      .from("users")
      .update(userDeletionPayload)
      .eq("id", userId)

    if (userError?.code === "42703" || userError?.code === "23514") {
      const fallbackPayload = {
        ...userDeletionPayload,
        status: "suspended",
      } as any
      delete fallbackPayload.deleted_at
      delete fallbackPayload.deletion_reason

      const fallback = await supabaseAdmin
        .from("users")
        .update(fallbackPayload)
        .eq("id", userId)
      userError = fallback.error
    }

    if (userError) {
      console.error("[AccountDeletion] Failed to anonymize user:", userError)
      return NextResponse.json({ error: "Failed to delete account" }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: "Your account has been permanently deleted.",
    })
  } catch (error) {
    console.error("[AccountDeletion] error:", error)
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 })
  }
}
