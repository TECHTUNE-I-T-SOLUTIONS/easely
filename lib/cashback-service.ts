import { supabaseAdmin } from "@/lib/supabase"
import { sendPushNotification } from "@/lib/push-service"

/**
 * Cashback service
 * ----------------
 * Central place for reading a rider's cashback state and for awarding the
 * first-ride bonus. Both the API routes and any server-side caller should use
 * these helpers so the rules stay identical everywhere.
 */

export type CashbackRewardStatus = "earned" | "used" | "expired" | "cancelled"

export interface CashbackProgramSummary {
  name: string | null
  program_type: string | null
  discount_percentage: number | null
}

export interface CashbackReward {
  id: string
  user_id: string
  program_id: string
  ride_id: string | null
  related_ride_id: string | null
  discount_percentage: number
  discount_amount: number
  original_fare_amount: number
  final_fare_amount: number
  status: CashbackRewardStatus
  earned_at: string | null
  used_at: string | null
  expires_at: string | null
  created_at: string | null
  metadata: Record<string, any> | null
  cashback_programs?: CashbackProgramSummary | CashbackProgramSummary[] | null
}

export interface CashbackHistoryEntry {
  id: string
  status: CashbackRewardStatus
  programName: string
  programType: string | null
  discountPercentage: number
  discountAmount: number
  savedAmount: number | null
  earnedAt: string | null
  usedAt: string | null
  expiresAt: string | null
  rideId: string | null
  isExpiredByDate: boolean
  label: string
}

export interface CashbackStats {
  total_rides_completed: number
  total_cashback_earned: number
  total_cashback_used: number
  available_cashback_balance: number
  first_ride_bonus_earned: boolean
  spin_wheel_plays_count: number
  pending_cancellation_penalty: number
}

export interface CashbackOverview {
  stats: CashbackStats
  availableRewards: CashbackReward[]
  usedRewards: CashbackReward[]
  expiredRewards: CashbackReward[]
  history: CashbackHistoryEntry[]
  /** The rider's first_ride reward regardless of status (null when never awarded). */
  firstRideReward: CashbackReward | null
  /** True once a first_ride reward has ever been created for this rider. */
  firstRideClaimed: boolean
  /** True once that first_ride reward has been consumed. */
  firstRideUsed: boolean
  /** Free cancellation fine that will be added to the rider's next booking. */
  pendingCancellationPenalty: number
  generatedAt: string
}

const EMPTY_STATS: CashbackStats = {
  total_rides_completed: 0,
  total_cashback_earned: 0,
  total_cashback_used: 0,
  available_cashback_balance: 0,
  first_ride_bonus_earned: false,
  spin_wheel_plays_count: 0,
  pending_cancellation_penalty: 0,
}

const REWARD_SELECT = `
  *,
  cashback_programs(name, program_type, discount_percentage)
`

