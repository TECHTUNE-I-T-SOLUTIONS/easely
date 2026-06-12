import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

const FALLBACK_PRICING = {
  id: "fallback-rail-v1",
  name: "RAIL v1",
  baseFare: 800,
  minimumFare: 1500,
  perMinute: 15,
  platformFeeRate: 0.15,
  etaPerKm: {
    lowTraffic: 4,
    normalTraffic: 6,
    heavyTraffic: 8,
  },
  learningWeight: 0.1,
  distanceBands: [
    { maxKm: 3, rate: 500 },
    { maxKm: 10, rate: 600 },
    { maxKm: null, rate: 700 },
  ],
  source: "fallback",
}

export async function GET() {
  try {
    const { data: setting, error } = await supabaseAdmin
      .from("pricing_settings")
      .select("*")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    if (!setting?.id) return NextResponse.json(FALLBACK_PRICING)

    const { data: bands, error: bandsError } = await supabaseAdmin
      .from("distance_bands")
      .select("max_km, rate, sort_order")
      .eq("pricing_setting_id", setting.id)
      .order("sort_order", { ascending: true })

    if (bandsError) throw bandsError

    return NextResponse.json({
      id: setting.id,
      name: setting.name || "RAIL v1",
      baseFare: Number(setting.base_fare),
      minimumFare: Number(setting.minimum_fare),
      perMinute: Number(setting.per_minute),
      platformFeeRate: Number(setting.platform_fee_rate ?? 0.15),
      etaPerKm: {
        lowTraffic: Number(setting.eta_low_traffic_min_per_km || 4),
        normalTraffic: Number(setting.eta_normal_traffic_min_per_km || 6),
        heavyTraffic: Number(setting.eta_heavy_traffic_min_per_km || 8),
      },
      learningWeight: Number(setting.learning_weight ?? 0.1),
      distanceBands: (bands || []).map((band: any) => ({
        maxKm: band.max_km === null ? null : Number(band.max_km),
        rate: Number(band.rate),
      })),
      updatedAt: setting.updated_at,
      source: "database",
    })
  } catch (error) {
    console.error("[PricingActive] failed:", error)
    return NextResponse.json(FALLBACK_PRICING)
  }
}
