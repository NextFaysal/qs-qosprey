import { prisma } from "@/app/_lib/db";
import { getAuthUser } from "@/app/_lib/auth";
import { DEFAULT_PEPE_DOMAIN } from "@/worker/http-client";

// GET /api/domains — list user's saved domains
export async function GET(request: Request) {
  const authUser = getAuthUser(request);
  if (!authUser) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const domains = await prisma.userDomain.findMany({
      where: { userId: authUser.userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });

    return Response.json({
      defaultDomain: DEFAULT_PEPE_DOMAIN,
      domains,
    });
  } catch (error) {
    console.error("Fetch domains error:", error);
    return Response.json(
      { error: "Failed to fetch domains" },
      { status: 500 }
    );
  }
}

// POST /api/domains — save a new domain
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
    const { name, url } = body;

    if (!url || !url.trim()) {
      return Response.json(
        { error: "Domain URL is required" },
        { status: 400 }
      );
    }

    let cleanUrl = url.trim().replace(/\/+$/, "");
    if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
      cleanUrl = `https://${cleanUrl}`;
    }

    try {
      new URL(cleanUrl);
    } catch {
      return Response.json(
        { error: "Invalid URL format" },
        { status: 400 }
      );
    }

    // Check count for isDefault
    const count = await prisma.userDomain.count({
      where: { userId: authUser.userId },
    });

    const domain = await prisma.userDomain.create({
      data: {
        userId: authUser.userId,
        name: name?.trim() || new URL(cleanUrl).hostname,
        url: cleanUrl,
        isDefault: count === 0,
      },
    });

    return Response.json({ domain }, { status: 201 });
  } catch (error) {
    console.error("Create domain error:", error);
    return Response.json(
      { error: "Failed to save domain" },
      { status: 500 }
    );
  }
}
