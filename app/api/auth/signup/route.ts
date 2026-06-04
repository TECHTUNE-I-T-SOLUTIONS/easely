import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import bcrypt from "bcryptjs";
import { uploadFileWithServiceRole } from "@/lib/upload-file";
import { sendWelcomeEmail } from "@/lib/welcome-email";

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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    
    const firstName = formData.get("firstName") as string;
    const lastName = formData.get("lastName") as string;
    const email = formData.get("email") as string;
    const phone = formData.get("phone") as string;
    const password = formData.get("password") as string;
    const dob = formData.get("dob") as string;
    const gender = formData.get("gender") as string;
    const role = (formData.get("role") as string) || "user";
    const homeAddress = ((formData.get("homeAddress") as string) || "").trim();
    const workAddress = ((formData.get("workAddress") as string) || "").trim();
    const emergencyContactName = ((formData.get("emergencyContactName") as string) || "").trim();
    const emergencyContactPhone = ((formData.get("emergencyContactPhone") as string) || "").trim();

    // Driver fields
    const vehicleType = formData.get("vehicleType") as string;
    const plateNumber = formData.get("plateNumber") as string;
    const unionName = formData.get("unionName") as string;
    const bankName = formData.get("bankName") as string;
    const bankAccountNumber = formData.get("bankAccountNumber") as string;
    const accountName = (
      (formData.get("accountName") as string) ||
      (formData.get("bankAccountName") as string) ||
      (formData.get("accountHolder") as string) ||
      ""
    ).trim();
    const emergencyContact = formData.get("emergencyContact") as string;
    const operatingZones = ((formData.get("operatingZones") as string) || "").trim();

    // Admin fields
    const adminLevel = (formData.get("adminLevel") as string) || "support";

    // File uploads
    const profilePictureFile = formData.get("profilePicture") as File | null;
    const vehiclePictureFile = formData.get("vehiclePicture") as File | null;
    const licensePictureFile = formData.get("licensePicture") as File | null;

    // Validate input
    if (!firstName || !lastName || !email || !phone || !password) {
      console.warn("Signup validation failed: missing required fields", {
        firstName: !!firstName,
        lastName: !!lastName,
        email: !!email,
        phone: !!phone,
        password: !!password,
      });
      return errorResponse(400, "Missing required fields");
    }

    if (password.length < 8) {
      console.warn("Signup validation failed: password too short", {
        email,
        phone,
        passwordLength: password.length,
      });
      return errorResponse(400, "Password must be at least 8 characters");
    }

    // Validate role
    const validRoles = ["user", "driver", "admin"];
    if (!validRoles.includes(role)) {
      console.warn("Signup validation failed: invalid role", { email, phone, role });
      return errorResponse(400, "Invalid role");
    }

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .or(`email.eq.${email},phone_number.eq.${phone}`)
      .maybeSingle();

    if (existingUser) {
      console.warn("Signup validation failed: user already exists", { email, phone });
      return errorResponse(400, "Email or phone number already exists");
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate referral code
    const referralCode = `CHKE${firstName.substring(0, 2).toUpperCase()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // Upload profile picture if provided
    let profilePictureUrl: string | null = null;
    if (profilePictureFile && profilePictureFile.size > 0) {
      try {
        const buffer = Buffer.from(await profilePictureFile.arrayBuffer());
        const timestamp = Date.now();
        const filePath = `${email}/${timestamp}-profile.${profilePictureFile.name.split(".").pop()}`;
        
        const uploadResult = await uploadFileWithServiceRole(
          "profile-pictures",
          filePath,
          buffer,
          profilePictureFile.type
        );
        
        profilePictureUrl = uploadResult.url;
      } catch (uploadError) {
        console.error("Profile picture upload error:", uploadError);
        return NextResponse.json(
          { error: "Profile picture upload failed. Please try again." },
          { status: 502 }
        );
      }
    }

    let vehiclePictureUrl: string | null = null;
    if (vehiclePictureFile && vehiclePictureFile.size > 0) {
      try {
        const buffer = Buffer.from(await vehiclePictureFile.arrayBuffer());
        const timestamp = Date.now();
        const filePath = `${email}/${timestamp}-vehicle.${vehiclePictureFile.name.split(".").pop()}`;

        const uploadResult = await uploadFileWithServiceRole(
          "vehicle-pictures",
          filePath,
          buffer,
          vehiclePictureFile.type
        );

        vehiclePictureUrl = uploadResult.url;
      } catch (uploadError) {
        console.error("Vehicle picture upload error:", uploadError);
        return NextResponse.json(
          { error: "Vehicle picture upload failed. Please try again." },
          { status: 502 }
        );
      }
    }

    let licensePictureUrl: string | null = null;
    if (licensePictureFile && licensePictureFile.size > 0) {
      try {
        const buffer = Buffer.from(await licensePictureFile.arrayBuffer());
        const timestamp = Date.now();
        const filePath = `${email}/${timestamp}-license.${licensePictureFile.name.split(".").pop()}`;

        const uploadResult = await uploadFileWithServiceRole(
          "license-documents",
          filePath,
          buffer,
          licensePictureFile.type
        );

        licensePictureUrl = uploadResult.url;
      } catch (uploadError) {
        console.error("License picture upload error:", uploadError);
        return NextResponse.json(
          { error: "License picture upload failed. Please try again." },
          { status: 502 }
        );
      }
    }

    // Read optional referral code submitted by the client (referrer code)
    const incomingReferralCode = (formData.get("referralCode") as string) || '';

    // Create user
    const createPayload: Record<string, any> = {
      first_name: firstName,
      last_name: lastName,
      email,
      phone_number: phone,
      password_hash: hashedPassword,
      dob: dob || null,
      gender: gender || null,
      profile_picture_url: profilePictureUrl,
      role,
      status: "active",
      profile_complete: true,
      emergency_contact: emergencyContactName || null,
      emergency_phone: emergencyContactPhone || null,
    };

    let { data: newUser, error: createError } = await supabase
      .from("users")
      .insert(createPayload)
      .select()
      .single();

    if (createError && /home_address|work_address/i.test(createError.message || "")) {
      const payloadWithoutAddresses = { ...createPayload };
      delete payloadWithoutAddresses.home_address;
      delete payloadWithoutAddresses.work_address;

      const fallbackInsert = await supabase
        .from("users")
        .insert(payloadWithoutAddresses)
        .select()
        .single();

      newUser = fallbackInsert.data;
      createError = fallbackInsert.error;
    }

    if (createError) {
      console.error("Create user error:", createError);
      return errorResponse(500, createError.message || "Failed to create user", {
        code: createError.code,
        details: createError.details,
        hint: createError.hint,
      });
    }

    // If the client supplied a referral code (someone referred this signup),
    // log the usage via DB function so triggers update counts/notifications
    try {
      if (incomingReferralCode && incomingReferralCode.trim().length > 0) {
        const rpcResult = await supabase.rpc('log_referral_code_usage', {
          p_referral_code: incomingReferralCode.trim(),
          p_new_user_id: newUser.id,
        });

        if (rpcResult.error) {
          console.warn('Referral RPC warning:', rpcResult.error.message || rpcResult.error);
        }
      }
    } catch (rpcErr) {
      console.error('Referral RPC error:', rpcErr);
    }

    // Create wallet for new user (check if it exists first)
    const { data: existingWallet } = await supabase
      .from("wallets")
      .select("id")
      .eq("user_id", newUser.id)
      .maybeSingle();

    if (!existingWallet) {
      const { error: walletError } = await supabase.from("wallets").insert({
        user_id: newUser.id,
        balance: 0,
        currency: "NGN",
      });

      if (walletError) {
        console.error("Wallet creation error:", walletError);
      }
    }

    // Create notification preferences (check if it exists first)
    const { data: existingNotif } = await supabase
      .from("notification_preferences")
      .select("id")
      .eq("user_id", newUser.id)
      .maybeSingle();

    if (!existingNotif) {
      const { error: notifError } = await supabase.from("notification_preferences").insert({
        user_id: newUser.id,
        push_enabled: true,
        sms_enabled: true,
        email_enabled: true,
      });

      if (notifError) {
        console.error("Notification preferences error:", notifError);
      }
    }

    // Create referral record for the user
    const { error: referralError } = await supabase.from("referrals").insert({
      referrer_id: newUser.id,
      referral_code: referralCode,
      status: "pending",
    });

    if (referralError) {
      console.error("Referral creation error:", referralError);
    }

    // Create role-specific records
    if (role === "driver") {
      const driverEmergencyContact = emergencyContact || emergencyContactName || emergencyContactPhone || null;

      const { error: driverError } = await supabase.from("drivers").insert({
        user_id: newUser.id,
        vehicle_type: vehicleType || null,
        plate_number: plateNumber || null,
        union_name: unionName || null,
        operating_zones: operatingZones
          ? operatingZones.split(",").map((zone) => zone.trim()).filter(Boolean)
          : [],
        bank_name: bankName || null,
        bank_account_number: bankAccountNumber || null,
        account_name: accountName || null,
        emergency_contact: driverEmergencyContact,
        vehicle_picture_url: vehiclePictureUrl,
        license_picture_url: licensePictureUrl,
        verified: false,
      });

      if (driverError) {
        console.error("Driver record creation error:", driverError);
      }
    }

    if (role === "admin") {
      const { error: adminError } = await supabase.from("admins").insert({
        user_id: newUser.id,
        admin_level: adminLevel,
        permissions: {},
      });

      if (adminError) {
        console.error("Admin record creation error:", adminError);
      }
    }

    sendWelcomeEmail({
      id: newUser.id,
      firstName,
      lastName,
      email,
      phone,
      role,
      referralCode,
      plateNumber: plateNumber || null,
      vehicleType: vehicleType || null,
      operatingZones: operatingZones || null,
    }).catch((emailError) => {
      console.error("Welcome email send failed:", emailError);
    });

    return NextResponse.json(
      {
        success: true,
        user: {
          id: newUser.id,
          email: newUser.email,
          firstName: newUser.first_name,
          lastName: newUser.last_name,
          phone: newUser.phone_number,
          dob: newUser.dob,
          gender: newUser.gender,
          profilePictureUrl: newUser.profile_picture_url,
          homeAddress: (newUser as any).home_address || "",
          workAddress: (newUser as any).work_address || "",
          emergencyContactName: (newUser as any).emergency_contact || "",
          emergencyContactPhone: (newUser as any).emergency_phone || "",
          role: newUser.role,
          referralCode: referralCode,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Signup error:", error);
    return errorResponse(
      500,
      error instanceof Error ? error.message : "Internal server error"
    );
  }
}

