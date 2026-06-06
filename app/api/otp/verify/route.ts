import { type NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { normalizeEmail, normalizePhone, phoneVariants } from "@/lib/auth-normalize"

/**
 * POST /api/otp/verify
 * Verify a custom OTP code (for resume_session, forgot_password, verify_account)
 * 
 * Also handles legacy Termii PIN verification if pinId and pin are provided
 * 
 * Body (for custom OTP):
 * - code (required): The 6-digit OTP code
 * - phone_number (optional): Phone number the OTP was sent to
 * - email (optional): Email associated with the OTP
 * - type (required): 'resume_session', 'forgot_password', 'verify_account'
 * 
 * Body (legacy Termii PIN):
 * - pinId (required): Termii PIN ID
 * - pin (required): Termii PIN code
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { pinId, pin, code, type } = body
    const phone_number = body.phone_number ? normalizePhone(body.phone_number) : ""
    const email = body.email ? normalizeEmail(body.email) : ""

    // Handle legacy Termii PIN verification (for backward compatibility)
    if (pinId && pin) {
      const { verifyOTP } = await import("@/lib/termii")
      const result = await verifyOTP({ pinId, pin })

      if (typeof result === 'object' && result && 'verified' in result && result.verified) {
        return NextResponse.json({
          success: true,
          message: "OTP verified successfully",
        })
      }

      return NextResponse.json({ error: "Invalid OTP" }, { status: 400 })
    }

    // Handle custom OTP verification
    if (!code || !type) {
      return NextResponse.json(
        { error: "OTP code and type are required" },
        { status: 400 }
      )
    }

    if (!phone_number && !email) {
      return NextResponse.json(
        { error: "Phone number or email is required" },
        { status: 400 }
      )
    }

    console.log(`🔐 [OTP-VERIFY] Verifying OTP for type: ${type}`)

    // Find OTP record
    let query = supabaseAdmin
      .from("otps")
      .select("id, code, user_id, phone_number, email, type, is_verified, attempts, expires_at")
      .eq("code", code)
      .eq("type", type)
      .eq("is_verified", false)

    // Add phone or email filter
    if (phone_number) {
      query = query.in("phone_number", phoneVariants(phone_number))
    } else if (email) {
      query = query.ilike("email", email)
    }

    const { data: otpRecords, error: findError } = await query

    if (findError || !otpRecords || otpRecords.length === 0) {
      console.error(`❌ [OTP-VERIFY] OTP not found for type: ${type}`)
      return NextResponse.json(
        { error: "Invalid OTP code" },
        { status: 400 }
      )
    }

    const otp = otpRecords[0]

    // Check if OTP is expired
    const expiryTime = new Date(otp.expires_at).getTime()
    if (expiryTime < Date.now()) {
      console.error(`❌ [OTP-VERIFY] OTP expired`)

      // Delete expired OTP
      await supabaseAdmin
        .from("otps")
        .delete()
        .eq("id", otp.id)

      return NextResponse.json(
        { error: "OTP has expired. Please request a new one." },
        { status: 400 }
      )
    }

    // Check attempts (max 3)
    if (otp.attempts >= 3) {
      console.error(`❌ [OTP-VERIFY] Max attempts exceeded for OTP: ${otp.id}`)

      // Delete OTP after max attempts
      await supabaseAdmin
        .from("otps")
        .delete()
        .eq("id", otp.id)

      return NextResponse.json(
        { error: "Maximum verification attempts exceeded. Please request a new OTP." },
        { status: 400 }
      )
    }

    // Check if code matches (case-insensitive)
    if (String(otp.code).trim() !== String(code).trim()) {
      console.error(`❌ [OTP-VERIFY] Invalid code provided`)

      // Increment attempts
      await supabaseAdmin
        .from("otps")
        .update({ attempts: otp.attempts + 1 })
        .eq("id", otp.id)

      return NextResponse.json(
        {
          error: "Invalid OTP code",
          attemptsRemaining: 3 - (otp.attempts + 1),
        },
        { status: 400 }
      )
    }

    // Mark OTP as verified
    const { error: updateError } = await supabaseAdmin
      .from("otps")
      .update({
        is_verified: true,
        verified_at: new Date().toISOString(),
      })
      .eq("id", otp.id)

    if (updateError) {
      console.error(`❌ [OTP-VERIFY] Failed to mark OTP as verified:`, updateError)
      return NextResponse.json(
        { error: "Failed to verify OTP" },
        { status: 500 }
      )
    }

    console.log(`✅ [OTP-VERIFY] OTP verified successfully for user: ${otp.user_id}`)

    return NextResponse.json(
      {
        success: true,
        message: "OTP verified successfully",
        userId: otp.user_id,
        email: otp.email,
        phone: otp.phone_number,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error("❌ [OTP-VERIFY] Error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
