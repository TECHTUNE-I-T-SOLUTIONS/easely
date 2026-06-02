import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendSMS } from "@/lib/termii";
import nodemailer from "nodemailer";

function env(name: string, fallback = "") {
  return process.env[name] || fallback;
}

function smtpTransport() {
  return nodemailer.createTransport({
    host: env("CRM_EMAIL_SMTP_HOST", "smtp.privateemail.com"),
    port: Number(env("CRM_EMAIL_SMTP_PORT", "465")),
    secure: (env("CRM_EMAIL_USE_SSL", "true") || "true").toLowerCase() !== "false",
    auth: {
      user: env("CRM_EMAIL_SMTP_USER", "support@charterkeke.com"),
      pass: env("CRM_EMAIL_SMTP_PASSWORD") || env("CRM_EMAIL_SMTP_FALLBACK_PASSWORD"),
    },
  });
}

async function sendEmailOTP(to: string, code: string, type: string) {
  if (!to || (!env("CRM_EMAIL_SMTP_PASSWORD") && !env("CRM_EMAIL_SMTP_FALLBACK_PASSWORD"))) return;
  const purpose = type === "resume_session" ? "resume your session" : type === "forgot_password" ? "reset your password" : "verify your account";
  const logoUrl = "https://admin.charterkeke.com/charter%20keke.png";
  await smtpTransport().sendMail({
    from: env("CRM_EMAIL_AUTOREPLY_FROM", "Charter Keke <support@charterkeke.com>"),
    to,
    subject: `Your Charter Keke verification code`,
    text: `Your Charter Keke OTP is ${code}. Use it to ${purpose}. It is valid for 10 minutes. Do not share it with anyone.`,
    html: `
      <div style="margin:0;padding:0;background:#f6f2ec;font-family:Arial,Helvetica,sans-serif;color:#171717">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f2ec;padding:28px 12px">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #f0dec8;border-radius:22px;overflow:hidden;box-shadow:0 18px 50px rgba(24,24,27,.08)">
                <tr>
                  <td style="background:#ff8a00;padding:26px 28px;color:#111111">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="vertical-align:middle">
                          <img src="${logoUrl}" width="54" height="54" alt="Charter Keke" style="display:block;border-radius:14px;border:1px solid rgba(0,0,0,.12)" />
                        </td>
                        <td style="vertical-align:middle;padding-left:14px">
                          <div style="font-size:12px;font-weight:900;letter-spacing:.18em;text-transform:uppercase">Charter Keke</div>
                          <div style="font-size:24px;line-height:1.25;font-weight:900;margin-top:3px">Verification code</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:30px 28px">
                    <p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#333333">Use this code to ${purpose}. It expires in <strong>10 minutes</strong>.</p>
                    <div style="background:#111111;border-radius:18px;padding:22px;text-align:center">
                      <div style="font-size:38px;line-height:1;font-weight:900;letter-spacing:10px;color:#ff8a00">${code}</div>
                    </div>
                    <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#6b7280">For your security, do not share this code with anyone. Charter Keke support will never ask you to reveal it.</p>
                    <p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:#8a8a8a">If you did not request this email, you can safely ignore it.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    `,
  });
}

