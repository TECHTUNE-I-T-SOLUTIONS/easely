import { NextResponse } from "next/server";
import { isCashlessEnabled } from "@/lib/cashless";

export async function GET() {
  try {
    const enabled = await isCashlessEnabled();
    return NextResponse.json({
      success: true,
      enabled,
      mode: enabled ? "cashless" : "cash",
    });
  } catch (error: any) {
    console.error("[Settings] cashless-enabled fetch error:", error);
    return NextResponse.json({ enabled: false, error: "Failed to read setting" }, { status: 200 });
  }
}
