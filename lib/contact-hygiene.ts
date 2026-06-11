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
    await Promise.allSettled([
      supabaseAdmin.from("push_subscriptions").delete().eq("user_id", user.id),
      supabaseAdmin.from("notification_preferences").delete().eq("user_id", user.id),
      supabaseAdmin.from("notifications").delete().eq("user_id", user.id),
      supabaseAdmin.from("otps").delete().eq("user_id", user.id),
      supabaseAdmin.from("user_locations").delete().eq("user_id", user.id),
    ])

    const { error: deleteError } = await supabaseAdmin.from("users").delete().eq("id", user.id)
    if (deleteError) {
      blocked.push({ userId: user.id, error: deleteError.message })
    } else {
      purged.push(user.id)
    }
  }

  return { checked: users?.length || 0, purged, blocked }
}

