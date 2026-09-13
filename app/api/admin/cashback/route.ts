import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getSessionFromRequest } from "@/lib/auth"

import { 
  sendCashbackRewardNotification,
  sendExpiringCashbackNotification,
  sendExpiredCashbackNotification 
} from "@/lib/cashback-notifications"

// GET - Fetch all cashback programs (for super admins)
export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Check if user is super admin
    const { data: admin, error: adminError } = await supabaseAdmin
      .from("admins")
      .select("admin_level, user_id")
      .eq("user_id", session.user.id)
      .single()

    if (adminError || !admin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })
    }

    const userRole = admin.admin_level === 'super' ? 'super_admin' : 'admin'
    if (userRole !== 'super_admin' && admin.admin_level !== 'super') {
      return NextResponse.json({ error: "Super admin access required" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type")
    const active = searchParams.get("active")

    let query = supabaseAdmin
      .from("cashback_programs")
      .select("*")
      .order("created_at", { ascending: false })

    if (type) {
      query = query.eq("program_type", type)
    }

    if (active !== null) {
      query = query.eq("is_active", active === "true")
    }

    const { data: programs, error } = await query

    if (error) throw error

    return NextResponse.json({ programs })
  } catch (error) {
    console.error("[CashbackAdmin] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch cashback programs" }, { status: 500 })
  }
}

// POST - Create new cashback program (for super admins)
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Check if user is super admin
    const { data: admin, error: adminError } = await supabaseAdmin
      .from("admins")
      .select("admin_level, user_id")
      .eq("user_id", session.user.id)
      .single()

    if (adminError || !admin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })
    }

    const userRole = admin.admin_level === 'super' ? 'super_admin' : 'admin'
    if (userRole !== 'super_admin' && admin.admin_level !== 'super') {
      return NextResponse.json({ error: "Super admin access required" }, { status: 403 })
    }

    const body = await request.json()
    const {
      name,
      description,
      programType,
      discountPercentage,
      maxDiscountAmount,
      minOrderAmount,
      validAfterRides,
      validForRidesCount,
      expiryDays,
      startDate,
      endDate,
      terms,
      imageUrl,
      priority
    } = body

    const { data: program, error } = await supabaseAdmin
      .from("cashback_programs")
      .insert({
        name,
        description,
        program_type: programType,
        discount_percentage: discountPercentage,
        max_discount_amount: maxDiscountAmount,
        min_order_amount: minOrderAmount || 0,
        valid_after_rides: validAfterRides || 0,
        valid_for_rides_count: validForRidesCount || 1,
        expiry_days: expiryDays,
        start_date: startDate,
        end_date: endDate,
        terms,
        image_url: imageUrl,
        priority: priority || 0,
        is_active: true,
        created_by: session.user.id,
        updated_by: session.user.id
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ program })
  } catch (error) {
    console.error("[CashbackAdmin] POST error:", error)
    return NextResponse.json({ error: "Failed to create cashback program" }, { status: 500 })
  }
}

// PUT - Update cashback program (for super admins)
export async function PUT(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Check if user is super admin
    const { data: admin, error: adminError } = await supabaseAdmin
      .from("admins")
      .select("admin_level, user_id")
      .eq("user_id", session.user.id)
      .single()

    if (adminError || !admin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })
    }

    const userRole = admin.admin_level === 'super' ? 'super_admin' : 'admin'
    if (userRole !== 'super_admin' && admin.admin_level !== 'super') {
      return NextResponse.json({ error: "Super admin access required" }, { status: 403 })
    }

    const body = await request.json()
    const { id, ...updateData } = body

    if (!id) {
      return NextResponse.json({ error: "Program ID required" }, { status: 400 })
    }

    const { data: program, error } = await supabaseAdmin
      .from("cashback_programs")
      .update({
        ...updateData,
        updated_by: session.user.id,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ program })
  } catch (error) {
    console.error("[CashbackAdmin] PUT error:", error)
    return NextResponse.json({ error: "Failed to update cashback program" }, { status: 500 })
  }
}

// DELETE - Delete cashback program (for super admins)
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Check if user is super admin
    const { data: admin, error: adminError } = await supabaseAdmin
      .from("admins")
      .select("admin_level, user_id")
      .eq("user_id", session.user.id)
      .single()

    if (adminError || !admin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })
    }

    const userRole = admin.admin_level === 'super' ? 'super_admin' : 'admin'
    if (userRole !== 'super_admin' && admin.admin_level !== 'super') {
      return NextResponse.json({ error: "Super admin access required" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "Program ID required" }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from("cashback_programs")
      .delete()
      .eq("id", id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[CashbackAdmin] DELETE error:", error)
    return NextResponse.json({ error: "Failed to delete cashback program" }, { status: 500 })
  }
}

// POST - Manually trigger expiry notification check (for super admins)
export async function PATCH(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Check if user is super admin
    const { data: admin, error: adminError } = await supabaseAdmin
      .from("admins")
      .select("admin_level, user_id")
      .eq("user_id", session.user.id)
      .single()

    if (adminError || !admin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })
    }

    const userRole = admin.admin_level === 'super' ? 'super_admin' : 'admin'
    if (userRole !== 'super_admin' && admin.admin_level !== 'super') {
      return NextResponse.json({ error: "Super admin access required" }, { status: 403 })
    }

    const body = await request.json()
    const { action } = body

    if (action === "check_expiring") {
      // Check for expiring cashback rewards
      const { checkExpiringCashbackRewards } = await import("@/lib/cashback-notifications")
      await checkExpiringCashbackRewards()
      return NextResponse.json({ success: true, message: "Expiry check completed" })
    }

    if (action === "mark_expired") {
      // Mark expired cashback rewards
      const { markExpiredCashbackRewards } = await import("@/lib/cashback-notifications")
      await markExpiredCashbackRewards()
      return NextResponse.json({ success: true, message: "Expired rewards marked" })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("[CashbackAdmin] PATCH error:", error)
    return NextResponse.json({ error: "Failed to perform action" }, { status: 500 })
  }
}