/**
 * POST /api/otp/request
 * Request an OTP for various purposes (resume_session, forgot_password, verify_account)
 * 
 * Body:
 * - phone_number (optional): Phone number to send OTP to
 * - email (optional): Email to look up user and get phone
 * - type (required): 'resume_session', 'forgot_password', 'verify_account'
 * - user_id (optional): If user is logged in
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phone_number, email, type, user_id } = body;
    const deliveryMethod = String(body.deliveryMethod || body.method || body.channel || "sms").toLowerCase();

    console.log(`📱 [OTP-REQUEST] Type: ${type}, Phone: ${phone_number || 'N/A'}, Email: ${email || 'N/A'}`);

    // Validate type
    const validTypes = ["resume_session", "forgot_password", "verify_account"];
    if (!type || !validTypes.includes(type)) {
      return NextResponse.json(
        { error: "Invalid OTP type. Must be one of: " + validTypes.join(", ") },
        { status: 400 }
      );
    }

    let targetPhone = phone_number;
    let targetEmail = email;
    let findUser = null;

    // If email provided, look up user to get phone number
    if (email && !phone_number) {
      console.log(`🔍 [OTP-REQUEST] Looking up user by email: ${email}`);
      const { data: user, error: userError } = await supabaseAdmin
        .from("users")
        .select("id, phone_number, email")
        .eq("email", email)
        .single();

      if (userError || !user) {
        console.error(`❌ [OTP-REQUEST] User not found with email: ${email}`);
        return NextResponse.json(
          { error: "User not found with this email" },
          { status: 404 }
        );
      }

      findUser = user;
      targetPhone = user.phone_number;
      targetEmail = user.email;
      console.log(`✅ [OTP-REQUEST] User found, phone: ${targetPhone}`);
    }

    // If phone_number provided, look up user
    if (phone_number && !email) {
      console.log(`🔍 [OTP-REQUEST] Looking up user by phone: ${phone_number}`);
      const { data: user, error: userError } = await supabaseAdmin
        .from("users")
        .select("id, phone_number, email")
        .eq("phone_number", phone_number)
        .single();

      if (userError || !user) {
        console.error(`❌ [OTP-REQUEST] User not found with phone: ${phone_number}`);
        return NextResponse.json(
          { error: "User not found with this phone number" },
          { status: 404 }
        );
      }

      findUser = user;
      targetEmail = user.email;
      console.log(`✅ [OTP-REQUEST] User found, email: ${targetEmail}`);
    }

    // If no phone and no email, we can't proceed
    if (!targetPhone) {
      return NextResponse.json(
        { error: "Phone number or email is required" },
        { status: 400 }
      );
    }

    // Check if there's an active OTP already by user_id (matches the unique constraint)
    let userId = findUser?.id || user_id;
    
    if (!userId && targetEmail) {
      // If we don't have userId yet, we need to get it
      const { data: userByEmail } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("email", targetEmail)
        .single();
      userId = userByEmail?.id;
    }

    if (userId) {
      // Delete any existing unverified OTPs for this user and type
      // This removes the constraint violation and lets user request a new code
      const { error: deleteError } = await supabaseAdmin
        .from("otps")
        .delete()
        .eq("user_id", userId)
        .eq("type", type)
        .eq("is_verified", false);

      if (deleteError) {
        console.warn(`⚠️  [OTP-REQUEST] Warning deleting old OTP:`, deleteError);
        // Continue anyway - the old OTP might already be expired
      } else {
        console.log(`🔄 [OTP-REQUEST] Deleted previous unverified OTP for user`);
      }
    }

    // Generate 6-digit OTP
    const otpCode = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    console.log(`🔐 [OTP-REQUEST] Generated OTP code: ${otpCode}`);

    // Save OTP to database
    const otpUserId = findUser?.id || user_id || null;
    console.log(`💾 [OTP-REQUEST] Saving OTP for user_id: ${otpUserId}, type: ${type}`);
    
    const { data: newOTP, error: insertError } = await supabaseAdmin
      .from("otps")
      .insert({
        user_id: otpUserId,
        phone_number: targetPhone,
        email: targetEmail,
        code: otpCode,
        type: type,
        is_verified: false,
        attempts: 0,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error(`❌ [OTP-REQUEST] Failed to save OTP:`, insertError);
      return NextResponse.json(
        { error: "Failed to generate OTP" },
        { status: 500 }
      );
    }

    console.log(`✅ [OTP-REQUEST] OTP saved to database, ID: ${newOTP.id}`);

    if (deliveryMethod === "email") {
      try {
        await sendEmailOTP(targetEmail, otpCode, type);
        console.log(`[OTP-REQUEST] Email OTP sent successfully to: ${targetEmail}`);
      } catch (emailError) {
        console.error(`[OTP-REQUEST] Email OTP sending failed, but OTP saved:`, emailError);
      }
    } else {
      try {
        const smsMessage = `Your Charter Keke OTP is: ${otpCode}\n\nValid for 10 minutes.\nDo not share this code with anyone.`;
        
        await sendSMS({
          to: targetPhone,
          message: smsMessage,
          channel: "generic",
        });

        console.log(`📱 [OTP-REQUEST] SMS sent successfully to: ${targetPhone}`);
      } catch (smsError) {
        console.error(`⚠️  [OTP-REQUEST] SMS sending failed, but OTP saved:`, smsError);
      }
    }

    return NextResponse.json(
      {
        success: true,
        message: deliveryMethod === "email" ? "OTP sent to your email" : "OTP sent successfully",
        otpId: newOTP.id,
        expiresIn: 600, // 10 minutes in seconds
        phone: targetPhone,
        email: targetEmail,
        deliveryMethod,
        // In development, return OTP for testing
        ...(process.env.NODE_ENV === "development" && { otp: otpCode }),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("❌ [OTP-REQUEST] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
