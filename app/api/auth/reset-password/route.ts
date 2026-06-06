import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import bcrypt from "bcryptjs"
import { supabase, supabaseAdmin } from "@/lib/supabase"
import { normalizeEmail, normalizePhone, phoneVariants } from "@/lib/auth-normalize"

function errorResponse(status: number, error: string, meta?: Record<string, unknown>) {
  return NextResponse.json(
    {
      success: false,
      error,
      ...meta,
    },
    { status }
  )
}

/**
 * POST /api/auth/reset-password
 * Reset password using valid token
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const token = body.token || body.resetToken || body.passwordResetToken
    const password = body.password || body.newPassword || body.new_password
    const email = body.email || body.email_address ? normalizeEmail(body.email || body.email_address) : ""
    const phoneNumber = body.phone_number || body.phoneNumber || body.phone ? normalizePhone(body.phone_number || body.phoneNumber || body.phone) : ""

    console.log("🔑 [RESET-PASSWORD] Incoming request", {
      hasToken: !!token,
      hasPassword: !!password,
      hasEmail: !!email,
      hasPhone: !!phoneNumber,
      keys: Object.keys(body || {}),
    })

    if (!password) {
      console.warn("❌ [RESET-PASSWORD] Missing password", {
        hasToken: !!token,
        hasEmail: !!email,
        hasPhone: !!phoneNumber,
        bodyKeys: Object.keys(body || {}),
      })
      return errorResponse(400, "Password is required")
    }

    if (password.length < 8) {
      console.warn("❌ [RESET-PASSWORD] Password too short", { tokenPresent: !!token, passwordLength: password.length })
      return errorResponse(400, "Password must be at least 8 characters")
    }

    // Backward-compatible path for older mobile clients:
    // they submit email/phone + newPassword to /auth/reset-password after OTP verification.
    if (!token && (email || phoneNumber)) {
      console.log("🔁 [RESET-PASSWORD] Falling back to OTP-based reset flow")

      const userQuery = supabaseAdmin
        .from("users")
        .select("id, email, phone_number")

      const { data: otpUsers, error: otpUserError } = await (email
        ? userQuery.ilike("email", email).limit(1)
        : userQuery.in("phone_number", phoneVariants(phoneNumber)).limit(1))
      const otpUser = otpUsers?.[0]

      if (otpUserError || !otpUser) {
        console.warn("❌ [RESET-PASSWORD] OTP fallback user not found", {
          email: email || null,
          phoneNumber: phoneNumber || null,
        })
        return errorResponse(404, "User not found")
      }

      const { data: verifiedOtp, error: verifiedOtpError } = await supabaseAdmin
        .from("otps")
        .select("id, verified_at")
        .eq("user_id", otpUser.id)
        .eq("type", "forgot_password")
        .eq("is_verified", true)
        .order("verified_at", { ascending: false })
        .limit(1)
        .single()

      if (verifiedOtpError || !verifiedOtp) {
        console.warn("❌ [RESET-PASSWORD] OTP fallback verification missing", {
          userId: otpUser.id,
        })
        return errorResponse(400, "OTP verification required. Please verify your OTP first.")
      }

      const verifiedTime = new Date(verifiedOtp.verified_at).getTime()
      const thirtyMinutes = 30 * 60 * 1000
      if (Date.now() - verifiedTime > thirtyMinutes) {
        console.warn("❌ [RESET-PASSWORD] OTP fallback verification expired", {
          userId: otpUser.id,
          verifiedAt: verifiedOtp.verified_at,
        })
        return errorResponse(400, "OTP verification expired. Please request a new OTP.")
      }

      const hashedPassword = await bcrypt.hash(password, 10)
      const { error: otpUpdateError } = await supabaseAdmin
        .from("users")
        .update({
          password_hash: hashedPassword,
          password_reset_token: null,
          password_reset_expiry: null,
          updated_at: new Date(),
        })
        .eq("id", otpUser.id)

      if (otpUpdateError) {
        console.error("❌ [RESET-PASSWORD] OTP fallback password update failed:", otpUpdateError)
        return errorResponse(500, otpUpdateError.message || "Failed to update password", {
          code: otpUpdateError.code,
          details: otpUpdateError.details,
          hint: otpUpdateError.hint,
        })
      }

      await supabaseAdmin
        .from("otps")
        .delete()
        .eq("id", verifiedOtp.id)

      return NextResponse.json(
        { success: true, message: "Password reset successfully" },
        { status: 200 }
      )
    }

    if (!token) {
      console.warn("❌ [RESET-PASSWORD] Missing token or password", {
        hasToken: !!token,
        hasPassword: !!password,
        hasEmail: !!email,
        hasPhone: !!phoneNumber,
        bodyKeys: Object.keys(body || {}),
      })
      return errorResponse(400, "Token and password are required")
    }

    // Hash the token to compare with stored hash
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex")

    // Find user with matching reset token
    const { data: user, error: fetchError } = await supabase
      .from("users")
      .select("id, email, password_reset_expiry")
      .eq("password_reset_token", tokenHash)
      .single()

    if (fetchError || !user) {
      console.warn("❌ [RESET-PASSWORD] Invalid token", {
        tokenHash,
        fetchError: fetchError?.message,
      })
      return errorResponse(400, "Invalid token")
    }

    // Check if token has expired
    const expiryTime = new Date(user.password_reset_expiry).getTime()
    const currentTime = Date.now()

    if (currentTime > expiryTime) {
      console.warn("❌ [RESET-PASSWORD] Token has expired", {
        userId: user.id,
        email: user.email,
        expiryTime,
        currentTime,
      })
      return errorResponse(400, "Token has expired")
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 10)

    // Update password and clear reset token
    const { error: updateError } = await supabase
      .from("users")
      .update({
        password_hash: hashedPassword,
        password_reset_token: null,
        password_reset_expiry: null,
        updated_at: new Date(),
      })
      .eq("id", user.id)

    if (updateError) {
      console.error("Password update error:", updateError)
      return errorResponse(500, updateError.message || "Failed to update password", {
        code: updateError.code,
        details: updateError.details,
        hint: updateError.hint,
      })
    }

    return NextResponse.json(
      { success: true, message: "Password reset successfully" },
      { status: 200 }
    )
  } catch (error) {
    console.error("Reset password error:", error)
    return errorResponse(
      500,
      error instanceof Error ? error.message : "Internal server error"
    )
  }
}

