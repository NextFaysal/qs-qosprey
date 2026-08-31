import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { UserRole, UserStatus } from "@prisma/client";

const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-key";
const TOKEN_EXPIRY = "7d";

export interface JWTPayload {
  userId: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  iat?: number;
  exp?: number;
}

/**
 * Hash a plain-text password
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

/**
 * Compare a plain-text password with a hashed one
 */
export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

/**
 * Create a JWT token for a user
 */
export function createToken(payload: Omit<JWTPayload, "iat" | "exp">): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Extract token from Authorization header or cookie
 */
export function extractToken(request: Request): string | null {
  // Try Authorization header first
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Try cookie
  const cookieHeader = request.headers.get("Cookie");
  if (cookieHeader) {
    const cookies = cookieHeader.split(";").reduce(
      (acc, cookie) => {
        const [key, value] = cookie.trim().split("=");
        acc[key] = value;
        return acc;
      },
      {} as Record<string, string>
    );
    return cookies["pepeshops-token"] || null;
  }

  return null;
}

/**
 * Get authenticated user from request
 */
export function getAuthUser(request: Request): JWTPayload | null {
  const token = extractToken(request);
  if (!token) return null;
  return verifyToken(token);
}

/**
 * Check if user is authorized to perform active operations (must be APPROVED or ADMIN)
 */
export function isUserActive(user?: { status?: UserStatus; role?: UserRole } | null): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  return user.status === "APPROVED";
}

/**
 * Set auth cookie in response headers with secure flags
 */
export function setAuthCookie(token: string): string {
  const maxAge = 7 * 24 * 60 * 60; // 7 days
  const isProd = process.env.NODE_ENV === "production";
  return `pepeshops-token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isProd ? "; Secure" : ""}`;
}

/**
 * Clear auth cookie
 */
export function clearAuthCookie(): string {
  const isProd = process.env.NODE_ENV === "production";
  return `pepeshops-token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd ? "; Secure" : ""}`;
}
