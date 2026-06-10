import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { notifyAdmins } from "@/lib/admin-notifications"
import { supabaseAdmin } from "@/lib/supabase"
import { sendPushNotification } from "@/lib/push-service"

interface RouteParams {
  params: Promise<{ rideId: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { rideId } = await params
    if (!rideId) {
      return NextResponse.json({ error: "Ride ID is required" }, { status: 400 })
    }

    const { data: ride, error } = await supabaseAdmin!
      .from("rides")
      .select(
        `
        *,
        drivers:driver_id (
          id,
          user_id,
          vehicle_type,
          plate_number,
          vehicle_picture_url,
          average_rating,
          users:user_id (
            first_name,
            last_name,
            phone_number,
            profile_picture_url
          )
        )
      `
      )
      .eq("id", rideId)
      .single()

    if (error || !ride) {
      return NextResponse.json({ error: "Ride not found" }, { status: 404 })
    }

    const canView =
      ride.rider_id === session.user.id ||
      ride.drivers?.user_id === session.user.id ||
      session.user.role === "admin" ||
      session.user.role === "super_admin"

    if (!canView) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    return NextResponse.json({ ride })
  } catch (error) {
    console.error("[Rides/:id][GET] error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { rideId } = await params
    if (!rideId) {
      return NextResponse.json({ error: "Ride ID is required" }, { status: 400 })
    }

    const body = await request.json()
    const status = body?.status as string | undefined
    const cancellationReason = body?.cancellationReason as string | undefined

    if (!status) {
      return NextResponse.json({ error: "Status is required" }, { status: 400 })
    }

    const { data: existingRide, error: fetchError } = await supabaseAdmin!
      .from("rides")
      .select("id, rider_id, assigned_driver_id, status")
      .eq("id", rideId)
      .single()

    if (fetchError || !existingRide) {
      return NextResponse.json({ error: "Ride not found" }, { status: 404 })
    }

    if (status === "cancelled") {
      const isRider = existingRide.rider_id === session.user.id
      const isAdmin = session.user.role === "admin" || session.user.role === "super_admin"

      if (!isRider && !isAdmin) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }

      if (["completed", "cancelled"].includes(existingRide.status)) {
        return NextResponse.json(
          { error: `Ride cannot be cancelled from ${existingRide.status} state` },
          { status: 409 }
        )
      }

      const { data: updatedRide, error: updateError } = await supabaseAdmin!
        .from("rides")
        .update({
          status: "cancelled",
          cancellation_reason: cancellationReason || "User cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", rideId)
        .select("*")
        .single()

      if (updateError) {
        console.error("[Rides/:id][PUT] cancel error:", updateError)
        return NextResponse.json({ error: "Failed to cancel ride" }, { status: 500 })
      }

      const cancellationTargets = [existingRide.rider_id]
      if (existingRide.assigned_driver_id && existingRide.assigned_driver_id !== existingRide.rider_id) {
        cancellationTargets.push(existingRide.assigned_driver_id)
      }

      try {
        await sendPushNotification(cancellationTargets, {
          title: "Ride Cancelled",
          body: cancellationReason || "The ride has been cancelled.",
          type: "ride_cancelled",
          data: {
            rideId,
            cancellationReason: cancellationReason || "User cancelled",
            action: "ride_cancelled_notification",
          },
        })
      } catch (pushError) {
        console.warn("[Rides/:id][PUT] cancellation push failed:", pushError)
      }

      await notifyAdmins({
        allAdmins: true,
        department: "ops",
        title: "Ride cancelled",
        body: `Ride ${rideId.slice(0, 8)} was cancelled. ${cancellationReason || "User cancelled"}.`,
        type: "ride_cancelled",
        actionUrl: `/admin/rides?ride=${rideId}`,
        metadata: {
          rideId,
          riderId: existingRide.rider_id,
          driverUserId: existingRide.assigned_driver_id,
          cancellationReason: cancellationReason || "User cancelled",
        },
        sourceEventId: `ride_cancelled:${rideId}`,
      }).catch((notifyError) => console.error("[Rides/:id][PUT] Admin notification failed:", notifyError))

      return NextResponse.json({ success: true, ride: updatedRide })
    }

    return NextResponse.json({ error: "Unsupported status update" }, { status: 400 })
  } catch (error) {
    console.error("[Rides/:id][PUT] error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
