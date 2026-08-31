import { prisma } from "@/app/_lib/db";
import { getAuthUser } from "@/app/_lib/auth";

// GET /api/admin/users — list all users (admin only)
export async function GET(request: Request) {
  const authUser = getAuthUser(request);
  if (!authUser || authUser.role !== "ADMIN") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = parseInt(url.searchParams.get("pageSize") || "20");

  const where = status ? { status: status as "PENDING" | "APPROVED" | "REJECTED" } : {};

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        defaultDomain: true,
        createdAt: true,
        _count: {
          select: { campaigns: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return Response.json({
    users,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}
