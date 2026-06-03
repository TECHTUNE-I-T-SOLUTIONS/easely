import { NextRequest, NextResponse } from "next/server";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://charterkeke.com",
  "https://www.charterkeke.com",
  "https://charterkeke.vercel.app",
  "http://localhost:3000",
  "http://localhost:8081",
  "http://127.0.0.1:3000",
];

const getAllowedOrigins = () => {
  const configuredOrigins = process.env.ALLOWED_CORS_ORIGINS || process.env.NEXT_PUBLIC_APP_BASE_URL || "";
  const origins = configuredOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...origins]);
};

const applyCorsHeaders = (response: NextResponse, request: NextRequest) => {
  const origin = request.headers.get("origin");
  const allowedOrigins = getAllowedOrigins();

  if (origin && allowedOrigins.has(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.append("Vary", "Origin");
  }

  response.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, X-CRM-Email-Secret, X-Termii-Signature"
  );
  response.headers.set("Access-Control-Max-Age", "86400");

  return response;
};

/**
 * Proxy to protect routes and enforce role-based access
 * Note: NextAuth session checks are done client-side via auth context
 */
export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/api/")) {
    if (request.method === "OPTIONS") {
      return applyCorsHeaders(new NextResponse(null, { status: 204 }), request);
    }

    return applyCorsHeaders(NextResponse.next(), request);
  }

  // Public routes - no auth required
  const publicRoutes = [
    "/",
    "/auth/login",
    "/auth/register",
    "/auth/complete-profile",
    "/auth/admin/login",
    "/auth/admin/signup",
    "/auth/admin/forgot-password",
    "/auth/admin/reset-password",
    "/how-it-works",
    "/pricing",
    "/about",
    "/contact",
    "/privacy",
    "/terms",
    "/safety",
    "/faq",
    "/help",
    "/api/auth",
    "/api/upload",
    "/offline",
  ];

  // Check if route is public
  if (publicRoutes.some(route => pathname === route || pathname.startsWith(route + "/"))) {
    return NextResponse.next();
  }

  // For protected routes, allow request to proceed and let client-side auth handle it
  // Protected routes will redirect to login via useAuth hook if user isn't authenticated
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/((?!_next/static|_next/image|favicon.ico|public|sw.js).*)",
  ],
};
