import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import bcrypt from "bcryptjs";
import { sendPushNotification } from "@/lib/push-service";
import { normalizeEmail, phoneVariants } from "@/lib/auth-normalize";

export async function POST(request: NextRequest) {
  try {
    console.log("🔵 [LOGIN] Starting login endpoint...");
    
    if (!supabaseAdmin) {
      console.error("❌ [LOGIN] Supabase admin client not initialized");
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }

    let body;
    try {
      body = await request.json();
      console.log("📱 [LOGIN] Request body received:", {
        email: body.email ? "✓ provided" : "✗ missing",
        phone: body.phone ? "✓ provided" : "✗ missing",
        password: body.password ? "✓ provided" : "✗ missing"
      });
    } catch (parseError) {
      console.error("❌ [LOGIN] Failed to parse request body:", parseError);
      return NextResponse.json(
        { error: "Invalid request format" },
        { status: 400 }
      );
    }

    const { password } = body;
    const email = body.email ? normalizeEmail(body.email) : "";
    const phone = body.phone ? String(body.phone).trim() : "";

    // Validate required fields
    if (!password) {
      console.error("❌ [LOGIN] Missing password field");
      return NextResponse.json(
        { error: "Password is required" },
        { status: 400 }
      );
    }

    if (!email && !phone) {
      console.error("❌ [LOGIN] Missing both email and phone fields");
      return NextResponse.json(
        { error: "Email or phone is required" },
        { status: 400 }
      );
    }

    // Find user
    let user;
    if (email) {
      console.log("🔍 [LOGIN] Searching user by email...");
      const { data, error } = await supabaseAdmin
        .from("users")
        .select("*")
        .ilike("email", email)
        .single();

      if (error) {
        console.error("❌ [LOGIN] Email search failed:", error.message);
        return NextResponse.json(
          { error: "Invalid email or password" },
          { status: 401 }
        );
      }
      console.log("✅ [LOGIN] User found by email");
      user = data;
    } else if (phone) {
      console.log("🔍 [LOGIN] Searching user by phone...");
      const phoneOptions = phoneVariants(phone);
      const { data, error } = await supabaseAdmin
        .from("users")
        .select("*")
        .in("phone_number", phoneOptions)
        .limit(1)
        .single();

      if (error) {
        console.error("❌ [LOGIN] Phone search failed:", error.code, error.message);
        return NextResponse.json(
          { error: "Invalid phone or password" },
          { status: 401 }
        );
      }
      console.log("✅ [LOGIN] User found by phone");
      user = data;
    }

    if (!user) {
      console.error("❌ User not found");
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    console.log("✅ User found:", {
      id: user.id,
      email: user.email,
      status: user.status
    });

    // Check if user is active
    if (user.status !== "active") {
      console.error("❌ [LOGIN] User not active. Status:", user.status);
      let hasDeletedLedger = false;
      if (user.status === "suspended") {
        const { data: deletedAccount } = await supabaseAdmin
          .from("deleted_accounts")
          .select("id")
          .eq("original_user_id", user.id)
          .maybeSingle();
        hasDeletedLedger = Boolean(deletedAccount?.id);
      }

      const isDeletedAccount =
        user.status === "deleted" ||
        Boolean(user.deleted_at) ||
        String(user.deletion_reason || "").toLowerCase() === "user_requested" ||
        hasDeletedLedger;

      if (isDeletedAccount) {
        return NextResponse.json(
          { error: "Account not found. Please create a new account to continue." },
          { status: 404 }
        );
      }

      return NextResponse.json(
        { error: user.status === "suspended" ? "This account is currently unavailable. Please contact support." : `Account is ${user.status}. Please complete your profile.` },
        { status: 403 }
      );
    }

    // Validate password
    console.log("🔐 [LOGIN] Validating password...");
    if (!user.password_hash) {
      console.error("❌ [LOGIN] User has no password hash in database");
      return NextResponse.json(
        { error: "Account not properly configured" },
        { status: 500 }
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      console.error("❌ [LOGIN] Password validation failed - incorrect password");
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    console.log("✅ [LOGIN] Password validated successfully");

    // Create a simple token from user ID (mobile app will cache the session)
    const token = Buffer.from(`${user.id}:${Date.now()}`).toString("base64");
    
    console.log("📊 [LOGIN] Raw user from DB:", {
      id: user.id,
      role: user.role,
      email: user.email,
      phone: user.phone_number
    });
    console.log("✅ [LOGIN] User authenticated successfully - sending response");

    // Return user data and token - matching Rider/Driver type structure
    const baseUserData = {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone_number,
      role: user.role as 'rider' | 'driver' | 'admin',
      avatar: user.profile_picture_url,
      createdAt: user.created_at,
      updatedAt: user.updated_at || user.created_at,
    };

    // Build role-specific user object
    let userData;
    if (user.role === 'driver') {
      const { data: driverProfile } = await supabaseAdmin
        .from("drivers")
        .select("id, verified, vehicle_type, plate_number, operating_zones, average_rating, total_rides_completed, total_earnings, bank_name, bank_account_number, account_name")
        .eq("user_id", user.id)
        .maybeSingle();

      userData = {
        ...baseUserData,
        role: 'driver' as const,
        driverId: driverProfile?.id || '',
        licenseNumber: user.license_number || '',
        licenseExpiry: user.license_expiry || '',
        vehicleType: driverProfile?.vehicle_type || user.vehicle_type || 'keke',
        vehicleMake: user.vehicle_make || '',
        vehicleModel: user.vehicle_model || '',
        vehicleColor: user.vehicle_color || '',
        vehicleRegistration: driverProfile?.plate_number || user.vehicle_registration || '',
        operatingZones: driverProfile?.operating_zones || user.operating_zones || [],
        isVerified: Boolean(driverProfile?.verified),
        verificationStatus: driverProfile?.verified ? "verified" : "pending",
        isActive: Boolean(driverProfile?.verified),
        totalRides: driverProfile?.total_rides_completed || user.total_rides || 0,
        averageRating: driverProfile?.average_rating || user.average_rating || 0,
        walletBalance: user.wallet_balance || 0,
        bankAccount: driverProfile?.bank_name || user.bank_name ? {
          bankName: driverProfile?.bank_name || user.bank_name,
          accountNumber: driverProfile?.bank_account_number || user.bank_account_number || '',
          accountHolder: driverProfile?.account_name || user.bank_account_holder || '',
        } : undefined,
      };
    } else {
      userData = {
        ...baseUserData,
        role: 'rider' as const,
        homeAddress: user.home_address || user.homeAddress || '',
        workAddress: user.work_address || user.workAddress || '',
        emergencyContact: user.emergency_contact ? {
          name: user.emergency_contact,
          phone: user.emergency_phone || '',
        } : undefined,
        rideCount: user.ride_count || 0,
        averageRating: user.average_rating || 0,
        walletBalance: user.wallet_balance || 0,
      };
    }

    const responsePayload = {
      token,
      refreshToken: token,
      user: userData,
      message: "Login successful"
    };

    try {
      await sendPushNotification([user.id], {
        title: "Security Alert",
        body: `New login detected for your ${user.role} account.`,
        type: "security_alert",
        data: {
          action: "user_login_notification",
          loginMethod: email ? "email" : "phone",
          role: user.role,
        },
      });
    } catch (pushError) {
      console.warn("⚠️ [LOGIN] Push notification failed after login:", pushError);
    }
    
    console.log("📤 [LOGIN] Response being sent:", {
      hasToken: !!responsePayload.token,
      hasRefreshToken: !!responsePayload.refreshToken,
      hasUser: !!responsePayload.user,
      userRole: responsePayload.user?.role,
      userId: responsePayload.user?.id,
      userKeys: responsePayload.user ? Object.keys(responsePayload.user) : []
    });
    console.log("🔍 [LOGIN] Full user object:", JSON.stringify(responsePayload.user, null, 2));
    
    return NextResponse.json(responsePayload, { status: 200 });
  } catch (error) {
    console.error("❌ [LOGIN] Unexpected error:", error);
    if (error instanceof Error) {
      console.error("📋 [LOGIN] Error message:", error.message);
      console.error("📋 [LOGIN] Error stack:", error.stack);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

