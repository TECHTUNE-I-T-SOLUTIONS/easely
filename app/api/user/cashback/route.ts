import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getSessionFromRequest } from "@/lib/auth"
import { 
  sendCashbackRewardNotification, 
  sendSpinWheelNotification,
  sendCashbackUsedNotification 
} from "@/lib/cashback-notifications"
import { getCashbackOverview, awardFirstRideReward } from "@/lib/cashback-service"

// GET - Get user's cashback stats, available rewards and full reward history
export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const checkEligibility = searchParams.get("checkEligibility") === "true"
    const programType = searchParams.get("programType")
    const fresh = searchParams.get("fresh") === "true"

    let eligibility = null
    const eligibilityPromise: Promise<any> =
      checkEligibility && programType
        ? (async () => {
            try {
              const { data } = await supabaseAdmin.rpc("check_cashback_eligibility", {
                p_user_id: session.user.id,
                p_program_type: programType,
              })
              return data
            } catch {
              return null
            }
          })()
        : Promise.resolve(null)

    const [overview, eligibilityData] = await Promise.all([
      getCashbackOverview(session.user.id),
      eligibilityPromise,
    ])
    eligibility = eligibilityData

    const response = NextResponse.json({
      ...overview,
      eligibility,
    })

    // Short private cache keeps re-opening the screen instant without ever
    // serving another rider's data.
    response.headers.set(
      "Cache-Control",
      fresh ? "no-store" : "private, max-age=10, stale-while-revalidate=30"
    )
    return response
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
      // Idempotent: the service returns the existing first_ride reward instead of
      // minting a second one, so re-opening the treasure chest can never double-award.
      try {
        const result = await awardFirstRideReward(session.user.id)
        return NextResponse.json({
          reward: result.reward,
          alreadyClaimed: result.alreadyClaimed,
          message: result.message,
        })
      } catch (awardError: any) {
        if (awardError?.code === "not_eligible") {
          return NextResponse.json({ error: awardError.message }, { status: 400 })
        }
        if (awardError?.code === "program_missing") {
          return NextResponse.json({ error: awardError.message }, { status: 404 })
        }
        console.error("[UserCashback] Failed to award first ride reward:", awardError)
        return NextResponse.json({ error: "Failed to generate reward" }, { status: 500 })
      }
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