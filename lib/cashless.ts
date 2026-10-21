import { supabaseAdmin } from "@/lib/supabase";

/**
 * Checks whether cashless mode is enabled globally by admin in platform_settings.
 * Defaults strictly to false if unconfigured or database unreachable.
 */
export async function isCashlessEnabled(): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from("platform_settings")
      .select("value")
      .eq("key", "cashless_enabled")
      .single();

    if (error || !data) {
      return false;
    }

    if (typeof data.value === "boolean") {
      return data.value;
    }
    if (typeof data.value === "string") {
      return data.value === "true";
    }
    if (data.value && typeof data.value === "object" && "enabled" in data.value) {
      return Boolean(data.value.enabled);
    }

    return false;
  } catch (err) {
    console.error("[Cashless Flag Check Error]:", err);
    return false;
  }
}
