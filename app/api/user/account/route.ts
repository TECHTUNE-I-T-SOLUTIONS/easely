import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { getSessionFromRequest } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"

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

    await Promise.allSettled([
      supabaseAdmin.from("push_subscriptions").delete().eq("user_id", userId),
      supabaseAdmin.from("notification_preferences").delete().eq("user_id", userId),
      supabaseAdmin.from("notifications").delete().eq("user_id", userId),
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

    const { error: userError } = await supabaseAdmin
      .from("users")
      .update({
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
        status: "suspended",
        updated_at: deletedStamp,
      })
      .eq("id", userId)

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
