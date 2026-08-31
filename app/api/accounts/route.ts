import { prisma } from "@/app/_lib/db";
import { getAuthUser } from "@/app/_lib/auth";
import { verifyMemberInfo, DEFAULT_PEPE_DOMAIN } from "@/worker/http-client";

// GET /api/accounts — list all accounts of user
export async function GET(request: Request) {
  const authUser = getAuthUser(request);
  if (!authUser) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const accounts = await prisma.account.findMany({
      where: { userId: authUser.userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      include: {
        _count: {
          select: { campaigns: true },
        },
      },
    });

    return Response.json({ accounts });
  } catch (error) {
    console.error("Fetch accounts error:", error);
    return Response.json(
      { error: "Failed to fetch accounts" },
      { status: 500 }
    );
  }
}

// POST /api/accounts — create & verify new account
export async function POST(request: Request) {
  const authUser = getAuthUser(request);
  if (!authUser) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (authUser.status !== "APPROVED" && authUser.role !== "ADMIN") {
    return Response.json({ error: "Your account is not approved" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { name, token, domain } = body;

    if (!name || !name.trim()) {
      return Response.json(
        { error: "Account name is required" },
        { status: 400 }
      );
    }

    if (!token || !token.trim()) {
      return Response.json(
        { error: "API Token is required" },
        { status: 400 }
      );
    }

    const trimmedName = name.trim();
    const trimmedToken = token.trim();
    const targetDomain = domain?.trim() || DEFAULT_PEPE_DOMAIN;

    // Verify token against member/info endpoint
    const verification = await verifyMemberInfo(targetDomain, trimmedToken);

    if (!verification.valid) {
      return Response.json(
        {
          error: `Token verification failed: ${verification.message}`,
          code: "TOKEN_VERIFICATION_FAILED",
        },
        { status: 400 }
      );
    }

    // Check existing accounts count to set default
    const existingCount = await prisma.account.count({
      where: { userId: authUser.userId },
    });

    const isFirstAccount = existingCount === 0;

    const account = await prisma.account.create({
      data: {
        userId: authUser.userId,
        name: trimmedName,
        token: trimmedToken,
        domain: domain?.trim() || null,
        remoteUsername: verification.data?.username || null,
        remoteUserId: verification.data?.id || null,
        balance: verification.data?.money || null,
        isDefault: isFirstAccount,
      },
    });

    return Response.json(
      {
        message: "Account added & verified successfully! 🎉",
        account,
        memberInfo: verification.data,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create account error:", error);
    return Response.json(
      { error: "Failed to create account" },
      { status: 500 }
    );
  }
}
