import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import crypto from "crypto"
import { supabase } from "@/lib/supabase"
import { CRM_DEPARTMENTS, type CrmDepartmentKey } from "@/lib/crm"

/**
 * POST /api/auth/admin/request-access
 * Admin signup request - pending approval from super admin
 * Creates entry in both users and admins tables with complete profile
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      firstName,
      lastName,
      email,
      phone,
      password,
      emergencyContact,
      emergencyPhone,
      adminLevel = "support",
      department = "general",
      reason,
    } = body

    // Validate all required fields
    if (
      !firstName ||
      !lastName ||
      !email ||
      !phone ||
      !password ||
      !emergencyContact ||
      !emergencyPhone ||
      !adminLevel ||
      !reason
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // Validate admin level
    const validLevels = ["support", "ops", "finance", "super"]
    if (!validLevels.includes(adminLevel)) {
      return NextResponse.json(
        { error: "Invalid admin level" },
        { status: 400 }
      )
    }

    const requestedDepartment = String(department || "general")
    const normalizedDepartment: CrmDepartmentKey =
      CRM_DEPARTMENTS.some((entry) => entry.key === requestedDepartment)
        ? (requestedDepartment as CrmDepartmentKey)
        : "general"

    // Check if email already exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .single()

    if (existingUser) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 }
      )
    }

    // Check if phone already exists
    const { data: existingPhone } = await supabase
      .from("users")
      .select("id")
      .eq("phone_number", phone)
      .single()

    if (existingPhone) {
      return NextResponse.json(
        { error: "Phone number already registered" },
        { status: 409 }
      )
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10)

    // Create user in users table with role='admin' and status='pending'
    const { data: newUser, error: userError } = await supabase
      .from("users")
      .insert([
        {
          email,
          phone_number: phone,
          first_name: firstName,
          last_name: lastName,
          password_hash: passwordHash,
          emergency_contact: emergencyContact,
          emergency_phone: emergencyPhone,
          role: "admin",
          status: "pending", // Pending super admin approval
          profile_complete: false,
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single()

    if (userError) {
      console.error("User creation error:", userError)
      return NextResponse.json(
        { error: "Failed to create user account" },
        { status: 500 }
      )
    }

    // Create admin record in admins table with the reason stored in permissions
    const { data: adminRecord, error: adminError } = await supabase
      .from("admins")
      .insert([
        {
          user_id: newUser.id,
          admin_level: adminLevel,
          department: normalizedDepartment,
          permissions: {
            request_reason: reason,
            request_date: new Date().toISOString(),
            status: "pending_review",
            department: normalizedDepartment,
          },
        },
      ])
      .select()
      .single()

    if (adminError) {
      console.error("Admin record creation error:", adminError)
      // If admin record fails, we should ideally delete the user, but for now we'll return error
      return NextResponse.json(
        { error: "Failed to create admin record" },
        { status: 500 }
      )
    }

    // TODO: Send email notification to super admin about new admin request

    return NextResponse.json(
      {
        success: true,
        message: "Admin access request submitted for approval",
        data: {
          userId: newUser.id,
          adminId: adminRecord.id,
          department: normalizedDepartment,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Admin request error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
