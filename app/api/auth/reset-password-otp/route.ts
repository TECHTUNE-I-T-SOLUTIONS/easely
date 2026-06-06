import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import bcrypt from "bcryptjs";
import { normalizeEmail, normalizePhone, phoneVariants } from "@/lib/auth-normalize";

function errorResponse(status: number, error: string, meta?: Record<string, unknown>) {
  return NextResponse.json(
    {
      success: false,
      error,
      ...meta,
    },
    { status }
  );
}

/**
 * POST /api/auth/reset-password-with-otp
 * Reset password after successfully verifying OTP
 * 
 * This is the second step in password recovery flow:
 * 1. User calls /api/auth/forgot-password (gets OTP via SMS)
 * 2. User calls /api/otp/verify (verifies OTP)
 * 3. User calls this endpoint with new password
 * 
 * Body:
 * - email (required): User's email
 * - newPassword (required): New password (min 8 chars)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = body.email || body.email_address ? normalizeEmail(body.email || body.email_address) : "";
    const phone_number = body.phone_number || body.phoneNumber || body.phone ? normalizePhone(body.phone_number || body.phoneNumber || body.phone) : "";
    const newPassword = body.newPassword || body.password || body.new_password;

    console.log(`🔑 [RESET-PASSWORD-OTP] Email: ${email || 'N/A'}, Phone: ${phone_number || 'N/A'}`);
    console.log("🔑 [RESET-PASSWORD-OTP] Incoming request", {
      hasEmail: !!email,
      hasPhone: !!phone_number,
      hasNewPassword: !!newPassword,
      keys: Object.keys(body || {}),
    });

    if ((!email && !phone_number) || !newPassword) {
      console.warn("❌ [RESET-PASSWORD-OTP] Missing required fields", {
        hasEmail: !!email,
        hasPhone: !!phone_number,
        hasNewPassword: !!newPassword,
        bodyKeys: Object.keys(body || {}),
      });
      return errorResponse(400, "Email or phone number and new password are required");
    }

    if (newPassword.length < 8) {
      console.warn("❌ [RESET-PASSWORD-OTP] Password too short", {
        email: email || null,
        phone_number: phone_number || null,
        passwordLength: newPassword.length,
      });
      return errorResponse(400, "Password must be at least 8 characters");
    }

    // Find user
    const userQuery = supabaseAdmin
      .from("users")
      .select("id, email, phone_number")

    const { data: users, error: userError } = await (email
      ? userQuery.ilike("email", email).limit(1)
      : userQuery.in("phone_number", phoneVariants(phone_number)).limit(1));
    const user = users?.[0];

    if (userError || !user) {
      console.error(`❌ [RESET-PASSWORD-OTP] User not found`);
      return errorResponse(404, "User not found");
    }

    // Verify that a forgot_password OTP was recently verified for this user
    const { data: verifiedOTP, error: otpError } = await supabaseAdmin
      .from("otps")
      .select("id, verified_at")
      .eq("user_id", user.id)
      .eq("type", "forgot_password")
      .eq("is_verified", true)
      .order("verified_at", { ascending: false })
      .limit(1)
      .single();

    if (otpError || !verifiedOTP) {
      console.error(`❌ [RESET-PASSWORD-OTP] No verified OTP found`);
      return errorResponse(400, "OTP verification required. Please verify your OTP first.");
    }

    // Check that OTP was verified recently (within last 30 minutes)
    const verifiedTime = new Date(verifiedOTP.verified_at).getTime();
    const timeSinceVerification = Date.now() - verifiedTime;
    const thirtyMinutes = 30 * 60 * 1000;

    if (timeSinceVerification > thirtyMinutes) {
      console.error(`❌ [RESET-PASSWORD-OTP] OTP verification expired`);
      return errorResponse(400, "OTP verification expired. Please request a new OTP.");
    }

    console.log(`✅ [RESET-PASSWORD-OTP] Valid OTP verification found`);

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user password
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ password_hash: hashedPassword })
      .eq("id", user.id);

    if (updateError) {
      console.error(`❌ [RESET-PASSWORD-OTP] Password update failed:`, updateError);
      return errorResponse(500, updateError.message || "Failed to update password", {
        code: updateError.code,
        details: updateError.details,
        hint: updateError.hint,
      });
    }

    console.log(`✅ [RESET-PASSWORD-OTP] Password updated successfully for user: ${user.id}`);

    // Clean up the verified OTP
    await supabaseAdmin
      .from("otps")
      .delete()
      .eq("id", verifiedOTP.id);

    return NextResponse.json(
      {
        success: true,
        message: "Password reset successfully. You can now login with your new password.",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("❌ [RESET-PASSWORD-OTP] Error:", error);
    return errorResponse(
      500,
      error instanceof Error ? error.message : "Internal server error"
    );
  }
}
