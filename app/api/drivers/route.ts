import { NextRequest, NextResponse } from "next/server";
import { supabase, supabaseAdmin } from "@/lib/supabase";
import { uploadFileWithServiceRole } from "@/lib/upload-file";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const summaryOnly = searchParams.get("summary") !== "false";

    const { data: drivers, error } = await supabaseAdmin
      .from("drivers")
      .select("id, availability_status, verified, vehicle_type, operating_zones, updated_at")
      .eq("verified", true);

    if (error) {
      console.error("Error fetching driver availability summary:", error);
      return NextResponse.json(
        { error: "Failed to fetch driver availability" },
        { status: 500 }
      );
    }

    const safeDrivers = drivers || [];
    const activeDrivers = safeDrivers.filter((driver: any) =>
      ["online", "available", "active"].includes(String(driver.availability_status || "").toLowerCase())
    );

    const payload = {
      activeDrivers: activeDrivers.length,
      active_drivers: activeDrivers.length,
      totalVerifiedDrivers: safeDrivers.length,
      drivers: summaryOnly
        ? []
        : safeDrivers.map((driver: any) => ({
            id: driver.id,
            availability_status: driver.availability_status,
            vehicle_type: driver.vehicle_type,
            operating_zones: driver.operating_zones || [],
            updated_at: driver.updated_at,
          })),
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("Driver availability summary error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    
    const userId = formData.get("userId") as string;
    const vehicleType = formData.get("vehicleType") as string;
    const plateNumber = formData.get("plateNumber") as string;
    const guarantorName = ((formData.get("guarantorName") as string) || "").trim();
    const guarantorPhone = ((formData.get("guarantorPhone") as string) || "").trim();
    const guarantorAddress = ((formData.get("guarantorAddress") as string) || "").trim();
    const nin = ((formData.get("nin") as string) || "").replace(/\D/g, "");
    const operatingZonesStr = formData.get("operatingZones") as string;
    const bankName = formData.get("bankName") as string;
    const bankCode = ((formData.get("bankCode") as string) || "").trim();
    const bankAccountNumber = formData.get("bankAccountNumber") as string;
    const emergencyContact = formData.get("emergencyContact") as string;

    // File uploads
    const vehiclePictureFile = formData.get("vehiclePicture") as File | null;
    const licensePictureFile = formData.get("licensePicture") as File | null;

    // Validate required fields
    if (!userId || !vehicleType || !plateNumber || !bankName || !bankCode || !bankAccountNumber || !guarantorName || !guarantorPhone || !guarantorAddress || nin.length !== 11 || !emergencyContact) {
      console.error("Missing driver fields:", {
        userId: userId ? "✓" : "missing",
        vehicleType: vehicleType ? "✓" : "missing",
        plateNumber: plateNumber ? "✓" : "missing",
        guarantorName: guarantorName ? "ok" : "missing",
        guarantorPhone: guarantorPhone ? "ok" : "missing",
        guarantorAddress: guarantorAddress ? "ok" : "missing",
        nin: nin.length === 11 ? "ok" : "missing",
        bankName: bankName ? "✓" : "missing",
        bankCode: bankCode ? "ok" : "missing",
        bankAccountNumber: bankAccountNumber ? "✓" : "missing",
        operatingZones: operatingZonesStr ? "✓" : "missing",
        emergencyContact: emergencyContact ? "✓" : "missing",
      })
      return NextResponse.json(
        { 
          error: "Missing required driver fields",
          details: {
            userId: !userId ? "User ID required" : null,
            vehicleType: !vehicleType ? "Vehicle type required" : null,
            plateNumber: !plateNumber ? "Plate number required" : null,
            guarantorName: !guarantorName ? "Guarantor name required" : null,
            guarantorPhone: !guarantorPhone ? "Guarantor phone required" : null,
            guarantorAddress: !guarantorAddress ? "Guarantor address required" : null,
            nin: nin.length !== 11 ? "Valid 11-digit NIN required" : null,
            bankName: !bankName ? "Bank name required" : null,
            bankCode: !bankCode ? "Bank code required" : null,
            bankAccountNumber: !bankAccountNumber ? "Bank account number required" : null,
            emergencyContact: !emergencyContact ? "Emergency contact required" : null,
          }
        },
        { status: 400 }
      );
    }

    if (!vehiclePictureFile || vehiclePictureFile.size === 0) {
      return NextResponse.json(
        { error: "Vehicle picture is required" },
        { status: 400 }
      );
    }

    if (!licensePictureFile || licensePictureFile.size === 0) {
      return NextResponse.json(
        { error: "License picture is required" },
        { status: 400 }
      );
    }

    // Parse operating zones
    let operatingZones: string[] = [];
    try {
      operatingZones = JSON.parse(operatingZonesStr || "[]");
    } catch {
      operatingZones = [];
    }

    // Upload vehicle picture if provided
    let vehiclePictureUrl: string | null = null;
    if (vehiclePictureFile && vehiclePictureFile.size > 0) {
      try {
        const buffer = Buffer.from(await vehiclePictureFile.arrayBuffer());
        const timestamp = Date.now();
        const filePath = `${userId}/${timestamp}-vehicle.${vehiclePictureFile.name.split(".").pop()}`;
        
        const uploadResult = await uploadFileWithServiceRole(
          "vehicle-pictures",
          filePath,
          buffer,
          vehiclePictureFile.type
        );
        vehiclePictureUrl = uploadResult.url;
      } catch (error) {
        console.error("Error uploading vehicle picture:", error);
        return NextResponse.json(
          { error: "Vehicle picture upload failed. Please try again." },
          { status: 502 }
        );
      }
    }

    // Upload license picture if provided
    let licensePictureUrl: string | null = null;
    if (licensePictureFile && licensePictureFile.size > 0) {
      try {
        const buffer = Buffer.from(await licensePictureFile.arrayBuffer());
        const timestamp = Date.now();
        const filePath = `${userId}/${timestamp}-license.${licensePictureFile.name.split(".").pop()}`;
        
        const uploadResult = await uploadFileWithServiceRole(
          "license-documents",
          filePath,
          buffer,
          licensePictureFile.type
        );
        licensePictureUrl = uploadResult.url;
      } catch (error) {
        console.error("Error uploading license picture:", error);
        return NextResponse.json(
          { error: "License picture upload failed. Please try again." },
          { status: 502 }
        );
      }
    }

    // Create driver profile
    const { data, error } = await supabase
      .from("drivers")
      .insert([
        {
          user_id: userId,
          vehicle_type: vehicleType,
          plate_number: plateNumber,
          guarantor_name: guarantorName,
          guarantor_phone: guarantorPhone,
          guarantor_address: guarantorAddress,
          operating_zones: operatingZones,
          bank_name: bankName,
          bank_code: bankCode,
          bank_account_number: bankAccountNumber,
          emergency_contact: emergencyContact,
          vehicle_picture_url: vehiclePictureUrl,
          license_picture_url: licensePictureUrl,
          verified: false,
          identity_type: "nin",
          nin_number: nin || null,
          identity_last4: nin.slice(-4),
          identity_verification_status: "pending_details",
          identity_verification_provider: "manual_admin",
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("Error creating driver profile:", error);
      return NextResponse.json(
        { error: "Failed to create driver profile" },
        { status: 500 }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Driver creation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}


