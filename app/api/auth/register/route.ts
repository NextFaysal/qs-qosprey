import { prisma } from "@/app/_lib/db";
import { hashPassword } from "@/app/_lib/auth";
import { checkRateLimit, getClientIp } from "@/app/_lib/rate-limit";

export async function POST(request: Request) {
  try {
    // 1. Rate limit: max 5 registrations per 10 minutes per IP
    const clientIp = getClientIp(request);
    const rateCheck = checkRateLimit(`register:${clientIp}`, 5, 10 * 60 * 1000);
    if (!rateCheck.allowed) {
      return Response.json(
        {
          error: `অনেক বেশি একাউন্ট খোলার চেষ্টা করা হয়েছে। অনুগ্রহ করে ${rateCheck.retryAfterSeconds} সেকেন্ড পর চেষ্টা করুন।`,
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
    const { name, email, password } = body;

    // Validation
    if (!name || !email || !password) {
      return Response.json(
        { error: "Name, email, and password are required" },
        { status: 400 }
      );
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return Response.json(
        { error: "Please provide a valid email address" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return Response.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existingUser) {
      return Response.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    // Create user
    const hashedPassword = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        role: "USER",
        status: "PENDING",
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });

    return Response.json(
      {
        message: "Registration successful! Please wait for admin approval.",
        user,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Registration error:", error);
    return Response.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
