import { supabaseAdmin } from "@/lib/supabase"

export function isDeletedPlaceholderEmail(email?: string | null) {
  const normalized = String(email || "").trim().toLowerCase()
  return !normalized || normalized.endsWith("@deleted.charterkeke.local") || normalized.startsWith("deleted-")
}

export function isDeletedPlaceholderPhone(phone?: string | null) {
  const normalized = String(phone || "").trim().toLowerCase()
  return !normalized || normalized.startsWith("del-") || normalized.startsWith("email:")
}

export function isDeletedUserLike(user?: {
  status?: string | null
  deleted_at?: string | null
  deletion_reason?: string | null
  email?: string | null
  phone_number?: string | null
} | null) {
  if (!user) return true
  return (
    user.status === "deleted" ||
    Boolean(user.deleted_at) ||
    String(user.deletion_reason || "").toLowerCase() === "user_requested" ||
    isDeletedPlaceholderEmail(user.email) ||
    isDeletedPlaceholderPhone(user.phone_number)
  )
}

export async function activeUserIds(userIds: string[]) {
  const ids = Array.from(new Set(userIds.filter(Boolean)))
  if (!ids.length || !supabaseAdmin) return []

  const { data } = await supabaseAdmin
    .from("users")
    .select("id, status, deleted_at, deletion_reason, email, phone_number")
    .in("id", ids)

  return (data || [])
    .filter((user: any) => !isDeletedUserLike(user))
    .map((user: any) => user.id as string)
}

async function deleteWhereIn(table: string, column: string, values: string[]) {
  if (!values.length || !supabaseAdmin) return
  const { error } = await supabaseAdmin.from(table).delete().in(column, values)
  if (error && error.code !== "42P01" && error.code !== "42703") throw error
}

async function deleteWhereEq(table: string, column: string, value: string) {
  if (!value || !supabaseAdmin) return
  const { error } = await supabaseAdmin.from(table).delete().eq(column, value)
  if (error && error.code !== "42P01" && error.code !== "42703") throw error
}

async function nullWhereIn(table: string, matchColumn: string, values: string[], payload: Record<string, null>) {
  if (!values.length || !supabaseAdmin) return
  const { error } = await supabaseAdmin.from(table).update(payload).in(matchColumn, values)
  if (error && error.code !== "42P01" && error.code !== "42703") throw error
}

function isMissingTableOrColumn(error: any) {
  return error?.code === "42P01" || error?.code === "42703"
}

async function selectIdsEq(table: string, column: string, value: string) {
  if (!value || !supabaseAdmin) return []
  const { data, error } = await supabaseAdmin.from(table).select("id").eq(column, value)
  if (error) {
    if (isMissingTableOrColumn(error)) return []
    throw error
  }
  return (data || []).map((row: any) => row.id).filter(Boolean)
}

async function selectIdsIn(table: string, column: string, values: string[]) {
  if (!values.length || !supabaseAdmin) return []
  const { data, error } = await supabaseAdmin.from(table).select("id").in(column, values)
  if (error) {
    if (isMissingTableOrColumn(error)) return []
    throw error
  }
  return (data || []).map((row: any) => row.id).filter(Boolean)
}

async function selectIdsOr(table: string, filter: string) {
  if (!filter || !supabaseAdmin) return []
  const { data, error } = await supabaseAdmin.from(table).select("id").or(filter)
  if (error) {
    if (isMissingTableOrColumn(error)) return []
    throw error
  }
  return (data || []).map((row: any) => row.id).filter(Boolean)
}

async function cleanupDriverOwnedRows(userId: string) {
  if (!supabaseAdmin) return

  const { data: drivers, error } = await supabaseAdmin
    .from("drivers")
    .select("id")
    .eq("user_id", userId)

  if (error && error.code !== "42P01") throw error

  const driverIds = (drivers || []).map((driver: any) => driver.id).filter(Boolean)
  if (!driverIds.length) return

  const settlementIds = await selectIdsIn("driver_daily_settlement", "driver_id", driverIds)
  const paymentIds = await selectIdsIn("driver_payments", "driver_id", driverIds)

  await nullWhereIn("rides", "remitted_by_payment_id", paymentIds, { remitted_by_payment_id: null })
  await nullWhereIn("rides", "driver_id", driverIds, { driver_id: null })
  await deleteWhereIn("driver_locations", "driver_id", driverIds)
  await deleteWhereIn("ride_dispatch_logs", "driver_id", driverIds)
  await deleteWhereIn("driver_payment_reminders", "settlement_id", settlementIds)
  await deleteWhereIn("driver_payment_reminders", "driver_id", driverIds)
  await deleteWhereIn("driver_payments", "settlement_id", settlementIds)
  await deleteWhereIn("driver_payments", "driver_id", driverIds)
  await deleteWhereIn("driver_daily_settlement", "driver_id", driverIds)
  await deleteWhereIn("driver_daily_rides_log", "driver_id", driverIds)

  const remainingLocationIds = await selectIdsIn("driver_locations", "driver_id", driverIds)
  if (remainingLocationIds.length) {
    throw new Error("Driver still has linked location rows after cleanup")
  }

  await deleteWhereIn("drivers", "id", driverIds)
}

