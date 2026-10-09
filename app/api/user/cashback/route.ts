import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getSessionFromRequest } from "@/lib/auth"
import { 
  sendCashbackRewardNotification, 
  sendSpinWheelNotification,
  sendCashbackUsedNotification 
} from "@/lib/cashback-notifications"
import { sendPushNotification } from "@/lib/push-service"

// GET - Get user's cashback stats and available rewards
export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const checkEligibility = searchParams.get("checkEligibility") === "true"
    const programType = searchParams.get("programType")

    // Check and mark expired cashback for this user (background check)
    try {
      await supabaseAdmin.rpc('check_and_mark_expired_cashback', {
        p_user_id: session.user.id
      })
    } catch (err) {
      // Log but don't fail the request if this fails
      console.warn('[UserCashback] Failed to check expired cashback:', err)
    }

    // Get user's cashback stats
    const { data: stats, error: statsError } = await supabaseAdmin
      .from("user_cashback_stats")
      .select("*")
      .eq("user_id", session.user.id)
      .single()

    if (statsError && statsError.code !== 'PGRST116') {
      throw statsError
    }

    // Get available cashback rewards
    const { data: availableRewards, error: rewardsError } = await supabaseAdmin
      .from("user_cashback_rewards")
      .select(`
        *,
        cashback_programs(name, program_type, discount_percentage)
      `)
      .eq("user_id", session.user.id)
      .eq("status", "earned")
      .or("expires_at.is.null,expires_at.gt.now()")
      .order("expires_at", { ascending: true })

    if (rewardsError) throw rewardsError

    let eligibility = null
    if (checkEligibility && programType) {
      // Check eligibility for specific program
      const { data: eligibilityData, error: eligibilityError } = await supabaseAdmin
        .rpc('check_cashback_eligibility', {
          p_user_id: session.user.id,
          p_program_type: programType
        })

      if (!eligibilityError) {
        eligibility = eligibilityData
      }
    }

    return NextResponse.json({
      stats: stats || {
        total_rides_completed: 0,
        total_cashback_earned: 0,
        total_cashback_used: 0,
        available_cashback_balance: 0,
        first_ride_bonus_earned: false,
        spin_wheel_plays_count: 0
      },
      availableRewards: availableRewards || [],
      eligibility
    })
  } catch (error) {
    console.error("[UserCashback] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch cashback data" }, { status: 500 })
  }
}