function programOf(reward: CashbackReward): CashbackProgramSummary | null {
  const program = reward.cashback_programs
  if (!program) return null
  return Array.isArray(program) ? program[0] ?? null : program
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function isExpiredByDate(reward: CashbackReward, now: number): boolean {
  if (!reward.expires_at) return false
  const expiresAt = new Date(reward.expires_at).getTime()
  return Number.isFinite(expiresAt) && expiresAt <= now
}

/** A reward is spendable when it is earned and either has no expiry or is still in date. */
export function isRewardUsable(reward: CashbackReward, now = Date.now()): boolean {
  return reward.status === "earned" && !isExpiredByDate(reward, now)
}

function toHistoryEntry(reward: CashbackReward, now: number): CashbackHistoryEntry {
  const program = programOf(reward)
  const expiredByDate = isExpiredByDate(reward, now)
  const status: CashbackRewardStatus =
    reward.status === "earned" && expiredByDate ? "expired" : reward.status

  const label =
    status === "used"
      ? "Used"
      : status === "expired"
        ? "Expired"
        : status === "cancelled"
          ? "Cancelled"
          : "Available"

  return {
    id: reward.id,
    status,
    programName: program?.name || "Cashback Reward",
    programType: program?.program_type ?? null,
    discountPercentage: num(reward.discount_percentage),
    discountAmount: num(reward.discount_amount),
    savedAmount: status === "used" ? num(reward.discount_amount) || null : null,
    earnedAt: reward.earned_at ?? reward.created_at ?? null,
    usedAt: reward.used_at,
    expiresAt: reward.expires_at,
    rideId: reward.ride_id ?? reward.related_ride_id ?? null,
    isExpiredByDate: expiredByDate,
    label,
  }
}

/**
 * Reads everything the cashback screen needs in two round trips:
 * one for the stats row, one for every reward the rider has ever earned.
 * Rewards are bucketed in memory so history, available and first-ride status
 * can never disagree with each other.
 */
export async function getCashbackOverview(userId: string): Promise<CashbackOverview> {
  const now = Date.now()

  // Ask the database to expire anything that lapsed, without blocking the read.
  const expiryCheck = (async () => {
    try {
      const { error } = await supabaseAdmin.rpc("check_and_mark_expired_cashback", {
        p_user_id: userId,
      })
      if (error) console.warn("[CashbackService] expiry check failed:", error.message)
    } catch (error) {
      console.warn("[CashbackService] expiry check threw:", error)
    }
  })()

  const [statsResult, rewardsResult, userResult] = await Promise.all([
    supabaseAdmin.from("user_cashback_stats").select("*").eq("user_id", userId).maybeSingle(),
    supabaseAdmin
      .from("user_cashback_rewards")
      .select(REWARD_SELECT)
      .eq("user_id", userId)
      .order("earned_at", { ascending: false }),
    supabaseAdmin.from("users").select("pending_cancellation_penalty").eq("id", userId).maybeSingle(),
  ])

  await expiryCheck

  if (statsResult.error) throw statsResult.error
  if (rewardsResult.error) throw rewardsResult.error

  const rawRewards = (rewardsResult.data || []) as CashbackReward[]
  const pendingCancellationPenalty = num(userResult.data?.pending_cancellation_penalty)

  const statsRow = statsResult.data || null
  const stats: CashbackStats = {
    ...EMPTY_STATS,
    ...(statsRow || {}),
    pending_cancellation_penalty: pendingCancellationPenalty,
  }
  // Normalise numerics — Postgres returns numeric columns as strings.
  stats.total_rides_completed = num(stats.total_rides_completed)
  stats.total_cashback_earned = num(stats.total_cashback_earned)
  stats.total_cashback_used = num(stats.total_cashback_used)
  stats.available_cashback_balance = num(stats.available_cashback_balance)
  stats.spin_wheel_plays_count = num(stats.spin_wheel_plays_count)
  stats.first_ride_bonus_earned = Boolean(stats.first_ride_bonus_earned)

  const availableRewards: CashbackReward[] = []
  const usedRewards: CashbackReward[] = []
  const expiredRewards: CashbackReward[] = []
  const history: CashbackHistoryEntry[] = []

  // Oldest first for the first-ride lookup so we keep the original award.
  const firstRideCandidates = rawRewards
    .filter((reward) => programOf(reward)?.program_type === "first_ride")
    .sort((a, b) => {
      const aTime = a.earned_at ? new Date(a.earned_at).getTime() : 0
      const bTime = b.earned_at ? new Date(b.earned_at).getTime() : 0
      return aTime - bTime
    })

  const firstRideReward = firstRideCandidates[0] ?? null

  for (const reward of rawRewards) {
    if (reward.status === "cancelled") continue
    if (isRewardUsable(reward, now)) {
      availableRewards.push(reward)
    } else if (reward.status === "used") {
      usedRewards.push(reward)
    } else if (reward.status === "expired" || isExpiredByDate(reward, now)) {
      expiredRewards.push(reward)
    }
    history.push(toHistoryEntry(reward, now))
  }

  availableRewards.sort((a, b) => {
    const aTime = a.expires_at ? new Date(a.expires_at).getTime() : Number.MAX_SAFE_INTEGER
    const bTime = b.expires_at ? new Date(b.expires_at).getTime() : Number.MAX_SAFE_INTEGER
    return aTime - bTime
  })

  return {
    stats,
    availableRewards,
    usedRewards,
    expiredRewards,
    history,
    firstRideReward,
    firstRideClaimed: firstRideReward !== null,
    firstRideUsed: firstRideReward?.status === "used",
    pendingCancellationPenalty,
    generatedAt: new Date(now).toISOString(),
  }
}

export interface AwardFirstRideResult {
  reward: CashbackReward | null
  alreadyClaimed: boolean
  message: string
}

function firstRideRewardQuery(userId: string) {
  return supabaseAdmin
    .from("user_cashback_rewards")
    .select(REWARD_SELECT)
    .eq("user_id", userId)
    .order("earned_at", { ascending: true })
    .limit(50)
}

async function findFirstRideReward(userId: string): Promise<CashbackReward | null> {
  const { data, error } = await firstRideRewardQuery(userId)
  if (error) throw error
  const rewards = (data || []) as CashbackReward[]
  return (
    rewards
      .filter((reward) => programOf(reward)?.program_type === "first_ride")
      .sort((a, b) => {
        const aTime = a.earned_at ? new Date(a.earned_at).getTime() : 0
        const bTime = b.earned_at ? new Date(b.earned_at).getTime() : 0
        return aTime - bTime
      })[0] ?? null
  )
}

/**
 * Awards the one-and-only first-ride bonus.
 *
 * Idempotent by design: it looks for *any* first_ride reward the rider has ever
 * had (earned, used, expired or cancelled) before inserting, so tapping the
 * treasure chest again can never grant a second bonus. The database trigger
 * `enforce_single_first_ride_reward` backs this up against races.
 */
export async function awardFirstRideReward(userId: string): Promise<AwardFirstRideResult> {
  const existing = await findFirstRideReward(userId)
  if (existing) {
    return {
      reward: existing,
      alreadyClaimed: true,
      message: "You have already claimed your first ride reward",
    }
  }

  const { data: stats } = await supabaseAdmin
    .from("user_cashback_stats")
    .select("total_rides_completed")
    .eq("user_id", userId)
    .maybeSingle()

  const { count: completedRides } = await supabaseAdmin
    .from("rides")
    .select("id", { count: "exact", head: true })
    .eq("rider_id", userId)
    .eq("status", "completed")

  const ridesCompleted = Math.max(num(stats?.total_rides_completed), completedRides || 0)
  if (ridesCompleted < 1) {
    const error = new Error("Complete your first ride to unlock this reward") as Error & { code?: string }
    error.code = "not_eligible"
    throw error
  }

  const { data: program, error: programError } = await supabaseAdmin
    .from("cashback_programs")
    .select("*")
    .eq("program_type", "first_ride")
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (programError) throw programError
  if (!program) {
    const error = new Error("First ride bonus program not found") as Error & { code?: string }
    error.code = "program_missing"
    throw error
  }

  const discountPercentage = 10
  const expiresAt = new Date(
    Date.now() + num(program.expiry_days, 30) * 24 * 60 * 60 * 1000
  ).toISOString()

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("user_cashback_rewards")
    .insert({
      user_id: userId,
      program_id: program.id,
      discount_percentage: discountPercentage,
      discount_amount: 0,
      original_fare_amount: 0,
      final_fare_amount: 0,
      status: "earned",
      earned_at: new Date().toISOString(),
      expires_at: expiresAt,
      metadata: { source: "first_ride_bonus", random_discount: true },
    })
    .select(REWARD_SELECT)
    .single()

  if (insertError) {
    // 23505 = duplicate key. Either our trigger or a concurrent request won the race;
    // return the reward that exists instead of failing the rider.
    if (insertError.code === "23505") {
      const reward = await findFirstRideReward(userId)
      return { reward, alreadyClaimed: true, message: "You have already claimed your first ride reward" }
    }
    throw insertError
  }

  const reward = inserted as CashbackReward

  try {
    await sendPushNotification([userId], {
      title: "🎉 Congratulations!",
      body: `You won ${discountPercentage}% off your next ride! Use it before it expires.`,
      type: "cashback" as any,
      categoryId: "cashback",
      data: { deeplink: "/rider/cashback", discount_percentage: discountPercentage },
    })
  } catch (notifyError) {
    console.warn("[CashbackService] first ride notification failed:", notifyError)
  }

  return {
    reward,
    alreadyClaimed: false,
    message: `Congratulations! You won ${discountPercentage}% off your next ride!`,
  }
}
