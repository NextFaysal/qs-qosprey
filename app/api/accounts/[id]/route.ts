import { prisma } from "@/app/_lib/db";
import { getAuthUser } from "@/app/_lib/auth";
import { verifyMemberInfo, DEFAULT_PEPE_DOMAIN } from "@/worker/http-client";
import type { NextRequest } from "next/server";

type RouteParams = { params: Promise<{ id: string }> };

// DELETE /api/accounts/[id] — remove account
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
    const existing = await prisma.account.findFirst({
      where: { id, userId: authUser.userId },
    });

    if (!existing) {
      return Response.json({ error: "Account not found" }, { status: 404 });
    }

    await prisma.account.delete({
      where: { id },
    });

    // If deleted account was default, pick another one to be default
    if (existing.isDefault) {
      const another = await prisma.account.findFirst({
        where: { userId: authUser.userId },
        orderBy: { createdAt: "desc" },
      });
      if (another) {
        await prisma.account.update({
          where: { id: another.id },
          data: { isDefault: true },
        });
      }
    }

    return Response.json({ message: "Account deleted successfully" });
  } catch (error) {
    console.error("Delete account error:", error);
    return Response.json(
      { error: "Failed to delete account" },
      { status: 500 }
    );
  }
}

// PATCH /api/accounts/[id] — update account
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
    const existing = await prisma.account.findFirst({
      where: { id, userId: authUser.userId },
    });

    if (!existing) {
      return Response.json({ error: "Account not found" }, { status: 404 });
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};

    // Set as default
    if (body.isDefault === true) {
      // Unset other defaults for this user
      await prisma.account.updateMany({
        where: { userId: authUser.userId, isDefault: true },
        data: { isDefault: false },
      });
      updateData.isDefault = true;
    }

    if (body.name !== undefined && body.name.trim()) {
      updateData.name = body.name.trim();
    }

    if (body.domain !== undefined) {
      updateData.domain = body.domain?.trim() || null;
    }

    // If updating token or re-verifying
    if (body.token !== undefined && body.token.trim()) {
      const newToken = body.token.trim();
      const targetDomain = body.domain?.trim() || existing.domain || DEFAULT_PEPE_DOMAIN;
      const verification = await verifyMemberInfo(targetDomain, newToken);

      if (!verification.valid) {
        return Response.json(
          {
            error: `Token verification failed: ${verification.message}`,
            code: "TOKEN_VERIFICATION_FAILED",
          },
          { status: 400 }
        );
      }

      updateData.token = newToken;
      if (verification.data) {
        updateData.remoteUsername = verification.data.username;
        updateData.remoteUserId = verification.data.id;
        updateData.balance = verification.data.money;
      }
    } else if (body.reverify === true) {
      // Re-fetch latest balance & status using existing token
      const targetDomain = existing.domain || DEFAULT_PEPE_DOMAIN;
      const verification = await verifyMemberInfo(targetDomain, existing.token);

      if (verification.valid && verification.data) {
        updateData.remoteUsername = verification.data.username;
        updateData.remoteUserId = verification.data.id;
        updateData.balance = verification.data.money;
      }
    }

    const updated = await prisma.account.update({
      where: { id },
      data: updateData,
    });

    return Response.json({ account: updated });
  } catch (error) {
    console.error("Update account error:", error);
    return Response.json(
      { error: "Failed to update account" },
      { status: 500 }
    );
  }
}
