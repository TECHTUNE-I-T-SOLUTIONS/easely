import { NextRequest, NextResponse } from "next/server"
import { purgeDeletedUsersFromUsersTable } from "@/lib/contact-hygiene"

function isAuthorized(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")
  const publicToken = process.env.CRON_PUBLIC_TOKEN
  const bearer = request.headers.get("authorization")
  const secret = process.env.CRON_SECRET
  return (secret && bearer === `Bearer ${secret}`) || (publicToken && token === publicToken)
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || 100), 500)
    const result = await purgeDeletedUsersFromUsersTable(limit)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error("[CRON][PURGE_DELETED_USERS]", error)
    return NextResponse.json({ error: "Failed to purge deleted users" }, { status: 500 })
  }
}

