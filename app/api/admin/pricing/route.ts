import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getSessionFromRequest } from "@/lib/auth"


// GET - Fetch all pricing settings (for super admins)
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

    const { data: settings, error } = await supabaseAdmin
      .from("pricing_settings")
      .select(`
        *,
        distance_bands(max_km, rate, sort_order)
      `)
      .order("updated_at", { ascending: false })

    if (error) throw error

    return NextResponse.json({ settings })
  } catch (error) {
    console.error("[PricingAdmin] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch pricing settings" }, { status: 500 })
  }
}

// POST - Create new pricing setting (for super admins)
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
      baseFare,
      minimumFare,
      perMinute,
      platformFeeRate,
      etaLowTrafficMinPerKm,
      etaNormalTrafficMinPerKm,
      etaHeavyTrafficMinPerKm,
      learningWeight,
      distanceBands,
      currency = 'NGN',
      effectiveFrom,
      effectiveUntil,
      notes
    } = body

    // Deactivate existing active settings
    await supabaseAdmin
      .from("pricing_settings")
      .update({ is_active: false })
      .eq("is_active", true)

    // Create new pricing setting
    const { data: setting, error: settingError } = await supabaseAdmin
      .from("pricing_settings")
      .insert({
        name,
        base_fare: baseFare,
        minimum_fare: minimumFare,
        per_minute: perMinute,
        platform_fee_rate: platformFeeRate,
        eta_low_traffic_min_per_km: etaLowTrafficMinPerKm,
        eta_normal_traffic_min_per_km: etaNormalTrafficMinPerKm,
        eta_heavy_traffic_min_per_km: etaHeavyTrafficMinPerKm,
        learning_weight: learningWeight,
        currency,
        effective_from: effectiveFrom,
        effective_until: effectiveUntil,
        notes,
        is_active: true,
        created_by: session.user.id,
        updated_by: session.user.id
      })
      .select()
      .single()

    if (settingError) throw settingError

    // Create distance bands
    if (distanceBands && Array.isArray(distanceBands)) {
      const bandsToInsert = distanceBands.map((band: any, index: number) => ({
        pricing_setting_id: setting.id,
        max_km: band.maxKm,
        rate: band.rate,
        sort_order: band.sortOrder || index
      }))

      const { error: bandsError } = await supabaseAdmin
        .from("distance_bands")
        .insert(bandsToInsert)

      if (bandsError) throw bandsError
    }

    // Log the change in audit
    await supabaseAdmin
      .from("ride_pricing_audit")
      .insert({
        pricing_setting_id: setting.id,
        admin_user_id: session.user.id,
        action: "created",
        previous_values: {},
        next_values: body
      })

    return NextResponse.json({ setting })
  } catch (error) {
    console.error("[PricingAdmin] POST error:", error)
    return NextResponse.json({ error: "Failed to create pricing setting" }, { status: 500 })
  }
}

// PUT - Update pricing setting (for super admins)
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
      return NextResponse.json({ error: "Setting ID required" }, { status: 400 })
    }

    // Get current setting for audit
    const { data: currentSetting, error: fetchError } = await supabaseAdmin
      .from("pricing_settings")
      .select("*")
      .eq("id", id)
      .single()

    if (fetchError || !currentSetting) {
      return NextResponse.json({ error: "Setting not found" }, { status: 404 })
    }

    // Update setting
    const { data: setting, error: updateError } = await supabaseAdmin
      .from("pricing_settings")
      .update({
        ...updateData,
        updated_by: session.user.id,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .select()
      .single()

    if (updateError) throw updateError

    // Update distance bands if provided
    if (updateData.distanceBands && Array.isArray(updateData.distanceBands)) {
      // Delete existing bands
      await supabaseAdmin
        .from("distance_bands")
        .delete()
        .eq("pricing_setting_id", id)

      // Insert new bands
      const bandsToInsert = updateData.distanceBands.map((band: any, index: number) => ({
        pricing_setting_id: id,
        max_km: band.maxKm,
        rate: band.rate,
        sort_order: band.sortOrder || index
      }))

      const { error: bandsError } = await supabaseAdmin
        .from("distance_bands")
        .insert(bandsToInsert)

      if (bandsError) throw bandsError
    }

    // Log the change in audit
    await supabaseAdmin
      .from("ride_pricing_audit")
      .insert({
        pricing_setting_id: id,
        admin_user_id: session.user.id,
        action: "updated",
        previous_values: currentSetting,
        next_values: updateData
      })

    return NextResponse.json({ setting })
  } catch (error) {
    console.error("[PricingAdmin] PUT error:", error)
    return NextResponse.json({ error: "Failed to update pricing setting" }, { status: 500 })
  }
}

// DELETE - Delete pricing setting (for super admins)
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
      return NextResponse.json({ error: "Setting ID required" }, { status: 400 })
    }

    // Don't allow deletion of active settings
    const { data: setting, error: fetchError } = await supabaseAdmin
      .from("pricing_settings")
      .select("is_active")
      .eq("id", id)
      .single()

    if (fetchError || !setting) {
      return NextResponse.json({ error: "Setting not found" }, { status: 404 })
    }

    if (setting.is_active) {
      return NextResponse.json({ error: "Cannot delete active pricing setting" }, { status: 400 })
    }

    // Delete distance bands first
    await supabaseAdmin
      .from("distance_bands")
      .delete()
      .eq("pricing_setting_id", id)

    // Delete setting
    const { error: deleteError } = await supabaseAdmin
      .from("pricing_settings")
      .delete()
      .eq("id", id)

    if (deleteError) throw deleteError

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[PricingAdmin] DELETE error:", error)
    return NextResponse.json({ error: "Failed to delete pricing setting" }, { status: 500 })
  }
}