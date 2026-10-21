import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    const role = (session?.user as any)?.role;

    if (!session?.user?.id || !["admin", "super_admin"].includes(role)) {
      return NextResponse.json(
        { error: "Unauthorized. Admin privileges required." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { enabled } = body;

    if (typeof enabled !== "boolean") {
      return NextResponse.json(
        { error: "invalid_input", message: "'enabled' boolean field is required." },
        { status: 400 }
      );
    }

    const { error: upsertError } = await supabaseAdmin
      .from("platform_settings")
      .upsert({
        key: "cashless_enabled",
        value: enabled,
        updated_at: new Date().toISOString(),
      });

    if (upsertError) {
      console.error("[Admin Settings] Failed to toggle cashless mode:", upsertError);
      return NextResponse.json(
        { error: "database_error", message: "Failed to update cashless toggle." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Cashless payments successfully ${enabled ? "enabled" : "disabled"}.`,
      enabled,
    });
  } catch (err: any) {
    console.error("[Admin] Error in POST /api/admin/cashless-toggle:", err);
    return NextResponse.json(
      { error: "internal_error", message: err?.message || "Unexpected server error." },
      { status: 500 }
    );
  }
}
