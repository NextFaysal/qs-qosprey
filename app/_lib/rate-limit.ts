/**
 * In-Memory Sliding Window Rate Limiter
 * Protects auth endpoints (login, register) from brute-force & denial of service attacks.
 */

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const ipMap = new Map<string, RateLimitRecord>();

// Cleanup stale records periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of ipMap.entries()) {
    if (now >= record.resetAt) {
      ipMap.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Check if an IP/key has exceeded max allowed requests in a time window
 * @param key Unique identifier (IP address, email, etc.)
 * @param maxAttempts Maximum allowed attempts
 * @param windowMs Time window in milliseconds (default 60s)
 */
export function checkRateLimit(
  key: string,
  maxAttempts: number = 10,
  windowMs: number = 60 * 1000
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const now = Date.now();
  const record = ipMap.get(key);

  if (!record || now >= record.resetAt) {
    ipMap.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return {
      allowed: true,
      remaining: maxAttempts - 1,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  if (record.count >= maxAttempts) {
    const retryAfter = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: retryAfter,
    };
  }

  record.count += 1;
  return {
    allowed: true,
    remaining: maxAttempts - record.count,
    retryAfterSeconds: Math.ceil((record.resetAt - now) / 1000),
  };
}

/**
 * Extract client IP from request headers
 */
export function getClientIp(request: Request): string {
  const headers = request.headers;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  const cfConnectingIp = headers.get("cf-connecting-ip");
  if (cfConnectingIp) {
    return cfConnectingIp.trim();
  }
  return "127.0.0.1";
}