async function cleanupUserOwnedRows(userId: string) {
  if (!supabaseAdmin) return

  await cleanupDriverOwnedRows(userId)

  const walletIds = await selectIdsEq("wallets", "user_id", userId)
  const ticketIds = await selectIdsEq("support_tickets", "user_id", userId)
  const chatIds = await selectIdsOr("chats", `rider_id.eq.${userId},driver_id.eq.${userId}`)

  await deleteWhereIn("messages", "chat_id", chatIds)
  await deleteWhereEq("messages", "sender_id", userId)
  await deleteWhereIn("chats", "id", chatIds)
  await deleteWhereIn("ticket_messages", "ticket_id", ticketIds)
  await deleteWhereEq("ticket_messages", "sender_id", userId)
  await deleteWhereIn("crm_internal_notes", "ticket_id", ticketIds)
  await deleteWhereIn("crm_email_messages", "ticket_id", ticketIds)
  await deleteWhereIn("support_tickets", "id", ticketIds)
  await deleteWhereEq("audit_logs", "user_id", userId)
  await deleteWhereEq("admin_messages", "sender_user_id", userId)
  await deleteWhereEq("admin_conversation_members", "user_id", userId)
  await nullWhereIn("admin_conversations", "created_by", [userId], { created_by: null })
  await deleteWhereEq("admin_push_subscriptions", "admin_user_id", userId)
  await deleteWhereEq("admin_notifications", "recipient_user_id", userId)
  await deleteWhereEq("notifications", "user_id", userId)
  await deleteWhereEq("notification_preferences", "user_id", userId)
  await deleteWhereEq("push_subscriptions", "user_id", userId)
  await deleteWhereEq("otps", "user_id", userId)
  await deleteWhereEq("user_locations", "user_id", userId)
  await deleteWhereEq("referral_codes", "user_id", userId)
  await deleteWhereEq("referrals", "referrer_id", userId)
  await deleteWhereEq("referrals", "referee_id", userId)
  await deleteWhereEq("ride_reviews", "reviewer_id", userId)
  await deleteWhereEq("ride_reviews", "rated_user_id", userId)
  await deleteWhereIn("transactions", "wallet_id", walletIds)
  await deleteWhereIn("wallets", "id", walletIds)
  await deleteWhereEq("sos_alerts", "acknowledged_by", userId)
  await deleteWhereEq("sos_alerts", "resolved_by", userId)
  await deleteWhereEq("sos_alerts", "driver_user_id", userId)
  await deleteWhereEq("sos_alerts", "user_id", userId)
  await deleteWhereEq("admins", "user_id", userId)

  const rideIds = await selectIdsEq("rides", "rider_id", userId)
  await deleteWhereIn("driver_locations", "ride_id", rideIds)
  await deleteWhereIn("user_locations", "ride_id", rideIds)
  await deleteWhereIn("ride_dispatch_logs", "ride_id", rideIds)
  await deleteWhereIn("ride_reviews", "ride_id", rideIds)
  await deleteWhereIn("chats", "ride_id", rideIds)
  await deleteWhereIn("rides", "id", rideIds)
}

export async function purgeDeletedUsersFromUsersTable(limit = 100) {
  if (!supabaseAdmin) throw new Error("Supabase admin client unavailable")

  const { data: users, error } = await supabaseAdmin
    .from("users")
    .select("id, status, deleted_at, deletion_reason, email, phone_number")
    .or("status.eq.deleted,deleted_at.not.is.null,deletion_reason.eq.user_requested")
    .limit(limit)

  if (error) throw error

  const purged: string[] = []
  const blocked: Array<{ userId: string; error: string }> = []

  for (const user of users || []) {
    try {
      await cleanupUserOwnedRows(user.id)
      const { error: deleteError } = await supabaseAdmin.from("users").delete().eq("id", user.id)
      if (deleteError) throw deleteError
      purged.push(user.id)
    } catch (error) {
      blocked.push({ userId: user.id, error: error instanceof Error ? error.message : "Unknown purge error" })
    }
  }

  return { checked: users?.length || 0, purged, blocked }
}
