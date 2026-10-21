"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Code2,
  Copy,
  Check,
  Key,
  ShieldAlert,
  Gauge,
  Webhook,
  Car,
  Users,
  Terminal,
  ChevronRight,
  Menu,
  X,
  ExternalLink,
  BookOpen,
} from "lucide-react";

export default function PublicApiDocsPage() {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Record<string, "curl" | "node" | "python">>({
    ridesCreate: "curl",
    ridesGet: "curl",
    drivers: "curl",
    webhookSample: "node",
  });

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(id);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const navLinks = [
    { href: "#overview", label: "Overview", icon: BookOpen },
    { href: "#authentication", label: "Authentication", icon: Key },
    { href: "#rate-limits", label: "Rate Limits", icon: Gauge },
    { href: "#errors", label: "Error Handling", icon: ShieldAlert },
    { href: "#endpoint-rides", label: "POST /rides", icon: Car },
    { href: "#endpoint-ride-status", label: "GET /rides/{id}", icon: Car },
    { href: "#endpoint-ride-cancel", label: "POST /rides/{id}/cancel", icon: Car },
    { href: "#endpoint-drivers", label: "GET /drivers/available", icon: Users },
    { href: "#webhooks", label: "Webhooks", icon: Webhook },
  ];

  return (
    <div className="flex flex-col min-h-screen selection:bg-[#F5820B]/30 selection:text-[#F5820B]">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 w-full border-b border-[var(--border)] bg-[var(--background)]/90 backdrop-blur-md">
        <div className="flex h-16 items-center justify-between px-4 sm:px-8 max-w-7xl mx-auto w-full">
          <div className="flex items-center space-x-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#F5820B] to-[#AF6401] flex items-center justify-center shadow-lg shadow-[#F5820B]/20">
              <span className="font-extrabold text-black text-sm tracking-tighter">CK</span>
            </div>
            <div className="flex items-baseline space-x-2">
              <span className="font-bold text-lg tracking-tight">Charter Keke</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-[#F5820B]/15 text-[#F5820B] border border-[#F5820B]/30">
                API v1
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <Link
              href="/"
              className="text-sm font-medium text-[var(--muted-foreground)] hover:text-[#F5820B] transition-colors hidden sm:inline-flex items-center gap-1"
            >
              Main Website <ExternalLink className="w-3.5 h-3.5" />
            </Link>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg border border-[var(--border)] lg:hidden"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-8 py-8 flex gap-8">
        {/* Desktop Sidebar */}
        <aside className="w-64 shrink-0 hidden lg:block sticky top-24 h-[calc(100vh-7rem)] overflow-y-auto pr-4 scrollbar-thin">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-3 px-3">
            API Documentation
          </p>
          <nav className="space-y-1">
            {navLinks.map((link) => {
              const Icon = link.icon;
              return (
                <a
                  key={link.href}
                  href={link.href}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg font-medium text-[var(--foreground)]/80 hover:text-black hover:bg-[#F5820B] transition-all group"
                >
                  <Icon className="w-4 h-4 text-[#F5820B] group-hover:text-black transition-colors" />
                  <span>{link.label}</span>
                </a>
              );
            })}
          </nav>
        </aside>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 top-16 z-30 bg-[var(--background)]/95 backdrop-blur-md p-6 lg:hidden overflow-y-auto">
            <nav className="space-y-2">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 p-3 rounded-lg text-base font-medium hover:bg-[#F5820B]/10 hover:text-[#F5820B]"
                >
                  <link.icon className="w-5 h-5 text-[#F5820B]" />
                  <span>{link.label}</span>
                </a>
              ))}
            </nav>
          </div>
        )}

        {/* Content Body */}
        <main className="flex-1 min-w-0 max-w-4xl space-y-16 pb-24">
          {/* Hero / Overview */}
          <section id="overview" className="space-y-4">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Charter Keke <span className="text-[#F5820B]">Partner API</span>
            </h1>
            <p className="text-base sm:text-lg text-[var(--muted-foreground)] leading-relaxed">
              Connect external booking portals, merchant dispatch systems, hotel concierge desks, and corporate platforms
              directly with the Charter Keke dispatch network. Request rides, check driver status in real time, and receive
              cryptographically signed webhook status callbacks.
            </p>
            <div className="p-4 rounded-xl border border-[#F5820B]/30 bg-[#F5820B]/5 flex items-start gap-3">
              <span className="text-xl">⚡</span>
              <div className="text-sm">
                <span className="font-semibold text-[#F5820B]">Base URL: </span>
                <code className="bg-[var(--card)] px-2 py-0.5 rounded border border-[var(--border)] font-mono text-xs">
                  https://charterkeke.com/api/ck/v1
                </code>
              </div>
            </div>
          </section>

          {/* Authentication */}
          <section id="authentication" className="space-y-6 scroll-mt-24">
            <div className="flex items-center gap-2 border-b border-[var(--border)] pb-3">
              <Key className="w-6 h-6 text-[#F5820B]" />
              <h2 className="text-2xl font-bold">Authentication</h2>
            </div>
            <p className="text-[var(--muted-foreground)] leading-relaxed">
              All requests to the Charter Keke Public API must authenticate using a pre-provisioned Partner API Key.
              Keys can be transmitted either in the <code className="text-[#F5820B] font-mono">Authorization</code> header
              as a Bearer token or via the <code className="text-[#F5820B] font-mono">X-Ck-Api-Key</code> custom header.
            </p>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
              <div className="flex justify-between items-center px-4 py-2 bg-[var(--muted)]/50 border-b border-[var(--border)] text-xs font-mono">
                <span>Request Headers</span>
                <button
                  onClick={() =>
                    copyToClipboard(
                      `Authorization: Bearer ck_live_sampleKey9928374\nX-Ck-Api-Key: ck_live_sampleKey9928374`,
                      "authHeaders"
                    )
                  }
                  className="flex items-center gap-1 text-[var(--muted-foreground)] hover:text-[#F5820B]"
                >
                  {copiedSection === "authHeaders" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSection === "authHeaders" ? "Copied" : "Copy"}</span>
                </button>
              </div>
              <pre className="p-4 font-mono text-xs sm:text-sm overflow-x-auto text-emerald-400 bg-black/90">
                {`Authorization: Bearer ck_live_xxxxxxxxxxxxxxxxxxxx
X-Ck-Api-Key: ck_live_xxxxxxxxxxxxxxxxxxxx`}
              </pre>
            </div>
          </section>

          {/* Rate Limits */}
          <section id="rate-limits" className="space-y-6 scroll-mt-24">
            <div className="flex items-center gap-2 border-b border-[var(--border)] pb-3">
              <Gauge className="w-6 h-6 text-[#F5820B]" />
              <h2 className="text-2xl font-bold">Rate Limits</h2>
            </div>
            <p className="text-[var(--muted-foreground)]">
              API requests are metered on a rolling 1-minute window. Standard partner tier limits are set to{" "}
              <strong className="text-[var(--foreground)]">60 requests/minute</strong>. Every response includes standard
              rate-limiting headers:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { name: "X-RateLimit-Limit", desc: "Max requests permitted per 60s window." },
                { name: "X-RateLimit-Remaining", desc: "Remaining quota in current active window." },
                { name: "X-RateLimit-Reset", desc: "Unix timestamp (seconds) until quota refresh." },
              ].map((hdr) => (
                <div key={hdr.name} className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--card)] space-y-1">
                  <div className="font-mono text-xs font-semibold text-[#F5820B]">{hdr.name}</div>
                  <div className="text-xs text-[var(--muted-foreground)]">{hdr.desc}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Error Codes */}
          <section id="errors" className="space-y-6 scroll-mt-24">
            <div className="flex items-center gap-2 border-b border-[var(--border)] pb-3">
              <ShieldAlert className="w-6 h-6 text-[#F5820B]" />
              <h2 className="text-2xl font-bold">Error Codes</h2>
            </div>
            <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-[var(--muted)]/50 border-b border-[var(--border)] text-xs uppercase font-mono">
                  <tr>
                    <th className="p-3">Status</th>
                    <th className="p-3">Error Code</th>
                    <th className="p-3">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] font-mono">
                  <tr>
                    <td className="p-3 text-amber-500 font-bold">400</td>
                    <td className="p-3 font-semibold">invalid_payload</td>
                    <td className="p-3 font-sans text-[var(--muted-foreground)]">Missing mandatory payload fields.</td>
                  </tr>
                  <tr>
                    <td className="p-3 text-red-500 font-bold">401</td>
                    <td className="p-3 font-semibold">missing_api_key / invalid_api_key</td>
                    <td className="p-3 font-sans text-[var(--muted-foreground)]">API Key missing, unhashed, revoked or invalid.</td>
                  </tr>
                  <tr>
                    <td className="p-3 text-red-400 font-bold">403</td>
                    <td className="p-3 font-semibold">insufficient_scope</td>
                    <td className="p-3 font-sans text-[var(--muted-foreground)]">Key lacks permission scope for this action.</td>
                  </tr>
                  <tr>
                    <td className="p-3 text-yellow-500 font-bold">404</td>
                    <td className="p-3 font-semibold">ride_not_found</td>
                    <td className="p-3 font-sans text-[var(--muted-foreground)]">Resource ID does not exist.</td>
                  </tr>
                  <tr>
                    <td className="p-3 text-orange-500 font-bold">429</td>
                    <td className="p-3 font-semibold">rate_limit_exceeded</td>
                    <td className="p-3 font-sans text-[var(--muted-foreground)]">Exceeded requests quota per minute.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Endpoint: Create Ride */}
          <section id="endpoint-rides" className="space-y-6 scroll-mt-24">
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-1 rounded bg-[#F5820B] text-black font-extrabold text-xs font-mono">POST</span>
              <h2 className="text-xl sm:text-2xl font-bold font-mono">/api/ck/v1/rides</h2>
            </div>
            <p className="text-[var(--muted-foreground)]">
              Create a new ride request in the Charter Keke ecosystem. Once submitted, matching drivers in the zone receive
              an instant broadcast dispatch notification.
            </p>

            {/* Request example */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
              <div className="flex justify-between items-center px-4 py-2 bg-[var(--muted)]/50 border-b border-[var(--border)] text-xs">
                <span className="font-mono text-[var(--muted-foreground)]">Payload & cURL Example</span>
                <button
                  onClick={() =>
                    copyToClipboard(
                      `curl -X POST https://charterkeke.com/api/ck/v1/rides \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "pickup_zone": "SHOMOLU",\n    "pickup_description": "Fola Agoro Junction",\n    "destination_zone": "YABA",\n    "destination_description": "Unilag Main Gate",\n    "ride_type": "single",\n    "fare_amount": 1200,\n    "rider_name": "Tunde Bakare",\n    "rider_phone": "+2348012345678"\n  }'`,
                      "curlRides"
                    )
                  }
                  className="flex items-center gap-1 text-[#F5820B]"
                >
                  {copiedSection === "curlRides" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSection === "curlRides" ? "Copied" : "Copy"}</span>
                </button>
              </div>
              <pre className="p-4 font-mono text-xs overflow-x-auto text-emerald-400 bg-black/90">
{`curl -X POST https://charterkeke.com/api/ck/v1/rides \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "pickup_zone": "SHOMOLU",
    "pickup_description": "Fola Agoro Junction",
    "destination_zone": "YABA",
    "destination_description": "Unilag Main Gate",
    "ride_type": "single",
    "fare_amount": 1200,
    "rider_name": "Tunde Bakare",
    "rider_phone": "+2348012345678"
  }'`}
              </pre>
            </div>
          </section>

          {/* Endpoint: Get Ride Status */}
          <section id="endpoint-ride-status" className="space-y-6 scroll-mt-24">
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-1 rounded bg-sky-500 text-black font-extrabold text-xs font-mono">GET</span>
              <h2 className="text-xl sm:text-2xl font-bold font-mono">/api/ck/v1/rides/&#123;id&#125;</h2>
            </div>
            <p className="text-[var(--muted-foreground)]">
              Retrieve real-time status and assigned driver telemetry for a booked ride.
            </p>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
              <pre className="p-4 font-mono text-xs overflow-x-auto text-emerald-400 bg-black/90">
{`// Response 200 OK
{
  "success": true,
  "data": {
    "id": "e215fa12-320d-4001-9f93-01bd934a1",
    "status": "accepted",
    "pickup_zone": "SHOMOLU",
    "destination_zone": "YABA",
    "fare_amount": 1200,
    "driver": {
      "driver_id": "drv_837192",
      "driver_name": "Ibrahim Musa",
      "plate_number": "SMK-492-XA",
      "vehicle_type": "keke",
      "phone_number": "+2348098765432"
    }
  }
}`}
              </pre>
            </div>
          </section>

          {/* Endpoint: Cancel Ride */}
          <section id="endpoint-ride-cancel" className="space-y-6 scroll-mt-24">
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-1 rounded bg-[#F5820B] text-black font-extrabold text-xs font-mono">POST</span>
              <h2 className="text-xl sm:text-2xl font-bold font-mono">/api/ck/v1/rides/&#123;id&#125;/cancel</h2>
            </div>
            <p className="text-[var(--muted-foreground)]">
              Cancel an active pending or dispatched ride before trip commencement.
            </p>
          </section>

          {/* Endpoint: Available Drivers */}
          <section id="endpoint-drivers" className="space-y-6 scroll-mt-24">
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-1 rounded bg-sky-500 text-black font-extrabold text-xs font-mono">GET</span>
              <h2 className="text-xl sm:text-2xl font-bold font-mono">/api/ck/v1/drivers/available</h2>
            </div>
            <p className="text-[var(--muted-foreground)]">
              Query online, verified drivers filtered by operating zone or vehicle type.
            </p>
          </section>

          {/* Webhooks */}
          <section id="webhooks" className="space-y-6 scroll-mt-24">
            <div className="flex items-center gap-2 border-b border-[var(--border)] pb-3">
              <Webhook className="w-6 h-6 text-[#F5820B]" />
              <h2 className="text-2xl font-bold">Webhooks & Event Signatures</h2>
            </div>
            <p className="text-[var(--muted-foreground)]">
              Charter Keke delivers real-time HTTP POST notifications when ride status updates. To guarantee delivery
              authenticity, each request includes a cryptographic HMAC-SHA256 signature in the{" "}
              <code className="text-[#F5820B] font-mono">X-Ck-Signature</code> header generated using your partner webhook
              secret.
            </p>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
              <div className="px-4 py-2 bg-[var(--muted)]/50 border-b border-[var(--border)] text-xs font-mono">
                Node.js Signature Verification
              </div>
              <pre className="p-4 font-mono text-xs overflow-x-auto text-emerald-400 bg-black/90">
{`import crypto from "crypto";

export function verifyCkWebhook(rawBody, signatureHeader, secret) {
  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(computed));
}`}
              </pre>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
