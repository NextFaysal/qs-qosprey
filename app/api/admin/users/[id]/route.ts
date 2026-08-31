import { prisma } from "@/app/_lib/db";
import { getAuthUser } from "@/app/_lib/auth";
import type { NextRequest } from "next/server";

type RouteParams = { params: Promise<{ id: string }> };

// PATCH /api/admin/users/[id] — approve/reject user (admin only)
export async function PATCH(
  request: NextRequest,
  ctx: RouteParams
) {
  const authUser = getAuthUser(request);
  if (!authUser || authUser.role !== "ADMIN") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;

  try {
    const body = await request.json();
    const { status, defaultDomain } = body;

    const updateData: Record<string, unknown> = {};

    if (status && ["APPROVED", "REJECTED", "PENDING"].includes(status)) {
      updateData.status = status;
    }

    if (defaultDomain !== undefined) {
      updateData.defaultDomain = defaultDomain?.trim() || null;
    }

    if (Object.keys(updateData).length === 0) {
      return Response.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        defaultDomain: true,
        createdAt: true,
      },
    });

    return Response.json({ user });
  } catch (error) {
    console.error("Admin user update error:", error);
    return Response.json(
      { error: "Failed to update user" },
      { status: 500 }
    );
  }
}
