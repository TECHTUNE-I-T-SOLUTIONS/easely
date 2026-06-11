import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json({ error: "Database connection not available" }, { status: 500 });
    }
    const session = await getSessionFromRequest(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const profilePictureFile = formData.get("profile_picture") as File | null;
    const vehicleType = formData.get("vehicle_type") as string | null;
    const plateNumber = formData.get("plate_number") as string | null;
    const operatingZones = formData.get("operating_zones") as string | null;
    const guarantorName = formData.get("guarantor_name") as string | null;
    const guarantorPhone = formData.get("guarantor_phone") as string | null;
    const guarantorAddress = formData.get("guarantor_address") as string | null;
    const emergencyContact = formData.get("emergency_contact") as string | null;
    const bankName = formData.get("bank_name") as string | null;
    const bankAccountNumber = formData.get("bank_account_number") as string | null;

    let profilePictureUrl: string | null = null;

    // Handle profile picture upload if provided
    if (profilePictureFile) {
      if (!profilePictureFile.type.startsWith("image/")) {
        return NextResponse.json(
          { error: "Profile picture must be an image" },
          { status: 400 }
        );
      }

      if (profilePictureFile.size > 5 * 1024 * 1024) {
        return NextResponse.json(
          { error: "Profile picture must be less than 5MB" },
          { status: 400 }
        );
      }

      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(7);
      const filename = `${session.user.id}/profile/${timestamp}-${randomString}-${profilePictureFile.name}`;

      const arrayBuffer = await profilePictureFile.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const { error: uploadError } = await supabaseAdmin.storage
        .from("profile-pictures")
        .upload(filename, buffer, {
          contentType: profilePictureFile.type,
          cacheControl: "3600",
        });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        return NextResponse.json(
          { error: "Failed to upload profile picture" },
          { status: 500 }
        );
      }

      const { data: urlData } = supabaseAdmin.storage
        .from("profile-pictures")
        .getPublicUrl(filename);

      profilePictureUrl = urlData?.publicUrl || null;
    }

    // Update user profile
    const { error: userError } = await supabaseAdmin
      .from("users")
      .update({
        profile_picture_url: profilePictureUrl,
        profile_complete: true,
        status: "active",
      })
      .eq("id", session.user.id);

    if (userError) {
      return NextResponse.json(
        { error: "Failed to update profile" },
        { status: 500 }
      );
    }

    // If driver role, update driver profile
    if (vehicleType || plateNumber || operatingZones) {
      const { data: driver } = await supabaseAdmin
        .from("drivers")
        .select("id")
        .eq("user_id", session.user.id)
        .single();

      if (driver) {
        const { error: driverError } = await supabaseAdmin
          .from("drivers")
          .update({
            vehicle_type: vehicleType,
            plate_number: plateNumber,
            operating_zones: operatingZones
              ? operatingZones.split(",").map((z) => z.trim())
              : [],
            guarantor_name: guarantorName,
            guarantor_phone: guarantorPhone,
            guarantor_address: guarantorAddress,
            emergency_contact: emergencyContact,
            bank_name: bankName,
            bank_account_number: bankAccountNumber,
          })
          .eq("id", driver.id);

        if (driverError) {
          return NextResponse.json(
            { error: "Failed to update driver profile" },
            { status: 500 }
          );
        }
      }
    }

    return NextResponse.json(
      {
        message: "Profile completed successfully",
        profilePictureUrl,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Profile completion error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
