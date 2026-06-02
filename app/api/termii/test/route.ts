import { type NextRequest, NextResponse } from "next/server"
import { sendSMS, sendRideRequestSMS, toTermiiPhoneNumber } from "@/lib/termii"

/**
 * Test endpoint for Termii SMS integration
 * POST with test data to verify SMS delivery
 * 
 * Example request:
 * {
 *   "testType": "simple",
 *   "phone": "+234901234567",
 *   "message": "Test message"
 * }
 * 
 * Or for ride request:
 * {
 *   "testType": "ride",
 *   "phone": "+234901234567",
 *   "rideId": "550e8400-e29b-41d4-a716-446655440000",
 *   "pickup": "Lekki Phase 1",
 *   "destination": "VI",
 *   "pickupTime": "2026-06-02T14:20:00.000Z",
 *   "fare": 2500
 * }
 */

export async function POST(request: NextRequest) {
  // Check if this is a development/testing endpoint
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Test endpoint not available in production" },
      { status: 403 }
    )
  }

  try {
    const body = await request.json()
    const { testType, phone, message, rideId, pickup, destination, pickupTime, fare } = body

    if (!phone) {
      return NextResponse.json(
        { error: "Phone number is required" },
        { status: 400 }
      )
    }

    const normalizedPhone = toTermiiPhoneNumber(phone)
    if (!normalizedPhone) {
      return NextResponse.json(
        { error: `Invalid phone number: ${phone}` },
        { status: 400 }
      )
    }

    console.log("[Termii Test] Starting test", {
      testType,
      phone: normalizedPhone,
    })

    let result: any = null

    if (testType === "simple") {
      if (!message) {
        return NextResponse.json(
          { error: "Message is required for simple test" },
          { status: 400 }
        )
      }

      console.log("[Termii Test] Sending simple SMS", {
        to: normalizedPhone,
        message,
      })

      result = await sendSMS({
        to: normalizedPhone,
        message,
        channel: "dnd",
        type: "plain",
      })
    } else if (testType === "ride") {
      if (!rideId || !pickup || !destination || !fare) {
        return NextResponse.json(
          {
            error: "rideId, pickup, destination, and fare are required for ride test",
          },
          { status: 400 }
        )
      }

      console.log("[Termii Test] Sending ride request SMS", {
        to: normalizedPhone,
        rideId,
        pickup,
        destination,
        pickupTime,
        fare,
      })

      result = await sendRideRequestSMS({
        to: normalizedPhone,
        rideId,
        pickup,
        destination,
        pickupTime,
        fare: Number(fare),
      })
    } else {
      return NextResponse.json(
        { error: "testType must be 'simple' or 'ride'" },
        { status: 400 }
      )
    }

    console.log("[Termii Test] SMS sent successfully", {
      result,
      phone: normalizedPhone,
    })

    return NextResponse.json({
      success: true,
      message: "SMS sent successfully",
      normalizedPhone,
      termiiResponse: result,
    })
  } catch (error) {
    console.error("[Termii Test] Error:", error)
    const errorMessage = error instanceof Error ? error.message : String(error)

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        hint: "Check console logs and Termii dashboard for API key and credits",
      },
      { status: 500 }
    )
  }
}

/**
 * GET endpoint to show test instructions
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Test endpoint not available in production" },
      { status: 403 }
    )
  }

  return NextResponse.json({
    endpoint: "/api/termii/test",
    method: "POST",
    tests: {
      simple: {
        description: "Send a simple test SMS",
        payload: {
          testType: "simple",
          phone: "+234901234567",
          message: "Test SMS from Charter Keke",
        },
      },
      ride: {
        description: "Send a ride request SMS",
        payload: {
          testType: "ride",
          phone: "+234901234567",
          rideId: "550e8400-e29b-41d4-a716-446655440000",
          pickup: "Lekki Phase 1",
          destination: "Victoria Island",
          fare: 2500,
        },
      },
    },
    notes: [
      "This endpoint is only available in development",
      "Use phone numbers in international format or Nigerian format",
      "Check Termii dashboard for API balance",
      "SMS will be sent via DND (transactional) channel",
    ],
  })
}
