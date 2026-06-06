import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { supabase } from "@/lib/supabase"
import { Resend } from "resend"
import { normalizeEmail, normalizePhone, phoneVariants } from "@/lib/auth-normalize"

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

/**
 * POST /api/auth/forgot-password
 * Send password reset email to user
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const email = body.email ? normalizeEmail(body.email) : ""
    const phone_number = body.phone_number ? normalizePhone(body.phone_number) : ""

    if (!email && !phone_number) {
      return NextResponse.json(
        { error: "Email or phone number is required" },
        { status: 400 }
      )
    }

    const query = supabase
      .from("users")
      .select("id, email, phone_number, status")

    const { data: users, error: userError } = await (email
      ? query.ilike("email", email).limit(1)
      : query.in("phone_number", phoneVariants(phone_number)).limit(1))
    const user = users?.[0]

    // Always return success for security (don't reveal if email exists or not)
    if (userError || !user) {
      return NextResponse.json(
        { success: true, message: "If this email is registered, you will receive a reset link" },
        { status: 200 }
      )
    }

    // Only allow active users
    if (user.status !== "active") {
      return NextResponse.json(
        { success: true, message: "If this email is registered, you will receive a reset link" },
        { status: 200 }
      )
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex")
    const resetTokenHash = crypto.createHash("sha256").update(resetToken).digest("hex")
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    // Store reset token in database
    const { error: updateError } = await supabase
      .from("users")
      .update({
        password_reset_token: resetTokenHash,
        password_reset_expiry: resetTokenExpiry.toISOString(),
      })
      .eq("id", user.id)

    if (updateError) {
      console.error("Error updating reset token:", updateError)
      return NextResponse.json(
        { success: true, message: "If this email is registered, you will receive a reset link" },
        { status: 200 }
      )
    }

    const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_BASE_URL || "https://charterkeke.vercel.app"
    const resetLink = `${baseUrl}/auth/reset-password?token=${resetToken}`

    if (resend) {
      try {
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || "Charter Keke <noreply@charterkeke.com>",
          to: user.email,
          subject: "Reset your Charter Keke password",
          html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
              <h1>Reset your password</h1>
              <p>We received a request to reset the password for your Charter Keke account.</p>
              <p><a href="${resetLink}" style="display:inline-block;padding:12px 18px;background:#FF9203;color:#fff;text-decoration:none;border-radius:8px;">Reset password</a></p>
              <p>If the button does not work, copy this link into your browser:</p>
              <p>${resetLink}</p>
              <p>This link expires in 1 hour.</p>
            </div>
          `,
        })
      } catch (emailError) {
        console.error("Password reset email send failed:", emailError)
      }
    }

    console.log("Password reset token generated for user:", user.email)
    console.log("Reset link:", resetLink)
    if (process.env.NODE_ENV === "development") {
      console.log("Reset token (dev only):", resetToken)
    }

    return NextResponse.json(
      { 
        success: true, 
        message: "If this account is registered, you will receive a reset link" 
      },
      { status: 200 }
    )
  } catch (error) {
    console.error("Forgot password error:", error)
    return NextResponse.json(
      { 
        success: true,
        message: "If this account is registered, you will receive a reset link" 
      },
      { status: 200 }
    )
  }
}
