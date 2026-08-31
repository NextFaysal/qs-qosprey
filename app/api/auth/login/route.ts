import { prisma } from "@/app/_lib/db";
import { verifyPassword, createToken, setAuthCookie } from "@/app/_lib/auth";
import { checkRateLimit, getClientIp } from "@/app/_lib/rate-limit";

export async function POST(request: Request) {
  try {
    // 1. Rate limiting: max 10 attempts per minute per IP
    const clientIp = getClientIp(request);
    const rateCheck = checkRateLimit(`login:${clientIp}`, 10, 60 * 1000);
    if (!rateCheck.allowed) {
      return Response.json(
        {
          error: `অনেক বেশি লগইন চেষ্টা করা হয়েছে। অনুগ্রহ করে ${rateCheck.retryAfterSeconds} সেকেন্ড পর চেষ্টা করুন।`,
          retryAfter: rateCheck.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateCheck.retryAfterSeconds),
          },
        }
      );
    }

    const body = await request.json();
    const { email, password } = body;

    // Validation
    if (!email || !password) {
      return Response.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      return Response.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      return Response.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Check user status
    if (user.status === "PENDING") {
      return Response.json(
        {
          error: "আপনার একাউন্ট এখনো approve হয়নি। অনুগ্রহ করে অপেক্ষা করুন।",
          code: "PENDING_APPROVAL",
        },
        { status: 403 }
      );
    }

    if (user.status === "REJECTED") {
      return Response.json(
        {
          error: "আপনার একাউন্ট reject করা হয়েছে। Admin-এর সাথে যোগাযোগ করুন।",
          code: "REJECTED",
        },
        { status: 403 }
      );
    }

    // Create JWT token
    const token = createToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    });

    // Set cookie
    const cookieValue = setAuthCookie(token);

    return new Response(
      JSON.stringify({
        message: "Login successful",
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
        },
        token,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": cookieValue,
        },
      }
    );
  } catch (error) {
    console.error("Login error:", error);
    return Response.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
