import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getSessionFromRequest } from "@/lib/auth"
import { notifyDriverAboutRide } from "@/lib/notifications"
import { emitRideRequest, emitRideUpdate } from "@/lib/push-emitters"
import { sendRideRequestSMS, toTermiiPhoneNumber } from "@/lib/termii"
import { sendPushNotification } from "@/lib/push-service"

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)

    if (!session?.user?.id || session.user.role !== "user") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const {
      pickup_location, // { lat, lng, address }
      dropoff_location, // { lat, lng, address }
      pickup_time,
      estimated_distance, // in kilometers
      number_of_seats,
      fare_amount,
      platform_fee,
      driver_earnings,
      seats_available,
    } = body

    if (!pickup_location || !dropoff_location || !estimated_distance || !number_of_seats || !pickup_time) {
      return NextResponse.json(
        { error: "Missing required fields: pickup_location, dropoff_location, estimated_distance, number_of_seats, pickup_time" },
        { status: 400 }
      )
    }

    // Validate and normalize pickup_time format
    // Expected format: "2026-02-22 22:53:48.648" (from PickupTimeModal)
    let parsedPickupTime: string
    try {
      // Validate that pickup_time is a string
      if (typeof pickup_time !== 'string') {
        throw new Error('pickup_time must be a string')
      }

      // Try to parse the pickup time
      const pickupDate = new Date(pickup_time)
      
      // Check if the date is valid
      if (isNaN(pickupDate.getTime())) {
        throw new Error('Invalid date format')
      }

      // Ensure pickup_time is not in the past
      if (pickupDate < new Date()) {
        return NextResponse.json(
          { error: "Pickup time cannot be in the past" },
          { status: 400 }
        )
      }

      // Use the pickup_time as-is if it's already in the correct format
      // Expected format: "2026-02-22 22:53:48.648"
      if (pickup_time.includes(' ') && !pickup_time.includes('T')) {
        parsedPickupTime = pickup_time
      } else {
        // Convert from ISO format (2026-02-22T22:53:48.648Z) to database format (2026-02-22 22:53:48.648)
        const isoString = pickupDate.toISOString()
        parsedPickupTime = isoString.replace('T', ' ').replace('Z', '')
      }

      console.log('[BookRide] Pickup time parsed:', { original: pickup_time, parsed: parsedPickupTime })
    } catch (e) {
      console.error('[BookRide] Invalid pickup_time format:', pickup_time, e)
      return NextResponse.json(
        { error: "Invalid pickup_time format. Expected format: YYYY-MM-DD HH:mm:ss.mmm or ISO 8601" },
        { status: 400 }
      )
    }

    // Calculate fare: N600 per kilometer (if not provided)
    const base_fare_per_km = 600
    const final_fare_amount = fare_amount || estimated_distance * base_fare_per_km
    const final_platform_fee = platform_fee || final_fare_amount * 0.15
    const final_driver_earnings = driver_earnings || final_fare_amount - final_platform_fee

    // Create ride record
    const { data: ride, error } = await supabaseAdmin
      .from("rides")
      .insert({
        rider_id: session.user.id,
        pickup_zone: pickup_location.address,
        pickup_description: `Lat: ${pickup_location.lat}, Lng: ${pickup_location.lng}`,
        destination_zone: dropoff_location.address,
        destination_description: `Lat: ${dropoff_location.lat}, Lng: ${dropoff_location.lng}`,
        pickup_time: parsedPickupTime,
        distance_km: estimated_distance,
        fare_amount: final_fare_amount,
        platform_fee: final_platform_fee,
        driver_earnings: final_driver_earnings,
        seats_available: seats_available || 1,
        seats_booked: number_of_seats,
        ride_type: "single",
        status: "pending",
      })
      .select()
      .single()

    if (error) {
      console.error("Failed to create ride:", error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // Find available drivers in the pickup zone
    const pickupZone = pickup_location.address
    const destinationZone = dropoff_location.address

    const { data: zoneDrivers } = await supabaseAdmin
      .from("drivers")
      .select("id, user_id")
      .contains("operating_zones", [pickupZone])
      .eq("availability_status", "online")
      .eq("verified", true)
      .limit(5)

    let drivers = zoneDrivers || []

    if (drivers.length === 0) {
      console.log("[RideDispatch] No zone-matched drivers found, using online fallback", {
        pickupZone,
      })

      const { data: fallbackDrivers } = await supabaseAdmin
        .from("drivers")
        .select("id, user_id")
        .eq("availability_status", "online")
        .eq("verified", true)
        .limit(5)

      drivers = fallbackDrivers || []
    }

    console.log("[RideDispatch] Candidate drivers count", {
      rideId: ride.id,
      count: drivers.length,
      pickupZone,
    })

    // Existing push flow stays intact
    await emitRideRequest(
      ride.id,
      pickupZone,
      destinationZone,
      Number(final_fare_amount || 0),
      Number(estimated_distance || 0)
    )

    await emitRideUpdate(
      session.user.id,
      ride.id,
      "status",
      `Your ride request from ${pickupZone} to ${destinationZone} has been created successfully.`
    )

    // Additional SMS + in-app dispatch logs/notifications
    if (drivers && drivers.length > 0) {
      const driverUserIds = drivers.map((driver: any) => driver.user_id)

      // Send targeted push notification to these online drivers
      try {
        await sendPushNotification(driverUserIds, {
          title: "🚗 New Ride Request",
          body: `Pickup: ${pickupZone}`,
          type: "ride_request",
          data: {
            rideId: ride.id,
            pickup: pickupZone,
            destination: destinationZone,
            fare: Number(final_fare_amount || 0),
            distance: Number(estimated_distance || 0),
          },
        });
        console.log("[RideDispatch] Targeted push notification sent to drivers", {
          rideId: ride.id,
          driverCount: driverUserIds.length,
        });
      } catch (pushError) {
        console.error("[RideDispatch] Failed to send targeted push notifications:", pushError);
      }

      console.log("[RideDispatch] Fetching phone numbers for online drivers", {
        rideId: ride.id,
        driverCount: drivers.length,
        userIds: driverUserIds,
      })

      const { data: driverUsers } = await supabaseAdmin
        .from("users")
        .select("id, phone_number")
        .in("id", driverUserIds)

      const phoneByUserId = new Map<string, string>()
      for (const user of driverUsers || []) {
        if (user.phone_number) {
          phoneByUserId.set(user.id, user.phone_number)
          console.log("[RideDispatch] Driver phone mapped for online driver", {
            rideId: ride.id,
            userId: user.id,
            phone: user.phone_number,
          })
        } else {
          console.warn("[RideDispatch] Online driver has no phone number", {
            rideId: ride.id,
            userId: user.id,
          })
        }
      }

      console.log("[RideDispatch] Online driver phone numbers retrieved", {
        rideId: ride.id,
        driversWithPhone: phoneByUserId.size,
        totalDrivers: drivers.length,
      })

      const smsTasks: Promise<any>[] = []

      for (const driver of drivers) {
        await notifyDriverAboutRide(driver.user_id, ride.id, pickupZone, destinationZone)

        await supabaseAdmin.from("ride_dispatch_logs").insert([
          {
            ride_id: ride.id,
            driver_id: driver.id,
            dispatch_method: "push",
            created_at: new Date().toISOString(),
          },
        ])

        const driverPhone = phoneByUserId.get(driver.user_id)
        if (driverPhone) {
          const normalized = toTermiiPhoneNumber(driverPhone)
          if (!normalized) {
            console.warn("[RideDispatch] Invalid driver phone format for online driver SMS", {
              rideId: ride.id,
              driverId: driver.id,
              rawPhone: driverPhone,
            })
            continue
          }

          console.log("[RideDispatch] Queuing SMS for online driver", {
            rideId: ride.id,
            driverId: driver.id,
            phone: driverPhone,
          })

          smsTasks.push(
            sendRideRequestSMS({
              to: driverPhone,
              rideId: ride.id,
              pickup: pickupZone,
              destination: destinationZone,
              fare: Number(final_fare_amount || 0),
            })
              .then(() => {
                console.log("[RideDispatch] SMS sent to online driver", {
                  rideId: ride.id,
                  driverId: driver.id,
                  phone: driverPhone,
                })
                return supabaseAdmin.from("ride_dispatch_logs").insert([
                  {
                    ride_id: ride.id,
                    driver_id: driver.id,
                    dispatch_method: "sms",
                    created_at: new Date().toISOString(),
                  },
                ])
              })
              .catch((err) => {
                console.error("[RideDispatch] SMS send failed for online driver", {
                  rideId: ride.id,
                  driverId: driver.id,
                  error: err.message,
                })
                throw err
              })
          )
        } else {
          console.warn("[RideDispatch] Online driver skipped - no phone number", {
            rideId: ride.id,
            driverId: driver.id,
            userId: driver.user_id,
          })
        }
      }

      console.log("[RideDispatch] Online driver SMS tasks prepared", {
        rideId: ride.id,
        tasksQueued: smsTasks.length,
        totalOnlineDrivers: drivers.length,
      })

      const smsResults = await Promise.allSettled(smsTasks)
      let smsSuccessCount = 0
      let smsFailureCount = 0
      
      for (let i = 0; i < smsResults.length; i++) {
        const result = smsResults[i]
        if (result.status === "rejected") {
          console.error("[RideDispatch] Online driver SMS attempt failed:", result.reason)
          smsFailureCount++
        } else {
          console.log("[RideDispatch] Online driver SMS attempt succeeded")
          smsSuccessCount++
        }
      }

      console.log("[RideDispatch] Online drivers SMS dispatch summary", {
        rideId: ride.id,
        attempted: smsTasks.length,
        successful: smsSuccessCount,
        failed: smsFailureCount,
        totalOnlineDrivers: drivers.length,
      })

      await supabaseAdmin
        .from("rides")
        .update({ status: "dispatched", updated_at: new Date().toISOString() })
        .eq("id", ride.id)
    } else {
      console.log("[RideDispatch] No online verified drivers available for dispatch, broadcasting to all verified drivers", {
        rideId: ride.id,
        pickupZone,
      })

      // Broadcast to ALL verified drivers on the platform (online or offline) when no online drivers found
      const { data: allVerifiedDrivers, error: driversError } = await supabaseAdmin
        .from("drivers")
        .select("id, user_id, verified")

      if (driversError) {
        console.error("[RideDispatch] Error fetching drivers:", driversError)
      }

      console.log("[RideDispatch] Total drivers in system", {
        rideId: ride.id,
        totalCount: allVerifiedDrivers?.length || 0,
      })

      // Filter verified drivers
      const verifiedDrivers = allVerifiedDrivers?.filter((d: any) => d.verified === true) || []
      
      console.log("[RideDispatch] Verified drivers found", {
        rideId: ride.id,
        verifiedCount: verifiedDrivers.length,
      })

      if (verifiedDrivers.length > 0) {
        const allDriverUserIds = verifiedDrivers.map((driver: any) => driver.user_id)

        console.log("[RideDispatch] Fetching phone numbers for drivers", {
          rideId: ride.id,
          driverIds: allDriverUserIds,
        })

        const { data: allDriverUsers, error: usersError } = await supabaseAdmin
          .from("users")
          .select("id, phone_number")
          .in("id", allDriverUserIds)

        if (usersError) {
          console.error("[RideDispatch] Error fetching user phone numbers:", usersError)
        }

        console.log("[RideDispatch] User phone numbers retrieved", {
          rideId: ride.id,
          usersWithPhone: allDriverUsers?.filter((u: any) => u.phone_number).length || 0,
          totalUsersQueried: allDriverUsers?.length || 0,
        })

        const phoneByUserId = new Map<string, string>()
        for (const user of allDriverUsers || []) {
          if (user.phone_number) {
            phoneByUserId.set(user.id, user.phone_number)
            console.log("[RideDispatch] Driver phone mapped", {
              rideId: ride.id,
              userId: user.id,
              phone: user.phone_number,
            })
          } else {
            console.warn("[RideDispatch] Driver has no phone number", {
              rideId: ride.id,
              userId: user.id,
            })
          }
        }

        const broadcastSmsTasks: Promise<any>[] = []
        let driversSkipped = 0

        for (const driver of verifiedDrivers) {
          const driverPhone = phoneByUserId.get(driver.user_id)
          
          if (!driverPhone) {
            console.warn("[RideDispatch] Skipping driver - no phone number", {
              rideId: ride.id,
              driverId: driver.id,
              userId: driver.user_id,
            })
            driversSkipped++
            continue
          }

          const normalized = toTermiiPhoneNumber(driverPhone)
          if (!normalized) {
            console.warn("[RideDispatch] Skipping driver - invalid phone format", {
              rideId: ride.id,
              driverId: driver.id,
              rawPhone: driverPhone,
            })
            driversSkipped++
            continue
          }

          console.log("[RideDispatch] Queuing SMS for driver", {
            rideId: ride.id,
            driverId: driver.id,
            phone: driverPhone,
          })

          broadcastSmsTasks.push(
            sendRideRequestSMS({
              to: driverPhone,
              rideId: ride.id,
              pickup: pickupZone,
              destination: destinationZone,
              fare: Number(final_fare_amount || 0),
            })
              .then(() => {
                console.log("[RideDispatch] SMS sent successfully", {
                  rideId: ride.id,
                  driverId: driver.id,
                  phone: driverPhone,
                })
                return supabaseAdmin.from("ride_dispatch_logs").insert([
                  {
                    ride_id: ride.id,
                    driver_id: driver.id,
                    dispatch_method: "sms_broadcast",
                    created_at: new Date().toISOString(),
                  },
                ])
              })
              .catch((err) => {
                console.error("[RideDispatch] SMS send failed for driver", {
                  rideId: ride.id,
                  driverId: driver.id,
                  error: err.message,
                })
                throw err
              })
          )
        }

        console.log("[RideDispatch] SMS broadcast tasks prepared", {
          rideId: ride.id,
          tasksQueued: broadcastSmsTasks.length,
          driversSkipped,
          totalVerified: verifiedDrivers.length,
        })

        if (broadcastSmsTasks.length > 0) {
          const broadcastResults = await Promise.allSettled(broadcastSmsTasks)
          let broadcastSmsSuccessCount = 0
          let broadcastSmsFailureCount = 0

          for (let i = 0; i < broadcastResults.length; i++) {
            const result = broadcastResults[i]
            if (result.status === "rejected") {
              console.error("[RideDispatch] Broadcast SMS attempt failed:", result.reason)
              broadcastSmsFailureCount++
            } else {
              console.log("[RideDispatch] Broadcast SMS attempt succeeded")
              broadcastSmsSuccessCount++
            }
          }

          console.log("[RideDispatch] Broadcast SMS dispatch summary", {
            rideId: ride.id,
            attempted: broadcastSmsTasks.length,
            successful: broadcastSmsSuccessCount,
            failed: broadcastSmsFailureCount,
            totalVerifiedDrivers: verifiedDrivers.length,
            driversSkipped,
          })

          await supabaseAdmin
            .from("rides")
            .update({ status: "dispatched", updated_at: new Date().toISOString() })
            .eq("id", ride.id)
        } else {
          console.warn("[RideDispatch] No SMS could be queued - all drivers skipped due to missing/invalid phone numbers", {
            rideId: ride.id,
            totalVerified: verifiedDrivers.length,
            driversSkipped,
          })
        }
      } else {
        console.log("[RideDispatch] No verified drivers found in system", {
          rideId: ride.id,
          totalDriversInSystem: allVerifiedDrivers?.length || 0,
        })
      }
    }

    return NextResponse.json({
      ride: {
        ...ride,
        fare_amount: final_fare_amount,
        platform_fee: final_platform_fee,
        driver_earnings: final_driver_earnings,
      },
    })
  } catch (error) {
    console.error("API error:", error)
    return NextResponse.json(
      { error: "Failed to book ride" },
      { status: 500 }
    )
  }
}
