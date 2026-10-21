import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import crypto from "crypto";

export interface CkAuthContext {
  partnerId: string;
  partnerName: string;
  keyId: string;
  scopes: string[];
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory rate limiting map per keyId
const rateLimitMap = new Map<string, RateLimitEntry>();

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key.trim()).digest("hex");
}

export function checkRateLimit(keyId: string, limit: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1-minute window
  const entry = rateLimitMap.get(keyId);

  if (!entry || now > entry.resetAt) {
    const resetAt = now + windowMs;
    rateLimitMap.set(keyId, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}

export async function validateCkApiKey(
  request: NextRequest,
  requiredScope?: string
): Promise<{ auth: CkAuthContext | null; error: NextResponse | null }> {
  const authHeader = request.headers.get("authorization");
  const xApiKey = request.headers.get("x-ck-api-key");

  let rawKey: string | null = null;
  if (authHeader?.startsWith("Bearer ")) {
    rawKey = authHeader.substring(7).trim();
  } else if (xApiKey) {
    rawKey = xApiKey.trim();
  }

  if (!rawKey) {
    return {
      auth: null,
      error: NextResponse.json(
        {
          error: "missing_api_key",
          message: "API key required. Supply it via 'Authorization: Bearer <key>' or 'X-Ck-Api-Key: <key>' header.",
        },
        { status: 401, headers: { "X-Ck-Error": "missing_api_key" } }
      ),
    };
  }

  const keyHash = hashApiKey(rawKey);

  const { data: apiKey, error } = await supabaseAdmin
    .from("api_keys")
    .select("id, partner_id, scopes, rate_limit, revoked, partners(id, name, email)")
    .eq("key_hash", keyHash)
    .single();

  if (error || !apiKey || apiKey.revoked) {
    return {
      auth: null,
      error: NextResponse.json(
        {
          error: "invalid_api_key",
          message: "The provided API key is invalid, inactive, or revoked.",
        },
        { status: 401, headers: { "X-Ck-Error": "invalid_api_key" } }
      ),
    };
  }

  if (requiredScope && (!Array.isArray(apiKey.scopes) || !apiKey.scopes.includes(requiredScope))) {
    return {
      auth: null,
      error: NextResponse.json(
        {
          error: "insufficient_scope",
          message: `Your API key lacks the required scope: '${requiredScope}'.`,
        },
        { status: 403, headers: { "X-Ck-Error": "insufficient_scope" } }
      ),
    };
  }

  const rateLimit = apiKey.rate_limit || 60;
  const rl = checkRateLimit(apiKey.id, rateLimit);

  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return {
      auth: null,
      error: NextResponse.json(
        {
          error: "rate_limit_exceeded",
          message: `Too many requests. Limit is ${rateLimit} requests per minute.`,
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(rateLimit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.ceil(rl.resetAt / 1000)),
            "Retry-After": String(retryAfter),
          },
        }
      ),
    };
  }

  // Asynchronously record last used timestamp and usage metric
  const url = new URL(request.url);
  Promise.resolve(
    supabaseAdmin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", apiKey.id)
  ).catch(() => {});

  Promise.resolve(
    supabaseAdmin.from("api_usage").insert({
      key_id: apiKey.id,
      endpoint: url.pathname,
      method: request.method,
      status_code: 200,
    })
  ).catch(() => {});

  const partnerData = Array.isArray(apiKey.partners) ? apiKey.partners[0] : (apiKey.partners as any);

  return {
    auth: {
      partnerId: apiKey.partner_id,
      partnerName: partnerData?.name || "Partner",
      keyId: apiKey.id,
      scopes: apiKey.scopes || [],
    },
    error: null,
  };
}

export function withRateLimitHeaders(response: NextResponse, keyId: string, limit: number = 60): NextResponse {
  const entry = rateLimitMap.get(keyId);
  if (entry) {
    response.headers.set("X-RateLimit-Limit", String(limit));
    response.headers.set("X-RateLimit-Remaining", String(Math.max(0, limit - entry.count)));
    response.headers.set("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));
  }
  return response;
}

export function signWebhookPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}
