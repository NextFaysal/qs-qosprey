import { prisma } from "@/app/_lib/db";
import { getAuthUser } from "@/app/_lib/auth";
import type { NextRequest } from "next/server";

type RouteParams = { params: Promise<{ id: string }> };

// DELETE /api/domains/[id] — remove domain
export async function DELETE(
  request: NextRequest,
  ctx: RouteParams
) {
  const authUser = getAuthUser(request);
  if (!authUser) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  try {
    const existing = await prisma.userDomain.findFirst({
      where: { id, userId: authUser.userId },
    });

    if (!existing) {
      return Response.json({ error: "Domain not found" }, { status: 404 });
    }

    await prisma.userDomain.delete({
      where: { id },
    });

    return Response.json({ message: "Domain deleted successfully" });
  } catch (error) {
    console.error("Delete domain error:", error);
    return Response.json(
      { error: "Failed to delete domain" },
      { status: 500 }
    );
  }
}

// PATCH /api/domains/[id] — update domain (set as default, rename)
export async function PATCH(
  request: NextRequest,
  ctx: RouteParams
) {
  const authUser = getAuthUser(request);
  if (!authUser) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  try {
    const existing = await prisma.userDomain.findFirst({
      where: { id, userId: authUser.userId },
    });

    if (!existing) {
      return Response.json({ error: "Domain not found" }, { status: 404 });
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};

    if (body.isDefault === true) {
      await prisma.userDomain.updateMany({
        where: { userId: authUser.userId, isDefault: true },
        data: { isDefault: false },
      });
      updateData.isDefault = true;
    }

    if (body.name !== undefined && body.name.trim()) {
      updateData.name = body.name.trim();
    }

    const domain = await prisma.userDomain.update({
      where: { id },
      data: updateData,
    });

    return Response.json({ domain });
  } catch (error) {
    console.error("Update domain error:", error);
    return Response.json(
      { error: "Failed to update domain" },
      { status: 500 }
    );
  }
}
