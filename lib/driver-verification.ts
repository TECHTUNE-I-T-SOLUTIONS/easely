import { supabaseAdmin } from "@/lib/supabase"

export type DriverVerificationResult = {
  allowed: boolean
  status: number
  code?: "driver_not_found" | "driver_not_verified" | "internal_error"
  message?: string
  driver?: any
}

export async function requireVerifiedDriver(userId: string): Promise<DriverVerificationResult> {
  if (!supabaseAdmin) {
    return {
      allowed: false,
      status: 500,
      code: "internal_error",
      message: "Database client not initialized",
    }
  }

  const { data: driver, error } = await supabaseAdmin
    .from("drivers")
    .select("id, user_id, verified, availability_status")
    .eq("user_id", userId)
    .maybeSingle()

  if (error || !driver?.id) {
    return {
      allowed: false,
      status: 404,
      code: "driver_not_found",
      message: "Driver profile not found",
    }
  }

  if (!driver.verified) {
    return {
      allowed: false,
      status: 403,
      code: "driver_not_verified",
      message: "Your driver account is awaiting Charter Keke verification.",
      driver,
    }
  }

  return {
    allowed: true,
    status: 200,
    driver,
  }
}

