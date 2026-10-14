"use client";

import { useEffect, useMemo, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin,
  Clock,
  Banknote,
  CheckCircle2,
  XCircle,
  Smartphone,
  Globe,
  ArrowUpRight,
  Loader2,
  AlertTriangle,
  Navigation,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// ---------- helpers: robust param extraction ----------
function decodeNestedParam(raw: string | null): string {
  if (!raw) return "";
  try {
    // Handle double-encoded + whatsapp-style: deeplink=com.charterkeke.mobile//driver/ride-details?rideId=...
    let decoded = raw;
    // try up to 2 decode passes
    for (let i = 0; i < 2; i++) {
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch {
        break;
      }
    }
    return decoded.trim();
  } catch {
    return raw.trim();
  }
}

function pickParam(params: URLSearchParams, keys: string[]): string {
  for (const k of keys) {
    const v = params.get(k);
    if (v && v.trim()) return v.trim();
  }
  return "";
}

function extractRideIdFromDeeplink(deeplink: string): string {
  if (!deeplink) return "";
  try {
    // Normalize: com.charterkeke.mobile//driver/ride-details?rideId=xxx  -> extract query
    const qIndex = deeplink.indexOf("?");
    if (qIndex === -1) {
      // maybe deeplink is just ride id?
      return "";
    }
    const query = deeplink.slice(qIndex + 1);
    const sp = new URLSearchParams(query);
    return (
      sp.get("rideId") ||
      sp.get("ride_id") ||
      sp.get("rideID") ||
      sp.get("id") ||
      ""
    );
  } catch {
    return "";
  }
}

function buildAppLink(rideId: string, action?: string): string {
  // Canonical deep link the mobile app understands: charterkeke://driver/ride-details?rideId=...
  // Expo apps also handle com.charterkeke.mobile:// but charterkeke:// is our brand scheme
  if (!rideId) return "charterkeke://";
  const base = `charterkeke://driver/ride-details?rideId=${encodeURIComponent(rideId)}`;
  if (action === "accept" || action === "reject") return `${base}&action=${action}`;
  return base;
}

function buildUniversalLink(rideId: string): string {
  // Universal link fallback for iOS/Android when app not installed — stays on web
  if (!rideId) return "/update";
  return `/update?rideId=${encodeURIComponent(rideId)}`;
}

// ---------- main component (wrapped in Suspense below) ----------
function UpdatePageInner() {
  const searchParams = useSearchParams();

  const { rideId, deeplinkRaw, actionHint, sourceHint } = useMemo(() => {
    const rawDeeplink = pickParam(searchParams, ["deeplink", "deep_link", "deepLink", "link", "url", "appUrl"]);
    const decodedDeeplink = decodeNestedParam(rawDeeplink);
    const directRideId = pickParam(searchParams, ["rideId", "ride_id", "rideID", "id", "ride"]);
    const fromDeeplinkRideId = extractRideIdFromDeeplink(decodedDeeplink);
    const rideId = directRideId || fromDeeplinkRideId || "";

    const actionHint = pickParam(searchParams, ["action", "a", "do"]).toLowerCase();
    const sourceHint = pickParam(searchParams, ["source", "src", "utm_source", "channel"]);
    return { rideId, deeplinkRaw: decodedDeeplink, actionHint, sourceHint };
  }, [searchParams]);

  const appLink = useMemo(() => buildAppLink(rideId, actionHint || undefined), [rideId, actionHint]);

  // Ride fetch (web continuation)
  const [ride, setRide] = useState<any | null>(null);
  const [rideLoading, setRideLoading] = useState(false);
  const [rideError, setRideError] = useState<string | null>(null);

  // Action state (web accept/reject)
  const [webActionLoading, setWebActionLoading] = useState<"accept" | "reject" | null>(null);
  const [webActionError, setWebActionError] = useState<string | null>(null);
  const [webActionSuccess, setWebActionSuccess] = useState<string | null>(null);

  // Deeplink prompt modal
  const [showDeeplinkPrompt, setShowDeeplinkPrompt] = useState(false);
  const [deeplinkAttempted, setDeeplinkAttempted] = useState(false);
  const isMobile = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }, []);

  // Fetch ride if we have an id — uses public-slow path: try /api/rides/[id] then fall back to generic
  useEffect(() => {
    if (!rideId) return;
    let cancelled = false;
    setRideLoading(true);
    setRideError(null);
    // Try to fetch ride summary. If endpoint requires auth, we gracefully degrade.
    fetch(`/api/rides/${encodeURIComponent(rideId)}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          // Try dispatched/public view or keep showing link-only UI
          const text = await r.text().catch(() => "");
          throw new Error(text || `Ride not found (${r.status})`);
        }
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        // API returns { ride: {...}} or just {...}
        setRide(data.ride || data.data || data);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setRideError(e?.message || "Unable to load ride details. You can still open it in the app.");
      })
      .finally(() => {
        if (!cancelled) setRideLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rideId]);

  // Auto-show deeplink prompt on mobile shortly after load
  useEffect(() => {
    if (!rideId) return;
    if (!isMobile) return;
    const t = setTimeout(() => setShowDeeplinkPrompt(true), 700);
    return () => clearTimeout(t);
  }, [rideId, isMobile]);

  const tryOpenApp = useCallback(() => {
    setDeeplinkAttempted(true);
    setShowDeeplinkPrompt(false);
    // Attempt app scheme, then fallback to universal link if app not installed.
    // We use a hidden iframe + timeout detection.
    const start = Date.now();
    const fallbackDelay = 1800;

    // Primary: charterkeke://
    window.location.href = appLink;

    // If user still here after delay, they don't have the app — stay on web
    setTimeout(() => {
      if (Date.now() - start < fallbackDelay + 300) return;
      // Heuristic: if page is still visible, app didn't open — keep them here
      if (document.visibilityState === "visible") {
        setWebActionError(null);
        // subtle nudge: ensure the web continuation card is in view
        document.getElementById("continue-on-web")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, fallbackDelay);
  }, [appLink]);

  const handleWebAction = useCallback(
    async (action: "accept" | "reject") => {
      if (!rideId) return;
      setWebActionLoading(action);
      setWebActionError(null);
      setWebActionSuccess(null);
      try {
        // Reject is client-side navigation to cancel flow or direct API if we have it
        if (action === "reject") {
          // If driver is logged in on web, we can call a lightweight reject endpoint
          // Fall back to just showing guidance if endpoint 401
          const res = await fetch(`/api/rides/${encodeURIComponent(rideId)}/reject`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: "declined_from_sms_link" }),
          });
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            if (res.status === 401) {
              window.location.href = `/auth/login?next=${encodeURIComponent(`/update?rideId=${rideId}&action=reject`)}`;
              return;
            }
            throw new Error(j.error || j.message || "Unable to decline on web. Please open in the app.");
          }
          setWebActionSuccess("Ride declined. You can browse other requests on the web.");
          return;
        }

        // Accept on web
        const res = await fetch("/api/driver/accept-ride", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rideId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 401) {
            window.location.href = `/auth/login?next=${encodeURIComponent(`/update?rideId=${rideId}&action=accept`)}`;
            return;
          }
          throw new Error(data.error || data.message || "Could not accept this ride. It may already be taken.");
        }
        setWebActionSuccess("Ride accepted on the web! Head to your dashboard to start the trip.");
        // Optional: redirect to driver dashboard after short delay
        setTimeout(() => {
          window.location.href = `/driver/ride-details?rideId=${rideId}`;
        }, 900);
      } catch (e: any) {
        setWebActionError(e.message || "Something went wrong. Please try opening in the app.");
      } finally {
        setWebActionLoading(null);
      }
    },
    [rideId]
  );

  const hasRide = !!rideId;
  const shortRef = hasRide ? `CK-${rideId.slice(0, 8).toUpperCase()}` : "—";
  const statusLabel: string = ride?.status || (actionHint === "accept" ? "pending acceptance" : "ride request");
  const isDispatched = !ride || ride.status === "dispatched" || ride.status === "pending";

  return (
    <div className="min-h-screen bg-background relative overflow-hidden flex flex-col">
      {/* ambient background like homepage */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-muted/40" />
        <div className="absolute -top-24 right-0 h-[480px] w-[480px] rounded-full blur-3xl opacity-20 dark:opacity-10" style={{ background: "radial-gradient(40% 40% at 50% 50%, var(--brand-glow), transparent 70%)" }} />
        <div className="absolute -bottom-24 -left-24 h-[520px] w-[520px] rounded-full blur-3xl opacity-10" style={{ background: "radial-gradient(40% 40% at 50% 50%, oklch(0.68 0.17 55 / 0.15), transparent 70%)" }} />
      </div>

      {/* minimal top bar */}
      <header className="sticky top-0 z-20 backdrop-blur-xl bg-background/60 border-b border-border/50">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/charter keke.png" alt="Charter Keke" width={36} height={36} className="rounded-lg" />
            <span className="text-[15px] font-bold tracking-tight bg-gradient-to-r from-[#AF6401] to-[#EE8906] dark:from-[#FCE6C9] dark:to-[#F0D1A8] bg-clip-text text-transparent">
              CHARTER KEKE
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="hidden sm:inline-flex gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Official ride link
            </Badge>
            <Link href="/" className="text-xs text-muted-foreground hover:text-foreground hidden sm:inline-flex items-center gap-1">
              Back to home <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6 sm:py-10 grid lg:grid-cols-[1.15fr_0.85fr] gap-6 lg:gap-8">
        {/* Left: ride context + web actions */}
        <div className="space-y-6">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {hasRide ? "You have a ride update" : "Ride link"}
            </h1>
            <p className="text-sm sm:text-[15px] text-muted-foreground mt-2 max-w-prose">
              This page was opened from an SMS notification. You can continue here on the web, or continue seamlessly in the Charter Keke app.
              {sourceHint === "sms" || deeplinkRaw ? (
                <span className="block mt-1 text-xs">Tip: links like <code className="px-1 py-0.5 rounded bg-muted text-xs">charterkeke://</code> aren&apos;t tappable in SMS — this web page makes them clickable.</span>
              ) : null}
            </p>
            {hasRide ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge className="bg-gradient-to-r from-[#AF6401] to-[#EE8906] text-white border-0">{shortRef}</Badge>
                <Badge variant={isDispatched ? "secondary" : "outline"} className="capitalize">{statusLabel}</Badge>
                {deeplinkRaw ? <Badge variant="outline" className="font-mono text-[11px] max-w-[220px] truncate" title={deeplinkRaw}>via {deeplinkRaw.slice(0, 36)}…</Badge> : null}
              </div>
            ) : null}
          </motion.div>

          {/* Ride card */}
          <Card className="overflow-hidden border-border/60 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Navigation className="h-4 w-4 text-primary" />
                Ride details
                {rideLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-2" /> : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!hasRide ? (
                <div className="rounded-xl border border-dashed p-6 text-center">
                  <AlertTriangle className="h-8 w-8 mx-auto text-amber-600 mb-3" />
                  <p className="text-sm font-medium">No ride was attached to this link</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Check the SMS again and tap the full <span className="font-mono">charterkeke.com/update?rideId=...</span> link. If you typed it, ensure the ride ID is complete.
                  </p>
                  <div className="mt-4 flex justify-center gap-2">
                    <Link href="/auth/login">
                      <Button variant="outline" size="sm">Go to login</Button>
                    </Link>
                    <Link href="/">
                      <Button size="sm">Browse Charter Keke</Button>
                    </Link>
                  </div>
                </div>
              ) : rideError ? (
                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-4 text-sm">
                  <p className="font-medium text-amber-900 dark:text-amber-100 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> We couldn&apos;t load live details
                  </p>
                  <p className="text-amber-800/80 dark:text-amber-200/80 mt-1">{rideError}</p>
                  <p className="text-xs text-muted-foreground mt-2">You can still open the ride in the app or accept/decline below — we&apos;ll handle it on the server.</p>
                </div>
              ) : null}

              {hasRide ? (
                <div className="grid gap-4">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-muted/50 border p-4">
                      <p className="text-[11px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5" /> Pickup
                      </p>
                      <p className="text-sm font-semibold mt-1 line-clamp-3">{ride?.pickup_zone || ride?.pickup_description || "Pickup zone will appear after acceptance"}</p>
                      {ride?.pickup_description ? <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{ride.pickup_description}</p> : null}
                    </div>
                    <div className="rounded-2xl bg-muted/50 border p-4">
                      <p className="text-[11px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5" /> Destination
                      </p>
                      <p className="text-sm font-semibold mt-1 line-clamp-3">{ride?.destination_zone || ride?.destination_description || "Destination"}</p>
                      {ride?.destination_description ? <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{ride.destination_description}</p> : null}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-2xl border p-3">
                      <p className="text-[11px] uppercase tracking-widest text-muted-foreground flex items-center gap-1"><Banknote className="h-3.5 w-3.5" /> Fare</p>
                      <p className="text-sm font-bold mt-1">₦{ride?.fare ? Math.round(Number(ride.fare)).toLocaleString() : "—"}</p>
                    </div>
                    <div className="rounded-2xl border p-3">
                      <p className="text-[11px] uppercase tracking-widest text-muted-foreground flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Pickup</p>
                      <p className="text-sm font-medium mt-1 line-clamp-1">{ride?.pickup_time ? new Date(ride.pickup_time).toLocaleString("en-NG", { timeZone: "Africa/Lagos", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "ASAP"}</p>
                    </div>
                    <div className="rounded-2xl border p-3">
                      <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Ride ID</p>
                      <p className="text-[11px] font-mono mt-1 truncate" title={rideId}>{shortRef}</p>
                    </div>
                  </div>

                  {(webActionError || webActionSuccess) ? (
                    <div className={`rounded-xl border p-3 text-sm ${webActionSuccess ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-100" : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-900 dark:text-red-100"}`}>
                      {webActionSuccess ? <span className="flex gap-2"><CheckCircle2 className="h-4 w-4 mt-0.5" /> {webActionSuccess}</span> : <span className="flex gap-2"><XCircle className="h-4 w-4 mt-0.5" /> {webActionError}</span>}
                    </div>
                  ) : null}

                  {/* Web continuation actions */}
                  <div id="continue-on-web" className="rounded-2xl border bg-card p-4">
                    <p className="text-sm font-semibold flex items-center gap-2"><Globe className="h-4 w-4" /> Continue on the web</p>
                    <p className="text-xs text-muted-foreground mt-1">No app needed. If you&apos;re a driver, accept or decline right here. We&apos;ll keep the ride in sync across SMS, push, and app.</p>
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Button
                        disabled={!hasRide || !!webActionLoading}
                        onClick={() => handleWebAction("accept")}
                        className="h-11 bg-gradient-to-r from-[#AF6401] to-[#EE8906] hover:opacity-90 text-white"
                      >
                        {webActionLoading === "accept" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        Accept on web
                      </Button>
                      <Button
                        variant="outline"
                        disabled={!hasRide || !!webActionLoading}
                        onClick={() => handleWebAction("reject")}
                        className="h-11"
                      >
                        {webActionLoading === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                        Decline on web
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-3">
                      You&apos;ll be asked to log in if you&apos;re not already. After acceptance we take you to the ride page automatically.
                    </p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* <Card className="border-dashed">
            <CardContent className="pt-6 text-xs text-muted-foreground space-y-2">
              <p className="font-medium text-foreground">How this link works</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>SMS apps can&apos;t tap <code className="px-1 py-0.5 rounded bg-muted">charterkeke://</code> links. We wrap them in a clickable web URL: <code className="px-1 py-0.5 rounded bg-muted">charterkeke.com/update?rideId=...</code>.</li>
                <li>This page reads <code className="px-1 py-0.5 rounded bg-muted">rideId</code>, <code className="px-1 py-0.5 rounded bg-muted">deeplink</code>, and <code className="px-1 py-0.5 rounded bg-muted">action</code> robustly — even when double-encoded or using alternate names like <code className="px-1 py-0.5 rounded bg-muted">ride_id</code>.</li>
                <li>Accept/decline works both in-app and on-web. The server is the source of truth, so the status stays consistent.</li>
              </ul>
            </CardContent>
          </Card> */}
        </div>

        {/* Right: app handover */}
        <div className="space-y-6 lg:sticky lg:top-[72px] h-fit">
          <Card className="overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-[#AF6401] to-[#EE8906]" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Smartphone className="h-4 w-4" /> Open in the Charter Keke app
              </CardTitle>
              <p className="text-sm text-muted-foreground">Fastest for drivers — one tap to the ride screen in the native app.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border bg-muted/40 p-4 flex items-center gap-3">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-[#AF6401] to-[#EE8906] flex items-center justify-center text-white font-black">
                  <Image src="/charter keke.png" alt="Charter Keke" width={48} height={48} className="h-12 w-12" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-none">Charter Keke — Driver & Rider</p>
                  <p className="text-xs text-muted-foreground mt-1 truncate">Deeplink: <span className="font-mono">{appLink}</span></p>
                </div>
                <Badge variant="secondary" className="hidden sm:inline-flex">App</Badge>
              </div>

              <Button onClick={tryOpenApp} disabled={!hasRide} className="w-full h-11 bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90">
                <ExternalLink className="h-4 w-4" />
                {deeplinkAttempted ? "Try opening again" : "Open in app"}
              </Button>

              <div className="grid grid-cols-2 gap-3">
                <Button asChild variant="outline" disabled={!hasRide} className="h-11">
                  <a href={hasRide ? `charterkeke://driver/ride-details?rideId=${encodeURIComponent(rideId)}&action=accept` : "#"}>Accept in app</a>
                </Button>
                <Button asChild variant="outline" disabled={!hasRide} className="h-11">
                  <a href={hasRide ? `charterkeke://driver/ride-details?rideId=${encodeURIComponent(rideId)}&action=reject` : "#"}>Reject in app</a>
                </Button>
              </div>

              <p className="text-[11px] text-muted-foreground">
                If the app isn&apos;t installed, you&apos;ll stay on this page and can continue on the web above. On iPhone, confirm &ldquo;Open&rdquo; when prompted.
              </p>


              {!hasRide ? null : (
                <div className="flex flex-wrap gap-2 pt-2">
                  <Link href={buildUniversalLink(rideId)} className="text-xs underline underline-offset-4 text-muted-foreground hover:text-foreground">Copyable web link</Link>
                  <span className="text-xs text-muted-foreground">·</span>
                  <a href={appLink} className="text-xs underline underline-offset-4 text-muted-foreground hover:text-foreground">Direct app link</a>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="text-sm font-semibold">Prefer the web?</p>
              <div className="grid grid-cols-2 gap-3">
                <Link href={hasRide ? `/driver/ride-details?rideId=${rideId}` : "/auth/login"}>
                  <Button variant="secondary" className="w-full">Driver web view</Button>
                </Link>
                <Link href={hasRide ? `/rider/active-ride?rideId=${rideId}` : "/auth/login"}>
                  <Button variant="secondary" className="w-full">Rider web view</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      <footer className="mx-auto max-w-6xl w-full px-4 py-8 text-center text-xs text-muted-foreground">
        <span>© {new Date().getFullYear()} Charter Keke. Need help? <Link href="/contact" className="underline underline-offset-4">Contact support</Link></span>
      </footer>

      {/* Browser deeplink prompt */}
      <AnimatePresence>
        {showDeeplinkPrompt ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
            <button aria-label="Close" onClick={() => setShowDeeplinkPrompt(false)} className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <motion.div initial={{ y: 20, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 10, opacity: 0, scale: 0.98 }} className="relative w-full max-w-md rounded-[24px] bg-card border shadow-2xl overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-[#AF6401] to-[#EE8906]" />
              <div className="p-6">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-[#AF6401] to-[#EE8906] flex items-center justify-center text-white font-black mx-auto">CK</div>
                <h3 className="text-base font-bold text-center mt-3">Open in Charter Keke?</h3>
                <p className="text-sm text-muted-foreground text-center mt-1">We can open this ride directly in the app for the fastest acceptance. Or stay here and continue on the web.</p>
                <div className="mt-5 grid grid-cols-1 gap-3">
                  <Button onClick={tryOpenApp} className="h-11 bg-gradient-to-r from-[#AF6401] to-[#EE8906] text-white">
                    <Smartphone className="h-4 w-4" /> Open in app
                  </Button>
                  <Button variant="outline" onClick={() => setShowDeeplinkPrompt(false)} className="h-11">
                    <Globe className="h-4 w-4" /> Continue on web
                  </Button>
                  <p className="text-[11px] text-center text-muted-foreground">If the app isn&apos;t installed, you&apos;ll stay here automatically.</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default function UpdatePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <UpdatePageInner />
    </Suspense>
  );
}