// POST - Use cashback reward or create new reward
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { action, programId, rideId, rewardId } = body

    if (action === "use_cashback") {
      // Use existing cashback reward
      if (!rewardId || !rideId) {
        return NextResponse.json({ error: "Reward ID and Ride ID required" }, { status: 400 })
      }

      // Get the reward
      const { data: reward, error: rewardError } = await supabaseAdmin
        .from("user_cashback_rewards")
        .select("*")
        .eq("id", rewardId)
        .eq("user_id", session.user.id)
        .eq("status", "earned")
        .single()

      if (rewardError || !reward) {
        return NextResponse.json({ error: "Reward not found or already used" }, { status: 404 })
      }

      // Check if expired
      if (reward.expires_at && new Date(reward.expires_at) < new Date()) {
        return NextResponse.json({ error: "Reward has expired" }, { status: 400 })
      }

      // Mark as used
      const { data: updatedReward, error: updateError } = await supabaseAdmin
        .from("user_cashback_rewards")
        .update({
          status: "used",
          used_at: new Date().toISOString(),
          ride_id: rideId,
          updated_at: new Date().toISOString()
        })
        .eq("id", rewardId)
        .select()
        .single()

      if (updateError) throw updateError

      // Send push notification for cashback used
      await sendCashbackUsedNotification(session.user.id, updatedReward)

      return NextResponse.json({ reward: updatedReward })
    }

    if (action === "generate_first_ride_reward") {
      // Generate first ride reward when user opens treasure chest
      // Check if user already has a first ride reward
      const { data: existingReward, error: existingError } = await supabaseAdmin
        .from("user_cashback_rewards")
        .select("*, cashback_programs(*)")
        .eq("user_id", session.user.id)
        .eq("status", "earned")
        .single()

      if (!existingError && existingReward) {
        return NextResponse.json({ 
          error: "You already have a first ride reward" 
        }, { status: 400 })
      }

      // Get the first ride bonus program
      const { data: firstRideProgram } = await supabaseAdmin!
        .from("cashback_programs")
        .select("*")
        .eq("program_type", "first_ride")
        .eq("is_active", true)
        .single()

      if (!firstRideProgram) {
        return NextResponse.json({ 
          error: "First ride bonus program not found" 
        }, { status: 404 })
      }

      // Fixed 10% for the first ride bonus
      const randomDiscount = 10;

      const { data: newReward, error: rewardError } = await supabaseAdmin!
        .from("user_cashback_rewards")
        .insert({
          user_id: session.user.id,
          program_id: firstRideProgram.id,
          discount_percentage: randomDiscount,
          discount_amount: 0, // Will be calculated when used
          original_fare_amount: 0,
          final_fare_amount: 0,
          status: "earned",
          earned_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + (firstRideProgram.expiry_days || 30) * 24 * 60 * 60 * 1000).toISOString(),
          metadata: {
            source: 'first_ride_bonus',
            random_discount: true,
          },
        })
        .select(`
          *,
          cashback_programs(name, program_type, discount_percentage)
        `)
        .single()

      if (rewardError) {
        console.error("[UserCashback] Failed to insert reward:", rewardError)
        // If the error is about notification column, it's likely a trigger issue
        // We can still succeed by manually sending the notification
        if (rewardError.message?.includes('body') || rewardError.code === '42703') {
          console.warn("[UserCashback] Trigger error occurred, but reward may have been inserted")
          // Try to fetch the reward that might have been inserted
          const { data: insertedReward } = await supabaseAdmin
            .from("user_cashback_rewards")
            .select(`
              *,
              cashback_programs(name, program_type, discount_percentage)
            `)
            .eq("user_id", session.user.id)
            .eq("program_id", firstRideProgram.id)
            .eq("status", "earned")
            .order("earned_at", { ascending: false })
            .limit(1)
            .single()

          if (insertedReward) {
            // Send push notification manually
            try {
              await sendPushNotification([session.user.id], {
                title: "🎉 Congratulations!",
                body: `You won ${randomDiscount}% off your next ride! Use it before it expires.`,
                type: "cashback" as any,
                categoryId: "cashback",
                data: {
                  deeplink: "/rider/cashback",
                  discount_percentage: randomDiscount
                }
              })
            } catch (notifError) {
              console.warn("[UserCashback] Failed to send notification:", notifError)
            }

            return NextResponse.json({
              reward: insertedReward,
              message: `Congratulations! You won ${randomDiscount}% off your next ride!`
            })
          }
        }
        throw rewardError
      }

      console.log("[UserCashback] First ride reward generated for user:", session.user.id, "Discount:", randomDiscount + "%")

      // Send push notification manually instead of relying on triggers
      try {
        await sendPushNotification([session.user.id], {
          title: "🎉 Congratulations!",
          body: `You won ${randomDiscount}% off your next ride! Use it before it expires.`,
          type: "cashback" as any,
          categoryId: "cashback",
          data: {
            deeplink: "/rider/cashback",
            discount_percentage: randomDiscount
          }
        })
      } catch (notifError) {
        console.warn("[UserCashback] Failed to send notification:", notifError)
        // Don't fail the request if notification fails
      }

      return NextResponse.json({
        reward: newReward,
        message: `Congratulations! You won ${randomDiscount}% off your next ride!`
      })
    }

    if (action === "spin_wheel") {
      // Spin the wheel to win a reward (only playable ONCE)
      // If programId is not provided or is a placeholder, find the active spin wheel program
      let programQuery = supabaseAdmin
        .from("cashback_programs")
        .select("*")
        .eq("program_type", "spin_wheel")
        .eq("is_active", true)

      // If programId is provided and looks like a UUID, use it; otherwise find any active spin wheel program
      if (programId && programId !== 'default-spin-wheel' && programId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        programQuery = programQuery.eq("id", programId)
      }

      const { data: program, error: programError } = await programQuery.single()

      if (programError || !program) {
        return NextResponse.json({ error: "Spin wheel program not found or inactive" }, { status: 404 })
      }

      // Check user eligibility
      const { data: stats, error: statsError } = await supabaseAdmin
        .from("user_cashback_stats")
        .select("total_rides_completed, spin_wheel_plays_count")
        .eq("user_id", session.user.id)
        .single()

      const totalRides = stats?.total_rides_completed || 0
      const playsCount = stats?.spin_wheel_plays_count || 0
      const requiredRides = program.valid_after_rides || 1

      if (totalRides < requiredRides) {
        return NextResponse.json({ 
          error: `Complete ${requiredRides - totalRides} more rides to unlock spin wheel` 
        }, { status: 400 })
      }

      // Only allow ONE spin ever
      if (playsCount >= 1) {
        return NextResponse.json({ 
          error: "You have already used your spin wheel. This is a one-time reward!" 
        }, { status: 400 })
      }

      // Spin wheel logic: Display 1-10%, but only actually award 1-5%
      // Weighted random to favor lower percentages
      const possiblePayouts = [1, 2, 3, 4, 5] // Actual payouts (1-5%)
      const possibleDisplays = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] // What's shown on wheel
      const payoutWeights = [0.35, 0.25, 0.20, 0.15, 0.05] // Higher weight for lower payouts
      const tryAgainWeight = 0.30 // 30% chance of try again

      const random = Math.random()
      
      // Determine actual payout (1-5%)
      let actualDiscountPercentage = 1
      let cumulative = 0
      for (let i = 0; i < possiblePayouts.length; i++) {
        cumulative += payoutWeights[i]
        if (random <= cumulative) {
          actualDiscountPercentage = possiblePayouts[i]
          break
        }
      }

      // Determine what to display (can be 1-10%)
      // If actual is 1-5%, randomly display same or higher (6-10% very rare)
      let displayedPercentage = actualDiscountPercentage
      if (Math.random() < 0.1) { // 10% chance to show higher than actual
        displayedPercentage = possibleDisplays[Math.floor(Math.random() * 5) + 5] // 6-10%
      }

      // Determine final result
      const finalRandom = Math.random()
      let spinResult = 'try_again'
      let finalDiscountPercentage = 0

      if (finalRandom > tryAgainWeight) {
        // Won a discount
        spinResult = `${actualDiscountPercentage}_percent`
        finalDiscountPercentage = actualDiscountPercentage
      }

      // Create spin wheel result
      const { data: spinResultData, error: spinError } = await supabaseAdmin
        .from("spin_wheel_results")
        .insert({
          user_id: session.user.id,
          program_id: program.id,
          spin_result: spinResult,
          displayed_result: `${displayedPercentage}_percent`,
          discount_percentage: finalDiscountPercentage,
          discount_amount: 0, // Will be calculated based on fare when used
          status: spinResult === 'try_again' ? 'cancelled' : 'won',
          expires_at: spinResult !== 'try_again' ?
            new Date(Date.now() + (program.expiry_days || 7) * 24 * 60 * 60 * 1000).toISOString() :
            null
        })
        .select()
        .single()

      if (spinError) throw spinError

      // Update spin wheel play count (locks it forever)
      await supabaseAdmin
        .from("user_cashback_stats")
        .update({
          spin_wheel_plays_count: 1, // Locked at 1 forever
          last_spin_wheel_play_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("user_id", session.user.id)

      // If won, create cashback reward
      let cashbackReward = null
      if (spinResult !== 'try_again') {
        const maxDiscount = program.max_discount_amount || 300
        const expiryDate = new Date(Date.now() + (program.expiry_days || 7) * 24 * 60 * 60 * 1000)

        const { data: newReward, error: rewardError } = await supabaseAdmin
          .from("user_cashback_rewards")
          .insert({
            user_id: session.user.id,
            program_id: program.id,
            discount_percentage: finalDiscountPercentage,
            discount_amount: 0, // Will be calculated when applied to a ride
            original_fare_amount: 0, // Will be set when used
            final_fare_amount: 0, // Will be calculated when used
            status: "earned",
            earned_at: new Date().toISOString(),
            expires_at: expiryDate.toISOString(),
            metadata: { 
              source: 'spin_wheel', 
              spin_result_id: spinResultData.id,
              displayed_percentage: displayedPercentage,
              actual_percentage: finalDiscountPercentage
            }
          })
          .select()
          .single()

        if (!rewardError) {
          cashbackReward = newReward
          // Send push notification for cashback reward
          await sendCashbackRewardNotification(session.user.id, newReward)
        }
      }

      // Send push notification for spin wheel result
      if (spinResult !== 'try_again') {
        await sendSpinWheelNotification(session.user.id, spinResultData)
      }

      return NextResponse.json({
        spinResult: {
          ...spinResultData,
          displayed_result: `${displayedPercentage}_percent`
        },
        cashbackReward,
        message: spinResult === 'try_again' 
          ? 'Try again next time! (This was your one-time spin)' 
          : `Congratulations! You won ${displayedPercentage}% off your next ride!`
      })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("[UserCashback] POST error:", error)
    return NextResponse.json({ error: "Failed to process cashback action" }, { status: 500 })
  }
}