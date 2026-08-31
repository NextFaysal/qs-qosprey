import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/register", "/api/auth/login", "/api/auth/register"];

function decodeJwtPayload(token: string): { role?: string; exp?: number; status?: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const json = Buffer.from(parts[1], "base64url").toString();
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("pepeshops-token")?.value;
  const decoded = token ? decodeJwtPayload(token) : null;
  const isTokenExpired = decoded?.exp ? Date.now() >= decoded.exp * 1000 : true;
  const isValidToken = Boolean(token && decoded && !isTokenExpired);

  // If user has a valid active token and visits /login or /register, redirect to /dashboard
  if (isValidToken && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Allow public paths
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // Allow static files and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // If no valid token or token is expired
  if (!isValidToken) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const response = NextResponse.redirect(new URL("/login", request.url));
    if (token && isTokenExpired) {
      // Clear expired cookie
      response.cookies.set("pepeshops-token", "", { maxAge: 0, path: "/" });
    }
    return response;
  }

  // Admin route protection: must have role === 'ADMIN'
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    if (decoded?.role !== "ADMIN") {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
