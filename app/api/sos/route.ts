import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { notifyAdmins } from "@/lib/admin-notifications"
import { supabaseAdmin } from "@/lib/supabase"

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numberOrNull(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const location = body?.location && typeof body.location === "object" ? body.location : {}
    const address = body?.address && typeof body.address === "object" ? body.address : {}
    const device = body?.device && typeof body.device === "object" ? body.device : {}

    const { data: user } = await supabaseAdmin
      .from("users")
      .select("id, first_name, last_name, email, phone_number, role")
      .eq("id", session.user.id)
      .maybeSingle()

    const role = user?.role || session.user.role || null
    const userName =
      `${user?.first_name || session.user.firstName || ""} ${user?.last_name || session.user.lastName || ""}`.trim() ||
      "Charter Keke user"

    let activeRide: any = null
    if (role === "driver") {
      const { data } = await supabaseAdmin
        .from("rides")
        .select("id, status, rider_id, assigned_driver_id, driver_id, pickup_zone, destination_zone")
        .or(`assigned_driver_id.eq.${session.user.id},driver_id.eq.${session.user.id}`)
        .in("status", ["accepted", "in_progress", "dispatched"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      activeRide = data
    } else {
      const { data } = await supabaseAdmin
        .from("rides")
        .select("id, status, rider_id, assigned_driver_id, driver_id, pickup_zone, destination_zone")
        .eq("rider_id", session.user.id)
        .in("status", ["pending", "accepted", "in_progress", "dispatched"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      activeRide = data
    }

    let driverUser: any = null
    const driverReference = activeRide?.assigned_driver_id || activeRide?.driver_id
    if (driverReference) {
      const { data: directUser } = await supabaseAdmin
        .from("users")
        .select("id, first_name, last_name, phone_number")
        .eq("id", driverReference)
        .maybeSingle()
      driverUser = directUser

      if (!driverUser) {
        const { data: driver } = await supabaseAdmin
          .from("drivers")
          .select("user_id, users:user_id(id, first_name, last_name, phone_number)")
          .eq("id", driverReference)
          .maybeSingle()
        driverUser = Array.isArray((driver as any)?.users) ? (driver as any).users[0] : (driver as any)?.users
      }
    }

    const { data: alert, error } = await supabaseAdmin
      .from("sos_alerts")
      .insert({
        user_id: session.user.id,
        user_role: role,
        user_name: userName,
        user_email: user?.email || null,
        user_phone: user?.phone_number || null,
        latitude: numberOrNull(location.latitude ?? location.lat),
        longitude: numberOrNull(location.longitude ?? location.lng),
        accuracy: numberOrNull(location.accuracy),
        altitude: numberOrNull(location.altitude),
        heading: numberOrNull(location.heading),
        speed: numberOrNull(location.speed),
        full_address: text(address.fullAddress) || text(address.address) || text(body?.fullAddress),
        street: text(address.street),
        place_name: text(address.placeName) || text(address.name),
        city: text(address.city),
        region: text(address.region),
        country: text(address.country),
        postal_code: text(address.postalCode),
        active_ride_id: activeRide?.id || null,
        active_ride_status: activeRide?.status || null,
        active_ride_note: activeRide
          ? `${activeRide.pickup_zone || "Unknown pickup"} to ${activeRide.destination_zone || "Unknown destination"}`
          : "No active ride found at SOS time",
        driver_user_id: driverUser?.id || null,
        driver_name: driverUser ? `${driverUser.first_name || ""} ${driverUser.last_name || ""}`.trim() : null,
        driver_phone: driverUser?.phone_number || null,
        device_name: text(device.deviceName) || text(device.name),
        device_brand: text(device.brand),
        device_model: text(device.modelName) || text(device.model),
        os_name: text(device.osName),
        os_version: text(device.osVersion),
        app_version: text(device.appVersion),
        raw_location: location,
        raw_device: device,
        metadata: {
          source: body?.source || "mobile_app_backend",
          note: body?.note || null,
          appHost: "charterkeke.com",
        },
      })
      .select("*")
      .single()

    if (error || !alert) {
      return NextResponse.json({ error: error?.message || "Failed to create SOS alert" }, { status: 400 })
    }

    await notifyAdmins({
      allAdmins: true,
      department: "support",
      title: "SOS alert triggered",
      body: `${userName} triggered SOS${alert.full_address ? ` at ${alert.full_address}` : ""}.`,
      type: "sos_alert",
      actionUrl: `/admin/sos?alert=${alert.id}`,
      metadata: { sosAlertId: alert.id, userId: session.user.id, activeRideId: alert.active_ride_id },
      sourceEventId: `sos_alert:${alert.id}`,
      persist: false,
    })

    return NextResponse.json({ success: true, alert }, { status: 201 })
  } catch (error) {
    console.error("[SOS][POST]", error)
    return NextResponse.json({ error: "Failed to send SOS alert" }, { status: 500 })
  }
}
